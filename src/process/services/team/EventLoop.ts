import { ipcBridge } from '@/common';
import { uuid } from '@/common/utils';
import { mainWarn } from '@process/utils/mainLogger';
import type AcpAgent from '@process/task/AcpAgent';
import { teamStore, type TeamMail, type TeamMember } from './TeamStore';
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

export interface EventLoopDeps {
  teamId: string;
  slotId: string;
  member: TeamMember;
  getAgent: () => AcpAgent | null;
  wakeGate: SlotWakeGate;
  leaderSlotId: () => string | null;
  /** Wake another slot in the same team (e.g. leader after a teammate goes idle). */
  onWakeSlot: (slotId: string, source: WakeSource) => void;
}

/**
 * EventLoop — one async loop per member (附录 I.5).
 *
 * Stage 2 simplified loop: signal-wake -> peek mailbox (peek-then-mark) -> run a
 * turn -> mark idle + notify leader. The TeamRun three-level pipeline
 * (pending_wakes / starting_reservations / active_child_turns), operation lease,
 * and recovery drain are stage 3; this loop already enforces single-turn
 * serialization per slot via `busy`.
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
        const ok = await this.executeTurn(input.messages);
        if (!ok) break;
        await this.finalizeTurn();
      }
    }
  }

  /** I.5 computeWakeInput (stage-2 simplified: no TeamRun gate). */
  private computeWakeInput(): { should_send: boolean; messages: TeamMail[] } | null {
    const { teamId, slotId, wakeGate } = this.deps;
    const unread = teamStore.peekUnread(teamId, slotId);
    if (unread.length === 0) return { should_send: false, messages: [] };
    const filtered = unread.filter((m) => m.from_member_id !== slotId); // self filter (I.4)
    if (filtered.length === 0) return { should_send: false, messages: [] };
    if (wakeGate.beforeWake(slotId, 'mcp_send_message') === 'Suppress') {
      return { should_send: false, messages: [] };
    }
    return { should_send: true, messages: filtered };
  }

  private async executeTurn(messages: TeamMail[]): Promise<boolean> {
    if (this.busy) return false;
    const agent = this.deps.getAgent();
    if (!agent) return false;
    this.busy = true;
    teamStore.updateMember(this.deps.slotId, { status: 'working' });
    ipcBridge.team.onAgentStatusChanged.emit({ team_id: this.deps.teamId, slot_id: this.deps.slotId, status: 'active' });
    try {
      const text = messages.map((m) => m.content).join('\n\n');
      await agent.sendMessage({ content: text, msg_id: uuid() });
      // Peek-then-mark: Ok + Failed both mark; Err (retryable) would stay unread — stage 2 marks on success.
      teamStore.markReadBatch(messages.map((m) => m.id));
      return true;
    } catch (e) {
      mainWarn('EventLoop', `turn failed for ${this.deps.slotId}:`, e);
      return false;
    } finally {
      this.busy = false;
    }
  }

  private async finalizeTurn(): Promise<void> {
    const { teamId, slotId, member, wakeGate } = this.deps;
    teamStore.updateMember(slotId, { status: 'idle' });
    ipcBridge.team.onAgentStatusChanged.emit({ team_id: teamId, slot_id: slotId, status: 'idle' });

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

    if (wakeGate.releaseSuppressedIfResumed(slotId)) this.notify.notifyOne();
  }
}
