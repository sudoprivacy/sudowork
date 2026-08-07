import { ipcBridge } from '@/common';
import { uuid } from '@/common/utils';
import { mainWarn } from '@process/utils/mainLogger';
import type AcpAgent from '@process/task/AcpAgent';
import { teamStore, type TeamMail, type TeamMember } from './TeamStore';
import { mirrorUnreadToConversation } from './MessageProjection';
import type { TeamRunManager, TeamRunTurnStatus } from './TeamRun';
import type { SlotWakeGate } from './SlotWakeGate';
import { buildTeamUserLanguageContract, type TeamUserLanguage } from './TeamLanguage';
import type { WakeSource } from './WakeSource';

const EVENT_LOOP_STOP_TIMEOUT_MS = 3000;

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
  /** Crash recovery (watchdog arm/disarm). Optional so unit tests can omit it. */
  crashRecovery?: { armWakeTimeout: (slot: string) => void; disarmWakeTimeout: (slot: string) => void } | null;
  leaderSlotId: () => string | null;
  /** Wake another slot in the same team (e.g. leader after a teammate goes idle). */
  onWakeSlot: (slotId: string, source: WakeSource, messageId?: string | null) => void;
  /** Resolve a slot_id to its member (sender lookup for message projection). */
  lookupMember: (slotId: string) => TeamMember | null;
  getLatestUserLanguage?: () => TeamUserLanguage | null;
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
  // 本 turn 起始时 leader mailbox 的 MAX(created_at)（与去重查询同表的 watermark），
  // 供 finalizeTurn 区分"本 turn member 主动回传"与"上一 turn 的陈旧 mail"。
  private turnStartCreatedAt = 0;

  constructor(private deps: EventLoopDeps) {}

  start(): void {
    if (this.alive) return;
    this.alive = true;
    this.loopPromise = this.run().catch((e) => mainWarn('EventLoop', `loop for ${this.deps.slotId} exited:`, e));
  }

  async stop(): Promise<void> {
    this.alive = false;
    this.notify.notifyOne();
    if (this.loopPromise) {
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      await Promise.race([
        this.loopPromise,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve();
          }, EVENT_LOOP_STOP_TIMEOUT_MS);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      if (timedOut) mainWarn('EventLoop', `stop timed out for ${this.deps.slotId}`);
    }
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
        if (!this.alive) break;
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
    this.deps.crashRecovery?.armWakeTimeout(this.deps.slotId);
    // I.7: mirror non-user unread into this member's conversation (left bubbles) before the turn.
    mirrorUnreadToConversation(this.deps.member.team_id, this.deps.member, messages, this.deps.lookupMember);
    teamStore.updateMember(this.deps.slotId, { status: 'working' });
    ipcBridge.team.onAgentStatusChanged.emit({ team_id: this.deps.teamId, slot_id: this.deps.slotId, status: 'active' });
    const turnId = uuid();
    try {
      const text = messages.map((m) => m.content).join('\n\n');
      const latestUserLanguage = this.deps.getLatestUserLanguage?.() ?? null;
      const hiddenPromptPrefix = latestUserLanguage ? buildTeamUserLanguageContract(latestUserLanguage) : undefined;
      // Watermark：sendMessage 前取 leader mailbox 同表 MAX(created_at)，
      // 供 finalizeTurn 去重（区分本 turn member 主动回传 vs 上一 turn 陈旧 mail）。
      const watermarkLeaderId = this.deps.leaderSlotId();
      this.turnStartCreatedAt = watermarkLeaderId ? teamStore.getMailMaxCreatedAt(this.deps.teamId, watermarkLeaderId) : 0;
      await agent.sendMessage({ content: text, msg_id: turnId, hiddenPromptPrefix, suppressUserBubble: true });
      if (!this.alive) return null;
      // Stage 2 → 3: starting_reservations → active_child_turns (turn has run).
      this.deps.teamRun.recordChildStarted(reservation, turnId, this.deps.member.conversation_id ?? '');
      // Peek-then-mark: Ok + graceful-Failed both mark (agent resolved); Err (thrown) stays unread.
      teamStore.markReadBatch(messages.map((m) => m.id));
      return { turn_id: turnId, status: 'completed' };
    } catch (e) {
      if (!this.alive) return null;
      mainWarn('EventLoop', `turn failed for ${this.deps.slotId}:`, e);
      // Err → don't mark read; return the reservation to the pending queue head for the next wake.
      this.deps.teamRun.retryChildStartLater(reservation);
      // Do not clobber a 'failed' status that crash recovery may have just set (when the stream
      // disconnected event arrives before this sendMessage rejection — 附录 I.3 race).
      const current = this.deps.lookupMember(this.deps.slotId);
      if (!current || current.status !== 'failed') this.markIdle();
      return null;
    } finally {
      this.deps.crashRecovery?.disarmWakeTimeout(this.deps.slotId);
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
        // 兜底回传正文：member 本 turn 若未主动把正文发给 leader，把其内存正文（绕开 DB 落盘）
        // 以 type=message 投进 leader mailbox。只投递、不单独唤醒（唤醒由下方 idle_notification 走闸门）。
        // 必须同步、无 await，且在 idle_notification/onWakeSlot 之前——否则 leader 被 onWakeSlot 唤醒时
        // 正文可能尚未入 mailbox，导致漏读。
        try {
          const prose = this.deps.getAgent()?.getLastTurnProseText() ?? '';
          if (prose) {
            const alreadyReplied = teamStore.getHistory(teamId, leaderId).some((m) => m.from_member_id === slotId && m.type === 'message' && m.created_at > this.turnStartCreatedAt);
            if (!alreadyReplied) {
              teamStore.insertMail({
                id: uuid(),
                team_id: teamId,
                to_member_id: leaderId,
                from_member_id: slotId,
                type: 'message',
                content: prose,
                summary: null,
                files: null,
                read: false,
                created_at: Date.now(),
              });
            }
          }
        } catch (e) {
          mainWarn('EventLoop', `fallback prose reply failed for ${slotId}:`, e);
        }

        const mailId = uuid();
        teamStore.insertMail({
          id: mailId,
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
        this.deps.onWakeSlot(leaderId, 'idle_notification', mailId);
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
