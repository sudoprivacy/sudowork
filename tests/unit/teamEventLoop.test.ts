import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventLoop } from '@process/services/team/EventLoop';
import { TeamRunManager } from '@process/services/team/TeamRun';
import { SlotWakeGate } from '@process/services/team/SlotWakeGate';
import type { TeamMember } from '@process/services/team/TeamStore';
import type { WakeSource } from '@process/services/team/WakeSource';

const h = vi.hoisted(() => ({
  mutate: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  runTransaction: vi.fn(),
  addMessage: vi.fn(),
  insertMessageIfNotExists: vi.fn(() => ({ success: true, inserted: true })),
  emitStatus: vi.fn(),
  emitTeammate: vi.fn(),
  emitUserContent: vi.fn(),
  agentSend: vi.fn(),
  onWakeSlot: vi.fn(),
}));

vi.mock('@process/database', () => ({
  getDatabase: () => ({ mutate: h.mutate, query: h.query, queryOne: h.queryOne, runTransaction: h.runTransaction, insertMessageIfNotExists: h.insertMessageIfNotExists }),
}));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/message', () => ({ addMessage: h.addMessage }));
vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      onAgentStatusChanged: { emit: h.emitStatus },
      onTeammateMessage: { emit: h.emitTeammate },
      onRunAccepted: { emit: vi.fn() },
      onRunStarted: { emit: vi.fn() },
      onRunUpdated: { emit: vi.fn() },
      onRunCompleted: { emit: vi.fn() },
      onRunCancelled: { emit: vi.fn() },
      onRunFailed: { emit: vi.fn() },
      onChildTurnStarted: { emit: vi.fn() },
      onChildTurnCompleted: { emit: vi.fn() },
      onChildTurnCancelled: { emit: vi.fn() },
    },
    acpConversation: {
      responseStream: { emit: h.emitUserContent },
    },
  },
}));

interface MailboxRow {
  id: string;
  team_id: string;
  to_member_id: string;
  from_member_id: string;
  type: 'message' | 'idle_notification' | 'shutdown_request';
  content: string;
  summary: string | null;
  files: string | null;
  read: number;
  created_at: number;
}

function row(o: Partial<MailboxRow>): MailboxRow {
  return {
    id: 'm1',
    team_id: 't1',
    to_member_id: 's1',
    from_member_id: 'user',
    type: 'message',
    content: 'hello',
    summary: null,
    files: null,
    read: 0,
    created_at: 1,
    ...o,
  };
}

function makeMember(o: Partial<TeamMember>): TeamMember {
  return {
    id: 's1',
    team_id: 't1',
    role: 'teammate',
    name: 'Al',
    assistant_id: null,
    backend: 'scode',
    preset_agent_type: 'scode',
    skills: [],
    preset_context: null,
    model: null,
    avatar: null,
    conversation_id: 'c1',
    status: 'idle',
    created_at: 1,
    ...o,
  };
}

// teamStore.updateMember/getMember call queryOne with a team_members SELECT first;
// messageExistsByMsgId calls queryOne on the messages table. Dispatch by SQL so
// updateMember finds its member (otherwise it throws "Team member not found").
const MEMBER_ROW = {
  id: 's1',
  team_id: 't1',
  role: 'teammate',
  name: 'Al',
  assistant_id: null,
  backend: 'scode',
  preset_agent_type: 'scode',
  skills: '[]',
  preset_context: null,
  model: null,
  avatar: null,
  conversation_id: 'c1',
  status: 'idle',
  created_at: 1,
};

let queue: MailboxRow[] = [];
const loops: EventLoop[] = [];

type AgentLike = { sendMessage: (data: { content: string; msg_id: string }) => Promise<unknown>; getLastTurnProseText?: () => string };

function buildLoop(member: TeamMember, agent: AgentLike, leaderSlotId: () => string | null = () => 'leader'): { loop: EventLoop; teamRun: TeamRunManager } {
  const wakeGate = new SlotWakeGate();
  const teamRun = new TeamRunManager('t1', wakeGate);
  const loop = new EventLoop({
    teamId: 't1',
    slotId: member.id,
    member,
    getAgent: () => agent,
    wakeGate,
    teamRun,
    leaderSlotId,
    onWakeSlot: h.onWakeSlot,
    lookupMember: (sid) => (sid === 'sender' ? { ...member, id: 'sender', name: 'Sender', role: 'teammate', conversation_id: 'c-sender' } : null),
  });
  loops.push(loop);
  return { loop, teamRun };
}

/** Seed an active run + pending wake for a slot (mirrors TeamService.sendMessage lease→commit). */
function seedWake(teamRun: TeamRunManager, slotId: string, role: 'lead' | 'teammate', source: WakeSource = 'user_message'): void {
  const { lease } = teamRun.acquireWake(slotId, role, source);
  teamRun.commitLease(lease.lease_id, { slot_id: slotId, role, source, message_id: null });
}

function markReadCalls(): unknown[][] {
  return h.mutate.mock.calls.filter((c) => typeof c[0] === 'string' && (c[0] as string).includes('read = 1'));
}

function insertMailWithType(type: string): unknown[][] {
  return h.mutate.mock.calls.filter((c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO team_mailbox') && c.includes(type));
}

async function flush(ms = 20): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
  queue = [];
  h.mutate.mockReset();
  h.query.mockReset();
  h.queryOne.mockReset();
  h.runTransaction.mockReset();
  h.addMessage.mockReset();
  h.insertMessageIfNotExists.mockReset();
  h.insertMessageIfNotExists.mockReturnValue({ success: true, inserted: true });
  h.emitStatus.mockReset();
  h.emitTeammate.mockReset();
  h.emitUserContent.mockReset();
  h.agentSend.mockReset();
  h.onWakeSlot.mockReset();

  h.query.mockImplementation(() => ({ success: true, data: [...queue] }));
  h.queryOne.mockImplementation((sql: string) => {
    if (typeof sql === 'string' && sql.includes('FROM team_members')) return { success: true, data: { ...MEMBER_ROW } };
    return { success: true, data: null }; // messageExistsByMsgId → not projected yet
  });
  h.mutate.mockImplementation((sql: string, ...args: unknown[]) => {
    if (typeof sql === 'string' && sql.includes('read = 1')) {
      const ids = args.filter((a): a is string => typeof a === 'string');
      queue = queue.filter((r) => !ids.includes(r.id));
    }
    return { success: true, data: 1 };
  });
  h.agentSend.mockResolvedValue({ success: true });
});

afterEach(async () => {
  for (const l of loops) await l.stop();
  loops.length = 0;
});

describe('EventLoop turn driving (附录 I.5)', () => {
  it('processes a user message: drives the agent and marks the mailbox read', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend };
    const { loop, teamRun } = buildLoop(makeMember({ id: 's1', role: 'teammate' }), agent);
    seedWake(teamRun, 's1', 'teammate');
    queue.push(row({ from_member_id: 'user', content: 'do the thing' }));

    loop.start();
    loop.notifyWake();
    await flush();

    expect(h.agentSend).toHaveBeenCalledTimes(1);
    expect((h.agentSend.mock.calls[0][0] as { content: string }).content).toBe('do the thing');
    expect(markReadCalls()).toHaveLength(1);
    expect(h.emitStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
    expect(h.emitStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'idle' }));
  });

  it('marks read on Ok/Failed (agent resolves) but NOT on Err (agent rejects)', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend };
    const { loop, teamRun } = buildLoop(makeMember({ id: 's1', role: 'teammate' }), agent);
    h.agentSend.mockRejectedValueOnce(new Error('boom'));
    seedWake(teamRun, 's1', 'teammate');
    queue.push(row({ id: 'm-err', from_member_id: 'user', content: 'x' }));

    loop.start();
    loop.notifyWake();
    await flush();

    expect(h.agentSend).toHaveBeenCalledTimes(1);
    expect(markReadCalls()).toHaveLength(0); // Err → stays unread, reservation retried
  });

  it('filters self-addressed mailbox (no self-wake)', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend };
    const { loop, teamRun } = buildLoop(makeMember({ id: 's1' }), agent);
    seedWake(teamRun, 's1', 'teammate');
    queue.push(row({ from_member_id: 's1', content: 'echo' })); // from self

    loop.start();
    loop.notifyWake();
    await flush();

    expect(h.agentSend).not.toHaveBeenCalled();
  });

  it('teammate mirrors incoming teammate messages as left bubbles (deduped) and skips idle', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend };
    const { loop, teamRun } = buildLoop(makeMember({ id: 's1', role: 'teammate' }), agent);
    seedWake(teamRun, 's1', 'teammate', 'mcp_send_message');
    queue.push(row({ id: 'm-tm', from_member_id: 'sender', content: 'please review' }));

    loop.start();
    loop.notifyWake();
    await flush();

    expect(h.insertMessageIfNotExists).toHaveBeenCalledTimes(1);
    const [projected] = h.insertMessageIfNotExists.mock.calls[0] as [{ position: string; content: { teammateMessage: boolean; content: string } }];
    expect(projected.position).toBe('left');
    expect(projected.content.teammateMessage).toBe(true);
    expect(projected.content.content).toBe('please review');
  });

  it('mirrors user messages as right bubbles with real-time emit', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend };
    const { loop, teamRun } = buildLoop(makeMember({ id: 's1', role: 'teammate' }), agent);
    seedWake(teamRun, 's1', 'teammate', 'mcp_send_message');
    queue.push(row({ id: 'm-user', from_member_id: 'user', content: 'hello team' }));

    loop.start();
    loop.notifyWake();
    await flush();

    expect(h.insertMessageIfNotExists).toHaveBeenCalledTimes(1);
    const [projected] = h.insertMessageIfNotExists.mock.calls[0] as [{ position: string; msg_id: string; content: { content: string } }];
    expect(projected.position).toBe('right');
    expect(projected.msg_id).toBe('team:t1:mailbox:m-user:conversation:c1');
    expect(projected.content.content).toBe('hello team');
    expect(h.emitUserContent).toHaveBeenCalledWith(expect.objectContaining({ type: 'user_content', conversation_id: 'c1', msg_id: 'team:t1:mailbox:m-user:conversation:c1' }));
  });

  it('teammate writes an idle_notification to the leader and wakes it after a turn', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend };
    const { loop, teamRun } = buildLoop(makeMember({ id: 's1', role: 'teammate', name: 'Al' }), agent);
    seedWake(teamRun, 's1', 'teammate');
    queue.push(row({ from_member_id: 'user', content: 'go' }));

    loop.start();
    loop.notifyWake();
    await flush();

    expect(insertMailWithType('idle_notification')).toHaveLength(1);
    expect(h.onWakeSlot).toHaveBeenCalledWith('leader', 'idle_notification', expect.any(String));
  });

  it('leader does not self-wake: no idle_notification, no wake after a turn', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend };
    const { loop, teamRun } = buildLoop(makeMember({ id: 'leader', role: 'lead', name: 'Boss' }), agent);
    seedWake(teamRun, 'leader', 'lead');
    queue.push(row({ id: 'm-l', to_member_id: 'leader', from_member_id: 'user', content: 'hi' }));

    loop.start();
    loop.notifyWake();
    await flush();

    expect(insertMailWithType('idle_notification')).toHaveLength(0);
    expect(h.onWakeSlot).not.toHaveBeenCalled();
  });

  it('teammate skips idle_notification when leaderSlotId is null (no leader)', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend };
    const { loop, teamRun } = buildLoop(makeMember({ id: 's1', role: 'teammate', name: 'Al' }), agent, () => null);
    seedWake(teamRun, 's1', 'teammate');
    queue.push(row({ from_member_id: 'user', content: 'go' }));

    loop.start();
    loop.notifyWake();
    await flush();

    expect(insertMailWithType('idle_notification')).toHaveLength(0);
    expect(h.onWakeSlot).not.toHaveBeenCalled();
    expect(h.emitStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'idle' }));
  });

  it('retries the turn after a sendMessage rejection via backoff self-wake', async () => {
    vi.useFakeTimers();
    try {
      const agent: AgentLike = { sendMessage: h.agentSend };
      const { loop, teamRun } = buildLoop(makeMember({ id: 's1', role: 'teammate' }), agent);
      h.agentSend.mockRejectedValueOnce(new Error('boom'));
      seedWake(teamRun, 's1', 'teammate');
      queue.push(row({ id: 'm-err', from_member_id: 'user', content: 'x' }));

      loop.start();
      loop.notifyWake();
      await vi.advanceTimersByTimeAsync(20);

      expect(h.agentSend).toHaveBeenCalledTimes(1);
      expect(markReadCalls()).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1000);
      expect(h.agentSend).toHaveBeenCalledTimes(2);
      expect(markReadCalls()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('EventLoop orphan guard + busy serialization', () => {
  it('orphan guard: unread backlog with no active run and no pending wake is not delivered', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend };
    const { loop } = buildLoop(makeMember({ id: 's1', role: 'teammate' }), agent);
    // NOTE: no seedWake → no active run, no pending wake → orphan
    queue.push(row({ from_member_id: 'user', content: 'orphan' }));

    loop.start();
    loop.notifyWake();
    await flush();

    expect(h.agentSend).not.toHaveBeenCalled();
  });

  it('stop resolves after timeout when sendMessage never settles', async () => {
    vi.useFakeTimers();
    try {
      const agent: AgentLike = { sendMessage: h.agentSend };
      const { loop, teamRun } = buildLoop(makeMember({ id: 's1', role: 'teammate' }), agent);
      h.agentSend.mockReturnValue(new Promise(() => undefined));
      seedWake(teamRun, 's1', 'teammate');
      queue.push(row({ id: 'm-never', from_member_id: 'user', content: 'hang' }));

      loop.start();
      loop.notifyWake();
      await vi.advanceTimersByTimeAsync(1);
      expect(h.agentSend).toHaveBeenCalledTimes(1);

      const stopPromise = loop.stop();
      await vi.advanceTimersByTimeAsync(3000);
      await expect(stopPromise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not mutate mailbox or run state when sendMessage resolves after stop', async () => {
    let resolveSend!: () => void;
    const sendPromise = new Promise<void>((resolve) => {
      resolveSend = resolve;
    });
    const agent: AgentLike = { sendMessage: h.agentSend };
    const { loop, teamRun } = buildLoop(makeMember({ id: 's1', role: 'teammate' }), agent);
    h.agentSend.mockReturnValue(sendPromise);
    seedWake(teamRun, 's1', 'teammate');
    queue.push(row({ id: 'm-stale', from_member_id: 'user', content: 'late' }));

    loop.start();
    loop.notifyWake();
    await flush();
    expect(h.agentSend).toHaveBeenCalledTimes(1);

    const stopPromise = loop.stop();
    resolveSend();
    await stopPromise;
    await flush();

    expect(markReadCalls()).toHaveLength(0);
    expect(insertMailWithType('idle_notification')).toHaveLength(0);
    expect(teamRun.getRecord()?.active_child_turns.size ?? 0).toBe(0);
  });

  it('does not start a second concurrent turn while one is in flight', async () => {
    let resolveFirst!: () => void;
    const firstTurn = new Promise<void>((r) => {
      resolveFirst = r;
    });
    h.agentSend.mockImplementationOnce(() => firstTurn);
    h.agentSend.mockResolvedValue({ success: true });

    const agent: AgentLike = { sendMessage: h.agentSend };
    const { loop, teamRun } = buildLoop(makeMember({ id: 's1', role: 'teammate' }), agent);
    seedWake(teamRun, 's1', 'teammate');
    queue.push(row({ id: 'm1', from_member_id: 'user', content: 'one' }));

    loop.start();
    loop.notifyWake();
    await flush();
    expect(h.agentSend).toHaveBeenCalledTimes(1); // first turn in flight

    // A second message + wake arrive mid-turn.
    queue.push(row({ id: 'm2', from_member_id: 'user', content: 'two' }));
    seedWake(teamRun, 's1', 'teammate');
    loop.notifyWake();
    await flush();
    expect(h.agentSend).toHaveBeenCalledTimes(1); // still no concurrent turn

    resolveFirst();
    await flush();
    expect(h.agentSend).toHaveBeenCalledTimes(2); // second turn runs serially after the first
  });
});

// INSERT INTO team_mailbox 参数顺序：sql, id, team_id, to_member_id, from_member_id, type, content, …
function insertMails(): Array<{ type: string; content: string; to: string; from: string }> {
  return h.mutate.mock.calls.filter((c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO team_mailbox')).map((c) => ({ type: String(c[5]), content: String(c[6]), to: String(c[3]), from: String(c[4]) }));
}

describe('EventLoop fallback prose reply (finalizeTurn 兜底回传正文)', () => {
  it('未主动回传时兜底投正文 message，且在 idle_notification 之前', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend, getLastTurnProseText: () => '我方认为AI可以取代人类' };
    const { loop, teamRun } = buildLoop(makeMember({ id: 's1', role: 'teammate' }), agent);
    seedWake(teamRun, 's1', 'teammate');
    queue.push(row({ from_member_id: 'user', content: '请立论' }));
    loop.start();
    loop.notifyWake();
    await flush();

    const mails = insertMails();
    const types = mails.map((m) => m.type);
    expect(types).toContain('message');
    expect(types).toContain('idle_notification');
    expect(types.indexOf('message')).toBeLessThan(types.indexOf('idle_notification'));
    const msg = mails.find((m) => m.type === 'message');
    expect(msg?.content).toBe('我方认为AI可以取代人类');
    expect(msg?.to).toBe('leader');
    expect(msg?.from).toBe('s1');
  });

  it('已主动回传（leader mailbox 有 from member 的 message 且 created_at>watermark）则跳过兜底', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend, getLastTurnProseText: () => '正文' };
    const { loop, teamRun } = buildLoop(makeMember({ id: 's1', role: 'teammate' }), agent);
    seedWake(teamRun, 's1', 'teammate');
    queue.push(row({ from_member_id: 'user', content: '请立论' }));
    queue.push(row({ id: 'reply', to_member_id: 'leader', from_member_id: 's1', type: 'message', content: '已主动回传', created_at: 50 }));
    loop.start();
    loop.notifyWake();
    await flush();

    const mails = insertMails();
    expect(mails.some((m) => m.type === 'message')).toBe(false);
    expect(mails.some((m) => m.type === 'idle_notification')).toBe(true);
  });

  it('上一 turn 陈旧 mail（created_at ≤ watermark）不误命中，仍兜底投正文', async () => {
    h.queryOne.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('MAX(created_at)')) return { success: true, data: { maxCreated: 100 } };
      if (sql.includes('FROM team_members')) return { success: true, data: { ...MEMBER_ROW } };
      return { success: true, data: null };
    });
    const agent: AgentLike = { sendMessage: h.agentSend, getLastTurnProseText: () => '正文' };
    const { loop, teamRun } = buildLoop(makeMember({ id: 's1', role: 'teammate' }), agent);
    seedWake(teamRun, 's1', 'teammate');
    queue.push(row({ from_member_id: 'user', content: '请立论' }));
    queue.push(row({ id: 'stale', to_member_id: 'leader', from_member_id: 's1', type: 'message', content: '旧', created_at: 80 }));
    loop.start();
    loop.notifyWake();
    await flush();

    const mails = insertMails();
    expect(mails.some((m) => m.type === 'message')).toBe(true);
  });

  it('prose 为空时不投正文（仍投 idle_notification）', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend, getLastTurnProseText: () => '' };
    const { loop, teamRun } = buildLoop(makeMember({ id: 's1', role: 'teammate' }), agent);
    seedWake(teamRun, 's1', 'teammate');
    queue.push(row({ from_member_id: 'user', content: '请立论' }));
    loop.start();
    loop.notifyWake();
    await flush();

    const mails = insertMails();
    expect(mails.some((m) => m.type === 'message')).toBe(false);
    expect(mails.some((m) => m.type === 'idle_notification')).toBe(true);
  });
});
