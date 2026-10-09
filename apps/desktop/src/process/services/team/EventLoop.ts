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

/** 系统自动重试提示 mail 的内容前缀。检测时据此排除系统 hint 自身（hint 也是 from='user' mail，
 * 若不排除，上游持续零产出时会形成 hint→零产出→hint 的无限重试链，违反"同一用户消息只重试一次"）。
 * 已知边界：用户手打消息恰以该前缀开头时会被误判为 hint，仅丢失一次自动重试机会（等同无本机制
 * 的现状，非行为退化），UI 投影不受影响（MessageProjection 按 from='user' 投右侧气泡，不看内容）。 */
export const AUTO_RETRY_HINT_PREFIXES = ['[Auto-retry]', '[自动重试]'] as const;
const isAutoRetryHint = (mail: TeamMail): boolean => AUTO_RETRY_HINT_PREFIXES.some((p) => mail.content.startsWith(p));

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
  crashRecovery?: { armWakeTimeout: (slot: string) => void; disarmWakeTimeout: (slot: string) => void; clearToolInProgress: (slot: string) => void } | null;
  leaderSlotId: () => string | null;
  /** Wake another slot in the same team (e.g. leader after a teammate goes idle). */
  onWakeSlot: (slotId: string, source: WakeSource, messageId?: string | null) => void;
  /** Resolve a slot_id to its member (sender lookup for message projection). */
  lookupMember: (slotId: string) => TeamMember | null;
  getLatestUserLanguage?: () => TeamUserLanguage | null;
  /** A user_message-driven turn completed with zero prose — auto-retry hook. */
  onUserTurnEmptyProse?: (slotId: string) => void;
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
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryBackoff = 0;
  private turnRetryCount = 0;
  private static readonly RETRY_BASE_MS = 1000;
  private static readonly RETRY_MAX_MS = 30000;
  /** Max sendMessage-failure retries before abandoning the turn (aligns with CronService maxRetries). */
  private static readonly TURN_RETRY_LIMIT = 3;

  constructor(private deps: EventLoopDeps) {}

  start(): void {
    if (this.alive) return;
    this.alive = true;
    this.loopPromise = this.run().catch((e) => mainWarn('EventLoop', `loop for ${this.deps.slotId} exited:`, e));
  }

  async stop(): Promise<void> {
    this.alive = false;
    this.notify.notifyOne();
    this.resetRetry();
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
    // One-shot startup self-check: a wake committed before this loop started (e.g. during the
    // spawn attach window, where notifyWake is a no-op until the runtime is registered) is
    // invisible to Notify — re-signal once so the first wait() drains it. Checked only once:
    // per-iteration checks would busy-loop on paused / agent-less slots with unread backlog.
    if (this.hasOwnPendingWork()) this.notify.notifyOne();
    while (this.alive) {
      await this.notify.wait();
      while (this.alive) {
        try {
          const input = this.computeWakeInput();
          if (!input || !input.should_send) break;
          const turn = await this.executeTurn(input.source, input.messages);
          if (!turn) break;
          if (!this.alive) break;
          await this.finalizeTurn(turn);
        } catch (e) {
          mainWarn('EventLoop', `run iteration failed for ${this.deps.slotId}:`, e);
          if (this.alive) this.scheduleRetry();
          break;
        }
      }
    }
  }

  /** I.5 computeWakeInput: peek-then-mark + orphan guard + wake gate. */
  private computeWakeInput(): WakeInput | null {
    const { teamId, slotId, wakeGate, teamRun } = this.deps;
    const unread = teamStore.peekUnread(teamId, slotId);
    if (unread.length === 0) return { should_send: false, source: 'mcp_send_message', messages: [] };
    // Stale crash testaments: the author is no longer failed (or is gone) — filter them out and
    // drop their pending wakes, otherwise an undeliverable wake would strand the run active forever.
    const staleTestamentIds = new Set<string>();
    for (const mail of unread) {
      if (mail.type !== 'crash_testament' || mail.from_member_id === slotId) continue;
      const author = this.deps.lookupMember(mail.from_member_id);
      if (!author || author.status !== 'failed') staleTestamentIds.add(mail.id);
    }
    const filtered = unread.filter((m) => m.from_member_id !== slotId && !staleTestamentIds.has(m.id)); // self filter (I.4) + stale testaments
    // Drop the wakes owned by the filtered-out testaments (each carries the testament mail id), even
    // when every unread item was stale; otherwise no turn claims the wake and the run stays active.
    for (const mailId of staleTestamentIds) teamRun.dropPendingWake(slotId, mailId);
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

  /**
   * Ownership-mirroring unread check for the one-shot startup self-signal — same ownership rule
   * as computeWakeInput (unowned backlog must NOT wake us), but WITHOUT calling computeWakeInput:
   * its beforeWake has a side effect (suppressed_count increments on Suppress) that a paused slot
   * would hit on every probe. Keep the two queries in sync if the guard changes.
   */
  private hasOwnPendingWork(): boolean {
    const unread = teamStore.peekUnread(this.deps.teamId, this.deps.slotId).filter((m) => m.from_member_id !== this.deps.slotId);
    if (unread.length === 0) return false;
    return this.deps.teamRun.hasActiveRun() || this.deps.teamRun.hasPendingWake(this.deps.slotId);
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
    try {
      this.deps.crashRecovery?.armWakeTimeout(this.deps.slotId);
      // I.7: mirror non-user unread into this member's conversation (left bubbles) before the turn.
      mirrorUnreadToConversation(this.deps.member.team_id, this.deps.member, messages, this.deps.lookupMember);
      teamStore.updateMember(this.deps.slotId, { status: 'working' });
      ipcBridge.team.onAgentStatusChanged.emit({ team_id: this.deps.teamId, slot_id: this.deps.slotId, status: 'active' });
      const turnId = uuid();
      const text = messages.map((m) => m.content).join('\n\n');
      const latestUserLanguage = this.deps.getLatestUserLanguage?.() ?? null;
      const hiddenPromptPrefix = latestUserLanguage ? buildTeamUserLanguageContract(latestUserLanguage) : undefined;
      // Watermark：sendMessage 前取 leader mailbox 同表 MAX(created_at)，
      // 供 finalizeTurn 去重（区分本 turn member 主动回传 vs 上一 turn 陈旧 mail）。
      const watermarkLeaderId = this.deps.leaderSlotId();
      this.turnStartCreatedAt = watermarkLeaderId ? teamStore.getMailMaxCreatedAt(this.deps.teamId, watermarkLeaderId) : 0;
      await agent.sendMessage({ content: text, msg_id: turnId, hiddenPromptPrefix, suppressUserBubble: true });
      this.resetRetry();
      // The turn really ran — complete the reservation transition even if stop() raced us, so the
      // reservation never strands in starting_reservations (M25). finalizeTurn is skipped below.
      // Stage 2 → 3: starting_reservations → active_child_turns (turn has run).
      this.deps.teamRun.recordChildStarted(reservation, turnId, this.deps.member.conversation_id ?? '');
      // Peek-then-mark: Ok + graceful-Failed both mark (agent resolved); Err (thrown) stays unread.
      teamStore.markReadBatch(messages.map((m) => m.id));
      if (!this.alive) return null;
      // user_message 唤醒的 turn 正常结束但零助手正文（如上游空流）：不干预则该成员静默 idle 且
      // 无后续唤醒事件。补投一条 from='user' 提示走 user_message 唤醒（与用户手动再发消息等价）。
      // isAutoRetryHint 排除系统 hint：hint 驱动的重试轮再次零产出时不再投递（一次上限）。
      if (source === 'user_message') {
        const userMail = messages.find((m) => m.from_member_id === 'user' && !isAutoRetryHint(m));
        if (userMail && (agent.getLastTurnProseText?.() ?? '').trim() === '') {
          try {
            this.deps.onUserTurnEmptyProse?.(this.deps.slotId);
          } catch (e) {
            mainWarn('EventLoop', `empty-prose auto-retry failed for ${this.deps.slotId}:`, e);
          }
        }
      }
      return { turn_id: turnId, status: 'completed' };
    } catch (e) {
      if (!this.alive) return null;
      mainWarn('EventLoop', `turn failed for ${this.deps.slotId}:`, e);
      this.turnRetryCount += 1;
      if (this.turnRetryCount >= EventLoop.TURN_RETRY_LIMIT) {
        // Retry budget exhausted: abandon the reservation (no re-queue — re-delivering the same
        // batch would repeat agent side effects) and tell the leader so it can re-plan. The count
        // resets here: the next user-driven delivery is a fresh cycle, not a continuation.
        this.deps.teamRun.abandonReservation(reservation);
        this.turnRetryCount = 0;
        this.notifyLeaderOfAbandon();
        this.markIdle();
        return null;
      }
      // Err → don't mark read; return the reservation to the pending queue for the next wake.
      this.deps.teamRun.retryChildStartLater(reservation);
      this.scheduleRetry();
      // Do not clobber a 'failed' status that crash recovery may have just set (when the stream
      // disconnected event arrives before this sendMessage rejection — 附录 I.3 race).
      try {
        const current = this.deps.lookupMember(this.deps.slotId);
        if (!current || current.status !== 'failed') this.markIdle();
      } catch (me) {
        mainWarn('EventLoop', `markIdle after failure failed for ${this.deps.slotId}:`, me);
      }
      return null;
    } finally {
      this.deps.crashRecovery?.disarmWakeTimeout(this.deps.slotId);
      this.deps.crashRecovery?.clearToolInProgress(this.deps.slotId);
      this.busy = false;
    }
  }

  private async finalizeTurn(turn: TurnResult): Promise<void> {
    const { teamId, slotId, member, wakeGate, teamRun } = this.deps;
    try {
      this.markIdle();

      // Teammates notify the leader via an idle_notification mailbox message.
      if (member.role === 'teammate') {
        const leaderId = this.deps.leaderSlotId();
        if (leaderId) {
          // 兜底回传正文：member 本 turn 若未把实质正文发给 leader（判据：已发 message 总字符数 ×2 ≥
          // 本 turn 正文长度才视为已回传——只发"已完成"类短状态短语不算），把其内存正文（绕开 DB 落盘）
          // 以 type=message 投进 leader mailbox。只投递、不单独唤醒（唤醒由下方 idle_notification 走闸门）。
          // 必须同步、无 await，且在 idle_notification/onWakeSlot 之前——否则 leader 被 onWakeSlot 唤醒时
          // 正文可能尚未入 mailbox，导致漏读。
          try {
            const prose = this.deps.getAgent()?.getLastTurnProseText() ?? '';
            if (prose) {
              const sentChars = teamStore.getMemberMessageCharsSince(teamId, leaderId, slotId, this.turnStartCreatedAt);
              if (sentChars * 2 < prose.length) {
                teamStore.insertMail({
                  id: uuid(36),
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

          const mailId = uuid(36);
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
    } catch (e) {
      mainWarn('EventLoop', `finalizeTurn pre-complete failed for ${slotId}:`, e);
    }

    // Stage 3 → ∅ + completion check.
    try {
      teamRun.recordChildCompleted(slotId, turn);
      teamRun.maybeComplete();
    } catch (e) {
      mainWarn('EventLoop', `recordChildCompleted failed for ${slotId}:`, e);
    }

    try {
      if (wakeGate.releaseSuppressedIfResumed(slotId)) this.notify.notifyOne();
    } catch (e) {
      mainWarn('EventLoop', `wake gate release failed for ${slotId}:`, e);
    }
  }

  private markIdle(): void {
    teamStore.updateMember(this.deps.slotId, { status: 'idle' });
    ipcBridge.team.onAgentStatusChanged.emit({ team_id: this.deps.teamId, slot_id: this.deps.slotId, status: 'idle' });
  }

  /**
   * Tell the leader a teammate's turn was abandoned after exhausting its retry budget — as a plain
   * 'message' (projected visible; NOT crash_testament, whose staleness filter would swallow it since
   * this member is alive-but-failing). The member itself stays idle: marking it failed here would
   * break the "failed ⟺ no-runtime" invariant retryMemberStart depends on. A leader's own abandon
   * gets no mail (self-mail is never deliverable) — log only.
   */
  private notifyLeaderOfAbandon(): void {
    if (this.deps.member.role !== 'teammate') return;
    const leaderId = this.deps.leaderSlotId();
    if (!leaderId) return;
    try {
      const mailId = uuid(36);
      teamStore.insertMail({
        id: mailId,
        team_id: this.deps.teamId,
        to_member_id: leaderId,
        from_member_id: this.deps.slotId,
        type: 'message',
        content: `Teammate '${this.deps.member.name}' could not start a turn after repeated failures; the pending message was dropped. Re-send the task if still needed.`,
        summary: null,
        files: null,
        read: false,
        created_at: Date.now(),
      });
      this.deps.onWakeSlot(leaderId, 'crash_notification', mailId);
    } catch (e) {
      mainWarn('EventLoop', `notifyLeaderOfAbandon failed for ${this.deps.slotId}:`, e);
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryBackoff = this.retryBackoff === 0 ? EventLoop.RETRY_BASE_MS : Math.min(this.retryBackoff * 2, EventLoop.RETRY_MAX_MS);
    const timer = setTimeout(() => {
      this.retryTimer = null;
      this.notify.notifyOne();
    }, this.retryBackoff);
    timer.unref?.();
    this.retryTimer = timer;
  }

  private resetRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retryBackoff = 0;
    this.turnRetryCount = 0;
  }
}
