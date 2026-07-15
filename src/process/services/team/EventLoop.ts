import { ipcBridge } from '@/common';
import { uuid } from '@/common/utils';
import { mainWarn } from '@process/utils/mainLogger';
import type AcpAgent from '@process/task/AcpAgent';
import { teamStore, type TeamMail, type TeamMember } from './TeamStore';
import { mirrorUnreadToConversation } from './MessageProjection';
import type { TeamRunManager, TeamRunTurnStatus } from './TeamRun';
import type { SlotWakeGate } from './SlotWakeGate';
import type { WakeSource } from './WakeSource';

/** Promise-based signal gate (附录 I.5 Notify) — non-polling wake. */
export class Notify {
  private pending = 0;
  private waiters: Array<() => void> = [];

  notifyOne(): void {
    if (this.waiters.length > 0) this.waiters.shift()!();
    else this.pending += 1;
  }

  wait(): Promise<void> {
    if (this.pending > 0) {
      this.pending -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

export interface TurnResult {
  turn_id: string;
  status: TeamRunTurnStatus;
}

export interface EventLoopDeps {
  teamId: string;
  slotId: string;
  member: TeamMember;
  getAgent: () => AcpAgent | null;
  wakeGate: SlotWakeGate;
  teamRun: TeamRunManager;
  leaderSlotId: () => string | null;
  /** Wake another slot in the same team (e.g. leader after a teammate goes idle). */
  onWakeSlot: (slotId: string, source: WakeSource) => void;
  /** Resolve a slot_id to its member (sender lookup for message projection). */
  lookupMember: (slotId: string) => TeamMember | null;
}

interface WakeInput {
  should_send: boolean;
  source: WakeSource;
  messages: TeamMail[];
}

/**
 * EventLoop — one async loop per member (附录 I.5).
 *
 * Signal-wake → computeWakeInput (peek mailbox + TeamRun orphan guard + wake gate)
 * → executeTurn (claim reservation → mirror → drive agent → record child) →
 * finalizeTurn (mark idle + notify leader + record child completed + maybe complete).
 */
export class EventLoop {
  private notify = new Notify();
  private alive = false;
  private busy = false;
  private loopPromise: Promise<void> | null = null;

  constructor(private deps: EventLoopDeps) {}

  start(): void {
    if (this.alive) return;
    this.alive = true;
    this.loopPromise = this.run().catch((e) => mainWarn('EventLoop', `loop for ${this.deps.slotId} exited:`, e));
  }

  async stop(): Promise<void> {
    this.alive = false;
    this.notify.notifyOne();
    if (this.loopPromise) await this.loopPromise;
    this.loopPromise = null;
  }

  notifyWake(): void {
    this.notify.notifyOne();
  }

  private async run(): Promise<void> {
    while (this.alive) {
      await this.notify.wait();
      while (this.alive) {
        const input = this.computeWakeInput();
        if (!input || !input.should_send) break;
        const turn = await this.executeTurn(input.source, input.messages);
        if (!turn) break;
        await this.finalizeTurn(turn);
      }
    }
  }

  /** I.5 computeWakeInput: peek-then-mark + orphan guard + wake gate. */
  private computeWakeInput(): WakeInput | null {
    const { teamId, slotId, wakeGate, teamRun } = this.deps;
    const unread = teamStore.peekUnread(teamId, slotId);
    if (unread.length === 0) return { should_send: false, source: 'mcp_send_message', messages: [] };
    const filtered = unread.filter((m) => m.from_member_id !== slotId); // self filter (I.4)
    if (filtered.length === 0) return { should_send: false, source: 'mcp_send_message', messages: [] };
    // Orphan guard (I.4): unread backlog with neither an active run nor a pending wake is unowned.
    if (!teamRun.hasActiveRun() && !teamRun.hasPendingWake(slotId)) {
      mainWarn('EventLoop', `unowned_mailbox_backlog for ${slotId} — not delivering`);
      return null;
    }
    const source = this.nextWakeSource();
    if (wakeGate.beforeWake(slotId, source) === 'Suppress') {
      return { should_send: false, source, messages: [] };
    }
    return { should_send: true, source, messages: filtered };
  }

  private nextWakeSource(): WakeSource {
    const queue = this.deps.teamRun.getRecord()?.pending_wakes.get(this.deps.slotId);
    return queue && queue.length > 0 ? queue[0].source : 'mcp_send_message';
  }

  private async executeTurn(source: WakeSource, messages: TeamMail[]): Promise<TurnResult | null> {
    if (this.busy) return null;
    // Three-level pipeline stage 1 → 2: pending_wakes → starting_reservations.
    const reservation = this.deps.teamRun.claimWakeForTurn(this.deps.slotId, source);
    if (!reservation) return null;
    const agent = this.deps.getAgent();
    if (!agent) {
      // No agent bound yet — return the reservation to the queue head and wait.
      this.deps.teamRun.retryChildStartLater(reservation);
      return null;
    }
    this.busy = true;
    // I.7: mirror non-user unread into this member's conversation (left bubbles) before the turn.
    mirrorUnreadToConversation(this.deps.member.team_id, this.deps.member, messages, this.deps.lookupMember);
    teamStore.updateMember(this.deps.slotId, { status: 'working' });
    ipcBridge.team.onAgentStatusChanged.emit({ team_id: this.deps.teamId, slot_id: this.deps.slotId, status: 'active' });
    const turnId = uuid();
    try {
      const text = messages.map((m) => m.content).join('\n\n');
      await agent.sendMessage({ content: text, msg_id: turnId });
      // Stage 2 → 3: starting_reservations → active_child_turns (turn has run).
      this.deps.teamRun.recordChildStarted(reservation, turnId, this.deps.member.conversation_id ?? '');
      // Peek-then-mark: Ok + graceful-Failed both mark (agent resolved); Err (thrown) stays unread.
      teamStore.markReadBatch(messages.map((m) => m.id));
      return { turn_id: turnId, status: 'completed' };
    } catch (e) {
      mainWarn('EventLoop', `turn failed for ${this.deps.slotId}:`, e);
      // Err → don't mark read; return the reservation to the pending queue head for the next wake.
      this.deps.teamRun.retryChildStartLater(reservation);
      this.markIdle();
      return null;
    } finally {
      this.busy = false;
    }
  }

  private async finalizeTurn(turn: TurnResult): Promise<void> {
    const { teamId, slotId, member, wakeGate, teamRun } = this.deps;
    this.markIdle();

    // Teammates notify the leader via an idle_notification mailbox message.
    if (member.role === 'teammate') {
      const leaderId = this.deps.leaderSlotId();
      if (leaderId) {
        teamStore.insertMail({
          id: uuid(),
          team_id: teamId,
          to_member_id: leaderId,
          from_member_id: slotId,
          type: 'idle_notification',
          content: `Teammate '${member.name}' finished a turn and is idle.`,
          summary: null,
          files: null,
          read: false,
          created_at: Date.now(),
        });
        this.deps.onWakeSlot(leaderId, 'idle_notification');
      }
    }

    // Stage 3 → ∅ + completion check.
    teamRun.recordChildCompleted(slotId, turn);
    teamRun.maybeComplete();

    if (wakeGate.releaseSuppressedIfResumed(slotId)) this.notify.notifyOne();
  }

  private markIdle(): void {
    teamStore.updateMember(this.deps.slotId, { status: 'idle' });
    ipcBridge.team.onAgentStatusChanged.emit({ team_id: this.deps.teamId, slot_id: this.deps.slotId, status: 'idle' });
  }
}
