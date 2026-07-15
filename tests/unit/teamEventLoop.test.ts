import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventLoop } from '@process/services/team/EventLoop';
import { SlotWakeGate } from '@process/services/team/SlotWakeGate';
import type { TeamMember } from '@process/services/team/TeamStore';

const h = vi.hoisted(() => ({
  mutate: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  runTransaction: vi.fn(),
  addMessage: vi.fn(),
  emitStatus: vi.fn(),
  emitTeammate: vi.fn(),
  agentSend: vi.fn(),
  onWakeSlot: vi.fn(),
}));

vi.mock('@process/database', () => ({
  getDatabase: () => ({ mutate: h.mutate, query: h.query, queryOne: h.queryOne, runTransaction: h.runTransaction }),
}));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/message', () => ({ addMessage: h.addMessage }));
vi.mock('@/common', () => ({
  ipcBridge: { team: { onAgentStatusChanged: { emit: h.emitStatus }, onTeammateMessage: { emit: h.emitTeammate } } },
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

let queue: MailboxRow[] = [];
const loops: EventLoop[] = [];

type AgentLike = { sendMessage: (data: { content: string; msg_id: string }) => Promise<unknown> };
function buildLoopWith(member: TeamMember, agent: AgentLike): EventLoop {
  const wakeGate = new SlotWakeGate();
  const loop = new EventLoop({
    teamId: 't1',
    slotId: member.id,
    member,
    getAgent: () => agent,
    wakeGate,
    leaderSlotId: () => 'leader',
    onWakeSlot: h.onWakeSlot,
    lookupMember: (sid) => (sid === 'sender' ? { ...member, id: 'sender', name: 'Sender', role: 'teammate', conversation_id: 'c-sender' } : null),
  });
  loops.push(loop);
  return loop;
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

// teamStore.updateMember/getMember call queryOne with a team_members SELECT first;
// messageExistsByMsgId calls queryOne on the messages table. Dispatch by SQL so
// updateMember finds its member (otherwise it throws "Team member not found" and
// short-circuits the turn before agent.sendMessage).
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

beforeEach(() => {
  queue = [];
  h.mutate.mockReset();
  h.query.mockReset();
  h.queryOne.mockReset();
  h.runTransaction.mockReset();
  h.addMessage.mockReset();
  h.emitStatus.mockReset();
  h.emitTeammate.mockReset();
  h.agentSend.mockReset();
  h.onWakeSlot.mockReset();

  // peekUnread returns the current queue; markReadBatch removes matched ids from it.
  h.query.mockImplementation(() => ({ success: true, data: [...queue] }));
  h.queryOne.mockImplementation((sql: string) => {
    if (typeof sql === 'string' && sql.includes('FROM team_members')) {
      return { success: true, data: { ...MEMBER_ROW } };
    }
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
    const loop = buildLoopWith(makeMember({ role: 'teammate' }), agent);
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

  it('marks read on Ok + Failed (agent resolves) but NOT on Err (agent rejects)', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend };
    const loop = buildLoopWith(makeMember({ role: 'teammate' }), agent);
    h.agentSend.mockRejectedValueOnce(new Error('boom'));
    queue.push(row({ id: 'm-err', from_member_id: 'user', content: 'x' }));

    loop.start();
    loop.notifyWake();
    await flush();

    expect(h.agentSend).toHaveBeenCalledTimes(1);
    expect(markReadCalls()).toHaveLength(0); // Err → stays unread for re-delivery
  });

  it('filters self-addressed mailbox (no self-wake)', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend };
    const loop = buildLoopWith(makeMember({ id: 's1' }), agent);
    queue.push(row({ from_member_id: 's1', content: 'echo' })); // from self

    loop.start();
    loop.notifyWake();
    await flush();

    expect(h.agentSend).not.toHaveBeenCalled();
  });

  it('teammate mirrors incoming teammate messages as left bubbles (deduped) and skips user/idle', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend };
    const loop = buildLoopWith(makeMember({ id: 's1', role: 'teammate' }), agent);
    queue.push(row({ id: 'm-tm', from_member_id: 'sender', content: 'please review' }));

    loop.start();
    loop.notifyWake();
    await flush();

    // One teammate bubble projected (left), user/idle are not mirrored.
    expect(h.addMessage).toHaveBeenCalledTimes(1);
    const [, projected] = h.addMessage.mock.calls[0] as [string, { position: string; content: { teammateMessage: boolean; content: string } }];
    expect(projected.position).toBe('left');
    expect(projected.content.teammateMessage).toBe(true);
    expect(projected.content.content).toBe('please review');
  });

  it('teammate writes an idle_notification to the leader and wakes it after a turn', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend };
    const loop = buildLoopWith(makeMember({ id: 's1', role: 'teammate', name: 'Al' }), agent);
    queue.push(row({ from_member_id: 'user', content: 'go' }));

    loop.start();
    loop.notifyWake();
    await flush();

    expect(insertMailWithType('idle_notification')).toHaveLength(1);
    expect(h.onWakeSlot).toHaveBeenCalledWith('leader', 'idle_notification');
  });

  it('leader does not self-wake: no idle_notification, no wake after a turn', async () => {
    const agent: AgentLike = { sendMessage: h.agentSend };
    const loop = buildLoopWith(makeMember({ id: 'leader', role: 'lead', name: 'Boss' }), agent);
    queue.push(row({ id: 'm-l', to_member_id: 'leader', from_member_id: 'user', content: 'hi' }));

    loop.start();
    loop.notifyWake();
    await flush();

    expect(insertMailWithType('idle_notification')).toHaveLength(0);
    expect(h.onWakeSlot).not.toHaveBeenCalled();
  });
});

describe('EventLoop busy serialization (附录 I.5 drain)', () => {
  it('does not start a second concurrent turn while one is in flight', async () => {
    let resolveFirst!: () => void;
    const firstTurn = new Promise<void>((r) => {
      resolveFirst = r;
    });
    h.agentSend.mockImplementationOnce(() => firstTurn);
    h.agentSend.mockResolvedValue({ success: true });

    const agent: AgentLike = { sendMessage: h.agentSend };
    const loop = buildLoopWith(makeMember({ id: 's1', role: 'teammate' }), agent);
    queue.push(row({ id: 'm1', from_member_id: 'user', content: 'one' }));

    loop.start();
    loop.notifyWake();
    await flush();

    expect(h.agentSend).toHaveBeenCalledTimes(1); // first turn in flight

    // A second message arrives mid-turn + a wake is signalled.
    queue.push(row({ id: 'm2', from_member_id: 'user', content: 'two' }));
    loop.notifyWake();
    await flush();

    expect(h.agentSend).toHaveBeenCalledTimes(1); // still no concurrent turn

    resolveFirst();
    await flush();

    // After the first turn resolves, the drain picks up the second message serially.
    expect(h.agentSend).toHaveBeenCalledTimes(2);
  });
});
