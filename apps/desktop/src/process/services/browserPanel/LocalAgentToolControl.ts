import fs from 'node:fs';
import path from 'node:path';

export interface ILocalToolControlState {
  epoch: number;
  state: 'ai' | 'pausing' | 'human' | 'observing' | 'error';
  owner?: string;
  error?: string;
}

interface IActor {
  connection: {
    readonly hasActiveSession: boolean;
    readonly isToolPauseSupported?: boolean;
    pauseTools: () => Promise<PauseTicket>;
    resumeTools: (ticket: PauseTicket) => Promise<void>;
  };
  ready: () => Promise<void>;
}

type PauseTicket = { sessionId: string; pauseEpoch: number };

/** Host admission and engine barriers are separate from the SDK's browser lease. */
export class LocalAgentToolControl {
  private readonly actors = new Map<string, IActor>();
  private readonly paused = new Map<string, PauseTicket>();
  private current: ILocalToolControlState | undefined;
  private operation: Promise<ILocalToolControlState> | undefined;

  constructor(private readonly filename: () => string) {}

  status(): ILocalToolControlState {
    if (!this.current) {
      const filename = this.filename();
      if (fs.existsSync(filename)) {
        const saved = JSON.parse(fs.readFileSync(filename, 'utf8')) as ILocalToolControlState;
        if (!Number.isSafeInteger(saved.epoch) || saved.epoch < 0 || !['ai', 'pausing', 'human', 'observing', 'error'].includes(saved.state)) throw new Error('Invalid saved browser tool control');
        // Reopening the UI never releases a persisted human intent.
        this.current = saved.state === 'ai' ? saved : { epoch: saved.epoch, owner: saved.owner, state: 'error', error: 'tool_control_recovery_required' };
      } else this.current = { epoch: 0, state: 'ai' };
    }
    return { ...this.current };
  }

  private save(state: ILocalToolControlState): void {
    this.current = state;
    const filename = this.filename();
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temporary, filename);
  }

  register(id: string, actor: IActor): void {
    if (this.actors.has(id)) throw new Error('Local tool actor is already registered');
    this.actors.set(id, actor);
  }

  unregister(id: string): void {
    this.actors.delete(id);
    this.paused.delete(id);
  }

  /** A ticket also rejects a prompt admitted before a completed take/return. */
  assertCanPrompt(epoch?: number): number {
    const current = this.status();
    if (current.state !== 'ai') throw new Error('Browser control is held by the user. Return control before sending a new task.');
    if (epoch !== undefined && epoch !== current.epoch) throw new Error('The queued task predates browser takeover. Send a fresh task.');
    return current.epoch;
  }

  /** Account transitions revoke resources; they never hand an old browser to a new actor. */
  retireAfterShutdown(closeResources: () => Promise<void>): Promise<ILocalToolControlState> {
    if (this.operation) return Promise.reject(new Error('Browser control transfer is already running'));
    if (this.actors.size) return Promise.reject(new Error('Stop all local agents before retiring browser control'));
    const current = this.status();
    this.save({ epoch: current.epoch + 1, owner: current.owner, state: 'pausing' });
    const pending = (async () => {
      try {
        await closeResources();
        if (this.actors.size) throw new Error('A local agent started during browser shutdown');
        this.paused.clear();
        this.save({ epoch: current.epoch + 1, state: 'ai' });
      } catch (error) {
        this.save({ epoch: current.epoch + 1, owner: current.owner, state: 'error', error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
      return this.status();
    })();
    this.operation = pending;
    void pending
      .finally(() => {
        if (this.operation === pending) this.operation = undefined;
      })
      .catch(() => {});
    return pending;
  }

  take(owner: string, acquireBrowser: () => Promise<void>, isReviewSwitch = false): Promise<ILocalToolControlState> {
    if (this.operation) return Promise.reject(new Error('Browser control transfer is already running'));
    const current = this.status();
    if ([...this.actors.values()].some((actor) => actor.connection.hasActiveSession && actor.connection.isToolPauseSupported === false)) return Promise.reject(new Error('An active agent cannot acknowledge tool takeover. Update or stop it before taking browser control.'));
    const isRecovery = current.state === 'error' && current.owner === owner;
    // An explicit host review action may also recover a persisted takeover.
    // Recovery still reacquires every engine ticket before opening the page.
    const isExplicitReviewSwitch = isReviewSwitch && ['human', 'error'].includes(current.state);
    if (!owner || (current.state !== 'ai' && !isRecovery && !isExplicitReviewSwitch)) return Promise.reject(new Error('Browser control must be returned before another takeover'));
    this.save({ epoch: current.epoch + 1, owner, state: 'pausing' });
    const pending = (async () => {
      try {
        // Join bootstraps admitted before the fence. Later bootstraps and all
        // prompt paths are refused, so none can bypass the acknowledgement.
        for (const [id, actor] of this.actors) {
          await actor.ready();
          if (isExplicitReviewSwitch && current.state === 'human' && this.paused.has(id)) continue;
          if (actor.connection.hasActiveSession) this.paused.set(id, await actor.connection.pauseTools());
        }
        await acquireBrowser();
        this.save({ epoch: this.status().epoch, owner, state: 'human' });
      } catch (error) {
        this.save({ epoch: this.status().epoch, owner, state: 'error', error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
      return this.status();
    })();
    this.operation = pending;
    void pending
      .finally(() => {
        if (this.operation === pending) this.operation = undefined;
      })
      .catch(() => {});
    return pending;
  }

  giveBack(owner: string, epoch: number, observeAndReturnBrowser: () => Promise<void>): Promise<ILocalToolControlState> {
    if (this.operation) return Promise.reject(new Error('Browser control transfer is already running'));
    const current = this.status();
    if (owner !== current.owner || epoch !== current.epoch || !['human', 'error'].includes(current.state)) return Promise.reject(new Error('Browser control epoch or owner is stale'));
    this.save({ epoch, owner, state: 'observing' });
    const pending = (async () => {
      try {
        if (current.state === 'error') {
          // After a lost acknowledgement, partial return, or app restart,
          // reacquire explicit engine tickets before releasing admission.
          for (const [id, actor] of this.actors) {
            await actor.ready();
            if (actor.connection.hasActiveSession) this.paused.set(id, await actor.connection.pauseTools());
          }
        }
        await observeAndReturnBrowser();
        for (const [id, ticket] of this.paused) {
          const actor = this.actors.get(id);
          if (!actor) throw new Error('A paused agent must be recovered before returning control');
          await actor.connection.resumeTools(ticket);
          this.paused.delete(id);
        }
        this.paused.clear();
        this.save({ epoch, state: 'ai' });
      } catch (error) {
        // The host admission fence remains held even after a partial return.
        this.save({ epoch, owner, state: 'error', error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
      return this.status();
    })();
    this.operation = pending;
    void pending
      .finally(() => {
        if (this.operation === pending) this.operation = undefined;
      })
      .catch(() => {});
    return pending;
  }
}
