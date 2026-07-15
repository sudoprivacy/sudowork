import { mainLog, mainWarn } from '@process/utils/mainLogger';
import type { TeamMailboxType, TeamMember } from './TeamStore';
import type { WakeSource } from './WakeSource';

/** Why a member's stream died (附录 I.3 detectCrash). */
export type CrashReason = { kind: 'ProcessExited'; msg: string } | { kind: 'SessionNotFound'; msg: string } | { kind: 'Unknown'; msg: string };

/** 60s watchdog: a turn with no stream output for this long is "suspicious" (附录 I.3 arm_wake_timeout). */
const WAKE_TIMEOUT_MS = 60_000;
/** 5s double-finalize guard per conversation (附录 I.3 finalizeDedup). */
const FINALIZE_DEDUP_WINDOW_MS = 5_000;
const RATE_LIMIT_RE = /429|rate.?limit|quota|too many requests/i;

export interface CrashRecoveryDeps {
  teamId: string;
  getMember: (slot: string) => TeamMember | null;
  leaderSlotId: () => string | null;
  /** Set member status + broadcast agentStatusChanged. */
  setStatus: (slot: string, status: string, lastMessage?: string) => void;
  /** Write a mailbox message (testament / notification). */
  writeMail: (toMemberId: string, fromMemberId: string, type: TeamMailboxType, content: string) => void;
  /** Wake a slot (e.g. the leader after a teammate crash). */
  notifyWake: (slot: string, source: WakeSource) => void;
}

/**
 * CrashRecovery — crash detection + state marking (附录 I.3 / §1.6).
 *
 * Detection subscribes to the shared responseStream (disconnected / error events), since AcpAgent
 * owns its connection callbacks and TeamService cannot attach (附录 A4). On a real crash
 * (process exit / session-not-found / disconnect) a teammate gets a testament written to the leader
 * and is marked failed; the leader is woken. Rate-limited (429) failures are marked failed without
 * recovery. The 60s watchdog only marks a slot suspicious on no-stream output — it NEVER auto-retries,
 * because re-dispatching a possibly-still-running task risks concurrent duplicate writes (风险 9, §1.6).
 */
export class CrashRecovery {
  /** Reentry lock: a slot's turn is serialized (附录 I.3 activeWakes). */
  private activeWakes = new Set<string>();
  /** Per-conversation last-finalize timestamp (附录 I.3 finalizeDedup). */
  private finalizeLastAt = new Map<string, number>();
  /** Per-slot watchdog timers. */
  private wakeTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(private readonly deps: CrashRecoveryDeps) {}

  /** Classify a stream event as a crash reason, or null if it is not an error/disconnect. */
  detectCrash(msg: { type: string; content?: { status?: string; error?: string } }): CrashReason | null {
    if (msg.type !== 'error' && msg.content?.status !== 'disconnected' && msg.content?.status !== 'error') return null;
    const text = msg.content?.error ?? '';
    if (text.includes('process exited')) return { kind: 'ProcessExited', msg: text };
    if (text.includes('Session not found')) return { kind: 'SessionNotFound', msg: text };
    return { kind: 'Unknown', msg: text || msg.content?.status || 'unknown' };
  }

  /** 429 / rate-limit / quota → mark failed, do not enter crash recovery. */
  isRateLimited(reason: CrashReason): boolean {
    return RATE_LIMIT_RE.test(reason.msg);
  }

  acquireWakeLock(slot: string): boolean {
    const fresh = !this.activeWakes.has(slot);
    this.activeWakes.add(slot);
    return fresh;
  }

  releaseWakeLock(slot: string): void {
    this.activeWakes.delete(slot);
  }

  /** 5s double-finalize guard: returns false if the same conversation finalized recently. */
  beginFinalize(conversationId: string): boolean {
    const last = this.finalizeLastAt.get(conversationId) ?? 0;
    const now = Date.now();
    if (now - last < FINALIZE_DEDUP_WINDOW_MS) return false;
    this.finalizeLastAt.set(conversationId, now);
    setTimeout(() => this.finalizeLastAt.delete(conversationId), FINALIZE_DEDUP_WINDOW_MS);
    return true;
  }

  /**
   * Handle a confirmed crash (附录 I.3 handleCrash). Writes a testament to the leader (teammates only),
   * marks the slot failed, releases the wake lock, and wakes the leader. Returns the woken leader slot
   * (or null if the leader itself crashed — the run goes Failed and the team stalls for the user).
   */
  handleCrash(slot: string, reason: CrashReason, lastMessage?: string): string | null {
    const member = this.deps.getMember(slot);
    if (!member) return null;
    if (member.role !== 'lead') {
      const testament = reason.kind === 'Unknown' ? `Teammate '${member.name}' crashed during task (reason: ${reason.msg}). Last message: ${lastMessage ?? ''}.` : `Teammate '${member.name}' crashed (reason: ${reason.kind}).`;
      const leaderId = this.deps.leaderSlotId();
      if (leaderId) {
        this.deps.writeMail(leaderId, slot, 'message', testament);
        this.deps.notifyWake(leaderId, 'crash_notification');
      }
    }
    this.deps.setStatus(slot, 'failed', reason.kind === 'Unknown' ? reason.msg : reason.kind);
    this.releaseWakeLock(slot);
    mainLog('CrashRecovery', `slot ${slot} crashed (${reason.kind})`);
    return member.role === 'lead' ? null : (this.deps.leaderSlotId() ?? null);
  }

  /**
   * Arm the 60s watchdog for a turn (附录 I.3 arm_wake_timeout, §1.6 conservative). On timeout with no
   * stream output the slot is marked suspicious — it is NOT auto-retried (re-dispatch risks concurrent
   * duplicate writes). Real crashes arrive through detectCrash on the disconnected/error stream event.
   */
  armWakeTimeout(slot: string): void {
    this.disarmWakeTimeout(slot);
    const timer = setTimeout(() => {
      mainWarn('CrashRecovery', `slot ${slot} inactive for ${WAKE_TIMEOUT_MS}ms — marking suspicious (no auto-retry)`);
    }, WAKE_TIMEOUT_MS);
    timer.unref?.();
    this.wakeTimeouts.set(slot, timer);
  }

  /** Reset the watchdog (a stream event arrived — the turn is progressing). */
  resetWakeTimeout(slot: string): void {
    if (this.wakeTimeouts.has(slot)) this.armWakeTimeout(slot);
  }

  disarmWakeTimeout(slot: string): void {
    const timer = this.wakeTimeouts.get(slot);
    if (timer) {
      clearTimeout(timer);
      this.wakeTimeouts.delete(slot);
    }
  }

  /** Release all timers/locks (session stop / member removal). */
  dispose(slot?: string): void {
    if (slot) {
      this.disarmWakeTimeout(slot);
      this.activeWakes.delete(slot);
    } else {
      for (const t of this.wakeTimeouts.values()) clearTimeout(t);
      this.wakeTimeouts.clear();
      this.activeWakes.clear();
    }
  }
}
