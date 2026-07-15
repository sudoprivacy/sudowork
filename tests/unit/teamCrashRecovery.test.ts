import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CrashRecovery } from '@process/services/team/CrashRecovery';
import type { TeamMember } from '@process/services/team/TeamStore';

vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));

const setStatus = vi.fn();
const writeMail = vi.fn();
const notifyWake = vi.fn();

function makeMember(role: 'lead' | 'teammate', name: string): TeamMember {
  return {
    id: role === 'lead' ? 'leader' : 's1',
    team_id: 't1',
    role,
    name,
    assistant_id: null,
    backend: 'scode',
    preset_agent_type: 'scode',
    skills: [],
    preset_context: null,
    model: null,
    avatar: null,
    conversation_id: 'c1',
    status: 'working',
    created_at: 1,
  };
}

function makeCr(member: TeamMember): CrashRecovery {
  return new CrashRecovery({
    teamId: 't1',
    getMember: () => member,
    leaderSlotId: () => 'leader',
    setStatus,
    writeMail,
    notifyWake,
  });
}

beforeEach(() => {
  setStatus.mockReset();
  writeMail.mockReset();
  notifyWake.mockReset();
});

describe('CrashRecovery.detectCrash (附录 I.3)', () => {
  const cr = makeCr(makeMember('teammate', 'Al'));
  it('ignores non-error / non-disconnect events', () => {
    expect(cr.detectCrash({ type: 'content', content: {} })).toBeNull();
    expect(cr.detectCrash({ type: 'agent_status', content: { status: 'connected' } })).toBeNull();
  });
  it('classifies process-exit and session-not-found', () => {
    expect(cr.detectCrash({ type: 'agent_status', content: { status: 'error', error: 'process exited code 1' } })).toEqual({ kind: 'ProcessExited', msg: 'process exited code 1' });
    expect(cr.detectCrash({ type: 'agent_status', content: { status: 'error', error: 'Session not found' } })).toEqual({ kind: 'SessionNotFound', msg: 'Session not found' });
  });
  it('falls back to Unknown for disconnected/error without a known phrase', () => {
    expect(cr.detectCrash({ type: 'agent_status', content: { status: 'disconnected' } })).toEqual({ kind: 'Unknown', msg: 'disconnected' });
    expect(cr.detectCrash({ type: 'error', content: { error: 'something broke' } })).toEqual({ kind: 'Unknown', msg: 'something broke' });
  });
});

describe('CrashRecovery.isRateLimited', () => {
  const cr = makeCr(makeMember('teammate', 'Al'));
  it('detects 429 / rate-limit / quota messages', () => {
    expect(cr.isRateLimited({ kind: 'Unknown', msg: 'HTTP 429 Too Many Requests' })).toBe(true);
    expect(cr.isRateLimited({ kind: 'Unknown', msg: 'rate limit exceeded' })).toBe(true);
    expect(cr.isRateLimited({ kind: 'Unknown', msg: 'quota depleted' })).toBe(true);
  });
  it('is false for ordinary crashes', () => {
    expect(cr.isRateLimited({ kind: 'ProcessExited', msg: 'process exited' })).toBe(false);
  });
});

describe('CrashRecovery wake lock + finalize dedup', () => {
  it('acquireWakeLock is reentrant: first true, second false, releases on release', () => {
    const cr = makeCr(makeMember('teammate', 'Al'));
    expect(cr.acquireWakeLock('s1')).toBe(true);
    expect(cr.acquireWakeLock('s1')).toBe(false);
    cr.releaseWakeLock('s1');
    expect(cr.acquireWakeLock('s1')).toBe(true);
  });

  it('beginFinalize dedupes within the 5s window per conversation', () => {
    const cr = makeCr(makeMember('teammate', 'Al'));
    expect(cr.beginFinalize('c1')).toBe(true);
    expect(cr.beginFinalize('c1')).toBe(false); // within window
    expect(cr.beginFinalize('c2')).toBe(true); // different conversation
  });
});

describe('CrashRecovery.handleCrash (附录 I.3)', () => {
  it('teammate: writes a testament to the leader, marks failed, wakes the leader, returns leader slot', () => {
    const cr = makeCr(makeMember('teammate', 'Al'));
    const result = cr.handleCrash('s1', { kind: 'ProcessExited', msg: 'process exited' });
    expect(result).toBe('leader');
    expect(writeMail).toHaveBeenCalledWith('leader', 's1', 'message', expect.stringContaining('crashed (reason: ProcessExited)'));
    expect(setStatus).toHaveBeenCalledWith('s1', 'failed', 'ProcessExited');
    expect(notifyWake).toHaveBeenCalledWith('leader', 'crash_notification');
  });

  it('Unknown reason testament includes the message and last message', () => {
    const cr = makeCr(makeMember('teammate', 'Al'));
    cr.handleCrash('s1', { kind: 'Unknown', msg: 'weird error' }, 'last user text');
    const content = writeMail.mock.calls[0][3] as string;
    expect(content).toContain('weird error');
    expect(content).toContain('last user text');
  });

  it('leader crash: no testament, returns null (team stalls for the user)', () => {
    const cr = makeCr(makeMember('lead', 'Boss'));
    const result = cr.handleCrash('leader', { kind: 'ProcessExited', msg: 'process exited' });
    expect(result).toBeNull();
    expect(writeMail).not.toHaveBeenCalled();
    expect(notifyWake).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith('leader', 'failed', expect.any(String));
  });
});
