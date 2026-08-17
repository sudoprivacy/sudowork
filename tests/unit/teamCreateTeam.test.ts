import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/storage';
import type { Team, TeamMail, TeamMember } from '@process/services/team/TeamStore';

const h = vi.hoisted(() => {
  const teams = new Map<string, Team>();
  const members = new Map<string, TeamMember>();
  const mails: TeamMail[] = [];
  const conversations = new Map<string, TChatConversation>();
  const insertedMemberRoles: Array<'lead' | 'teammate'> = [];
  const softDeletedTeams: string[] = [];
  const softDeletedMemberTeams: string[] = [];
  const createConversation = vi.fn();
  const reapConversation = vi.fn();
  const buildConversation = vi.fn(() => ({ kill: vi.fn().mockResolvedValue(undefined) }));
  const insertMail = vi.fn((mail: TeamMail) => mails.push({ ...mail }));
  const notifyWake = vi.fn();

  return {
    teams,
    members,
    mails,
    conversations,
    insertedMemberRoles,
    softDeletedTeams,
    softDeletedMemberTeams,
    createConversation,
    reapConversation,
    buildConversation,
    notifyWake,
    emitListChanged: vi.fn(),
    emitSessionChanged: vi.fn(),
    emitAgentStatusChanged: vi.fn(),
    emitMemberSpawned: vi.fn(),
    emitMemberRemoved: vi.fn(),
    emitRunAccepted: vi.fn(),
    emitRunUpdated: vi.fn(),
    emitRunStarted: vi.fn(),
    emitRunCompleted: vi.fn(),
    emitRunCancelled: vi.fn(),
    emitRunFailed: vi.fn(),
    emitChildTurnStarted: vi.fn(),
    emitChildTurnCompleted: vi.fn(),
    emitChildTurnCancelled: vi.fn(),
    emitMcpStatus: vi.fn(),
    responseStreamOn: vi.fn(() => vi.fn()),
    getInstalledAssistants: vi.fn(() => []),
    getAssistantMeta: vi.fn(() => null),
    getDetectedAgents: vi.fn(() => [
      { backend: 'scode', name: 'Sudo Code', isPreset: true },
      { backend: 'claude', name: 'Claude Code', isPreset: true },
    ]),
    insertMail,
  };
});

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '', getPath: () => '' } }));
vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: { responseStream: { on: h.responseStreamOn } },
    team: {
      onListChanged: { emit: h.emitListChanged },
      onSessionChanged: { emit: h.emitSessionChanged },
      onAgentStatusChanged: { emit: h.emitAgentStatusChanged },
      onMemberSpawned: { emit: h.emitMemberSpawned },
      onMemberRemoved: { emit: h.emitMemberRemoved },
      onMcpStatus: { emit: h.emitMcpStatus },
      onRunAccepted: { emit: h.emitRunAccepted },
      onRunUpdated: { emit: h.emitRunUpdated },
      onRunStarted: { emit: h.emitRunStarted },
      onRunCompleted: { emit: h.emitRunCompleted },
      onRunCancelled: { emit: h.emitRunCancelled },
      onRunFailed: { emit: h.emitRunFailed },
      onChildTurnStarted: { emit: h.emitChildTurnStarted },
      onChildTurnCompleted: { emit: h.emitChildTurnCompleted },
      onChildTurnCancelled: { emit: h.emitChildTurnCancelled },
    },
  },
}));
vi.mock('@process/database', () => ({
  getDatabase: () => ({
    getConversation: (id: string) => ({ success: h.conversations.has(id), data: h.conversations.get(id) ?? null }),
    updateConversation: (id: string, updates: Partial<TChatConversation>) => {
      const existing = h.conversations.get(id);
      if (!existing) return { success: false, error: `Conversation not found: ${id}` };
      const next = {
        ...existing,
        ...updates,
        extra: updates.extra ? { ...existing.extra, ...updates.extra } : existing.extra,
      } as TChatConversation;
      h.conversations.set(id, next);
      return { success: true, data: true };
    },
  }),
}));
vi.mock('@process/WorkerManage', () => ({ default: { buildConversation: h.buildConversation } }));
vi.mock('@/process/AssistantManager', () => ({ assistantManager: { getAssistantMeta: h.getAssistantMeta, getInstalledAssistants: h.getInstalledAssistants } }));
vi.mock('@/agent/acp/AcpDetector', () => ({ acpDetector: { getDetectedAgents: h.getDetectedAgents } }));
vi.mock('@process/services/claudeCli/NodeRuntimeService', () => ({ getNodeBinaryPath: () => 'node' }));
vi.mock('@process/utils/assistantResources', () => ({ readAssistantResource: vi.fn(), ruleFilePattern: /.*/ }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/i18n', () => ({
  default: {
    t: (key: string) =>
      ({
        'team.membership.memberAddedNotice': 'A teammate was added to the team. Call team_members to get the latest roster before delegating work.',
      })[key] ?? key,
  },
  i18nReady: Promise.resolve(),
}));
vi.mock('@process/services/conversationService', () => ({ createConversation: (...args: unknown[]) => h.createConversation(...args) }));
vi.mock('@process/services/conversationReaper', () => ({ reapConversation: (...args: unknown[]) => h.reapConversation(...args), resolveWorkspaceDeletion: vi.fn(() => false) }));
vi.mock('@process/services/team/EventLoop', () => ({
  EventLoop: vi.fn(function EventLoop() {
    return { start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined), notifyWake: h.notifyWake };
  }),
}));
vi.mock('@process/services/team/TeamStore', () => ({
  teamStore: {
    insertTeam: (team: Team) => h.teams.set(team.id, { ...team }),
    updateTeam: (teamId: string, updates: Partial<Team>) => {
      const team = h.teams.get(teamId);
      if (!team) throw new Error(`Team not found: ${teamId}`);
      h.teams.set(teamId, { ...team, ...updates, updated_at: Date.now() });
    },
    getTeam: (teamId: string) => h.teams.get(teamId) ?? null,
    listMembersByTeam: (teamId: string) => [...h.members.values()].filter((member) => member.team_id === teamId),
    insertMember: (member: TeamMember) => {
      h.insertedMemberRoles.push(member.role);
      h.members.set(member.id, { ...member });
    },
    updateMember: (memberId: string, updates: Partial<TeamMember>) => {
      const member = h.members.get(memberId);
      if (!member) throw new Error(`Team member not found: ${memberId}`);
      h.members.set(memberId, { ...member, ...updates });
    },
    markMemberDelegated: (memberId: string) => {
      const member = h.members.get(memberId);
      if (member) h.members.set(memberId, { ...member, isDelegated: true });
    },
    getMember: (memberId: string) => h.members.get(memberId) ?? null,
    insertMail: (mail: TeamMail) => h.insertMail(mail),
    peekUnread: (teamId: string, toMemberId: string) => h.mails.filter((mail) => mail.team_id === teamId && mail.to_member_id === toMemberId && !mail.read),
    markReadBatch: (ids: string[]) => {
      for (const mail of h.mails) {
        if (ids.includes(mail.id)) mail.read = true;
      }
    },
    hasUnread: (teamId: string, toMemberId: string) => h.mails.some((mail) => mail.team_id === teamId && mail.to_member_id === toMemberId && mail.from_member_id !== toMemberId && !mail.read),
    getLatestUserMail: () => null,
    softDeleteMember: (memberId: string) => h.members.delete(memberId),
    hardDeleteMailboxByMember: (memberId: string) => {
      for (let i = h.mails.length - 1; i >= 0; i -= 1) {
        if (h.mails[i].to_member_id === memberId) h.mails.splice(i, 1);
      }
    },
    softDeleteMembersByTeam: (teamId: string) => {
      h.softDeletedMemberTeams.push(teamId);
      for (const [id, member] of h.members) {
        if (member.team_id === teamId) h.members.delete(id);
      }
    },
    softDeleteTeam: (teamId: string) => {
      h.softDeletedTeams.push(teamId);
      h.teams.delete(teamId);
    },
  },
}));

function makeConversation(id: string, extra: TChatConversation['extra']): TChatConversation {
  return {
    id,
    name: id,
    type: 'acp',
    createTime: 1,
    modifyTime: 1,
    extra,
    status: 'finished',
    source: 'sudowork',
  } as TChatConversation;
}

function defaultCreateConversation() {
  h.createConversation.mockImplementation(({ extra }: { extra: TChatConversation['extra'] }) => {
    const id = `conv-${h.createConversation.mock.calls.length}`;
    const conversation = makeConversation(id, { ...extra, workspace: extra?.workspace ?? '/resolved-workspace' });
    h.conversations.set(id, conversation);
    return Promise.resolve({ success: true, conversation });
  });
}

async function importChannelEventBus() {
  // vi.resetModules() in beforeEach re-keys the module registry, so the bus must come from
  // the same dynamic import as TeamService — a static top-level import would hold a stale
  // instance whose emissions never reach the service's subscription.
  const { channelEventBus } = await import('@/channels/agent/ChannelEventBus');
  return channelEventBus;
}

async function importService() {
  const mod = await import('@process/services/team/TeamService');
  const service = mod.teamService as unknown as {
    createTeam: typeof mod.teamService.createTeam;
    spawnMember: typeof mod.teamService.spawnMember;
    removeMember: typeof mod.teamService.removeMember;
    ensureSession: (teamId: string) => Promise<unknown>;
    rebuildTeam: typeof mod.teamService.rebuildTeam;
    dispatchTeamTool: (teamId: string, caller: TeamMember, tool: string, args: Record<string, unknown>) => Promise<{ ok: boolean; data?: any; error?: string }>;
    pauseMember: typeof mod.teamService.pauseMember;
    retryMemberStart: typeof mod.teamService.retryMemberStart;
    terminateSlot: (teamId: string, slotId: string, isLeader: boolean, reason: unknown) => void;
    recordSystemWake: (teamId: string, slotId: string, source: string, messageId?: string | null) => void;
    handleResponseStream: (msg: { conversation_id: string; type: string; data?: unknown }) => void;
    cleanup: () => void;
    sessions: Map<
      string,
      {
        members: Map<string, { member: TeamMember }>;
        teamRun: {
          acquireWake: (slotId: string, role: 'lead' | 'teammate', source: string) => { lease: { lease_id: string } };
          commitLease: (leaseId: string, wake: { slot_id: string; role: 'lead' | 'teammate'; source: string; message_id: string | null }) => void;
          clearSlot: (slotId: string) => void;
          getRecord: () => { status: string; pending_wakes: Map<string, Array<{ source: string }>> } | null;
        };
      }
    >;
    startTeamHttpServer: () => Promise<{ server: { close: (cb?: () => void) => void }; port: number; token: string }>;
  };
  service.startTeamHttpServer = vi.fn().mockResolvedValue({ server: { close: (cb?: () => void) => cb?.() }, port: 12345, token: 'token' });
  await (service as { init: () => Promise<void> }).init();
  return service;
}

function leaderFor(teamId: string): TeamMember {
  const leader = [...h.members.values()].find((member) => member.team_id === teamId && member.role === 'lead');
  if (!leader) throw new Error('missing leader');
  return leader;
}

beforeEach(() => {
  h.teams.clear();
  h.members.clear();
  h.mails.length = 0;
  h.conversations.clear();
  h.insertedMemberRoles.length = 0;
  h.softDeletedTeams.length = 0;
  h.softDeletedMemberTeams.length = 0;
  h.createConversation.mockReset();
  h.reapConversation.mockReset();
  h.buildConversation.mockReset();
  h.buildConversation.mockImplementation(() => ({ kill: vi.fn().mockResolvedValue(undefined) }));
  h.insertMail.mockReset();
  h.insertMail.mockImplementation((mail: TeamMail) => h.mails.push({ ...mail }));
  h.notifyWake.mockClear();
  h.emitListChanged.mockClear();
  h.emitSessionChanged.mockClear();
  h.emitAgentStatusChanged.mockClear();
  h.emitMemberSpawned.mockClear();
  vi.resetModules();
  defaultCreateConversation();
});

afterEach(async () => {
  const { teamService } = await import('@process/services/team/TeamService');
  teamService.cleanup();
});

describe('TeamService createTeam members', () => {
  it('reuses one pending session creation for concurrent ensureSession calls', async () => {
    const service = await importService();
    let resolveServer!: (value: { server: { close: (cb?: () => void) => void }; port: number; token: string }) => void;
    const serverPromise = new Promise<{ server: { close: (cb?: () => void) => void }; port: number; token: string }>((resolve) => {
      resolveServer = resolve;
    });
    service.startTeamHttpServer = vi.fn().mockReturnValue(serverPromise);

    const first = service.ensureSession('team-1');
    const second = service.ensureSession('team-1');
    resolveServer({ server: { close: (cb?: () => void) => cb?.() }, port: 12345, token: 'token' });

    await expect(first).resolves.toBe(await second);
    expect(service.startTeamHttpServer).toHaveBeenCalledTimes(1);
  });

  it('reuses one pending rebuild for concurrent rebuildTeam calls', async () => {
    const service = await importService();
    h.teams.set('team-1', {
      id: 'team-1',
      user_id: 'user-1',
      name: 'Team',
      workspace: '/workspace',
      workspace_kind: 'custom',
      leader_member_id: 'leader-1',
      session_mode: null,
      pinned: false,
      pinned_at: null,
      created_at: 1,
      updated_at: 1,
    });
    h.members.set('leader-1', {
      id: 'leader-1',
      team_id: 'team-1',
      role: 'lead',
      name: 'Leader',
      assistant_id: 'scode',
      source: 'agent',
      backend: 'scode',
      preset_agent_type: null,
      skills: [],
      preset_context: null,
      model: null,
      avatar: null,
      conversation_id: 'conv-1',
      status: 'idle',
      created_at: 1,
    });
    h.conversations.set('conv-1', makeConversation('conv-1', { workspace: '/workspace' }));
    let resolveServer!: (value: { server: { close: (cb?: () => void) => void }; port: number; token: string }) => void;
    const serverPromise = new Promise<{ server: { close: (cb?: () => void) => void }; port: number; token: string }>((resolve) => {
      resolveServer = resolve;
    });
    service.startTeamHttpServer = vi.fn().mockReturnValue(serverPromise);

    const first = service.rebuildTeam('team-1');
    const second = service.rebuildTeam('team-1');
    resolveServer({ server: { close: (cb?: () => void) => cb?.() }, port: 12345, token: 'token' });

    await Promise.all([first, second]);
    expect(service.startTeamHttpServer).toHaveBeenCalledTimes(1);
    expect(h.buildConversation).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid member arrays before inserting a team', async () => {
    const service = await importService();

    await expect(service.createTeam('user-1', 'Team', '/workspace', [])).rejects.toThrow('At least one team member is required');
    await expect(service.createTeam('user-1', 'Team', '/workspace', [{ assistant_id: 'scode', name: 'Worker', role: 'teammate' }])).rejects.toThrow('Exactly one team member must be Leader');
    await expect(
      service.createTeam('user-1', 'Team', '/workspace', [
        { assistant_id: 'scode', name: 'Leader 1', role: 'lead' },
        { assistant_id: 'claude', name: 'Leader 2', role: 'lead' },
      ])
    ).rejects.toThrow('Exactly one team member must be Leader');
    await expect(service.createTeam('user-1', 'Team', '/workspace', [{ assistant_id: ' ', name: 'Leader', role: 'lead' }])).rejects.toThrow('Team member assistant_id is required');
    await expect(service.createTeam('user-1', 'Team', '/workspace', [{ assistant_id: 'scode', name: ' ', role: 'teammate' }])).rejects.toThrow('Team member name is required');
    await expect(
      service.createTeam('user-1', 'Team', '/workspace', [
        { assistant_id: 'scode', name: 'Leader', role: 'lead' },
        { assistant_id: 'claude', name: 'Worker', role: 'member' as 'teammate' },
      ])
    ).rejects.toThrow('Team member role must be lead or teammate');
    expect(h.teams.size).toBe(0);
  });

  it('allows duplicate assistants and more than eight members without runtime attach during create', async () => {
    const service = await importService();
    const members = [{ assistant_id: 'scode', name: 'Leader', role: 'lead' as const }, ...Array.from({ length: 8 }, (_, index) => ({ assistant_id: 'scode', name: `Worker ${index + 1}`, role: 'teammate' as const }))];

    const team = await service.createTeam('user-1', 'Team', '/workspace', members);
    const storedMembers = [...h.members.values()].filter((member) => member.team_id === team.id);

    expect(storedMembers).toHaveLength(9);
    expect(storedMembers.filter((member) => member.assistant_id === 'scode')).toHaveLength(9);
    expect(h.insertedMemberRoles).toEqual(['lead', 'teammate', 'teammate', 'teammate', 'teammate', 'teammate', 'teammate', 'teammate', 'teammate']);
    expect(h.mails).toHaveLength(0);
    expect(h.notifyWake).not.toHaveBeenCalled();
    expect(h.buildConversation).not.toHaveBeenCalled();
    for (const call of h.createConversation.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ skipWorkerRegistration: true }));
    }
    expect(h.emitListChanged).toHaveBeenCalledWith({ team_id: team.id, action: 'created' });
  });

  it('creates the leader first, resolves temporary workspace, then creates teammates with that workspace', async () => {
    const service = await importService();
    const workspaceByConversationCall: Array<string | undefined> = [];
    h.createConversation.mockImplementation(({ extra }: { extra: TChatConversation['extra'] }) => {
      workspaceByConversationCall.push(extra?.workspace);
      const id = `conv-${h.createConversation.mock.calls.length}`;
      const conversation = makeConversation(id, { ...extra, workspace: extra?.workspace ?? '/resolved-workspace' });
      h.conversations.set(id, conversation);
      return Promise.resolve({ success: true, conversation });
    });

    const team = await service.createTeam('user-1', 'Team', null, [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
    ]);

    expect(h.insertedMemberRoles).toEqual(['lead', 'teammate']);
    expect(workspaceByConversationCall).toEqual([undefined, '/resolved-workspace']);
    expect(h.teams.get(team.id)?.workspace).toBe('/resolved-workspace');
    expect(h.teams.get(team.id)?.workspace_kind).toBe('temporary');
  });

  it('createTeam provisions initial members without creating runtime session', async () => {
    const service = await importService();

    await service.createTeam('user-1', 'Team', '/workspace', [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
    ]);

    expect(service.startTeamHttpServer).not.toHaveBeenCalled();
    expect(h.buildConversation).not.toHaveBeenCalled();
    expect(h.createConversation).toHaveBeenCalledTimes(2);
    for (const call of h.createConversation.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ skipWorkerRegistration: true }));
    }
    expect(h.mails).toHaveLength(0);
    expect(h.notifyWake).not.toHaveBeenCalled();
  });

  it('rebuildTeam attaches provisioned initial members', async () => {
    const service = await importService();
    const team = await service.createTeam('user-1', 'Team', '/workspace', [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
    ]);

    await service.rebuildTeam(team.id);

    const storedMembers = [...h.members.values()].filter((member) => member.team_id === team.id);
    expect(service.startTeamHttpServer).toHaveBeenCalledTimes(1);
    expect(h.buildConversation).toHaveBeenCalledTimes(storedMembers.length);
    expect(h.emitSessionChanged).toHaveBeenCalledWith({ teamId: team.id, status: 'ready' });
    for (const call of h.buildConversation.mock.calls) {
      expect(call[0].extra.teamMcpConfig).toEqual(
        expect.objectContaining({
          name: 'team-mcp',
          command: 'node',
          args: expect.any(Array),
          env: expect.arrayContaining([
            { name: 'TEAM_MCP_PORT', value: '12345' },
            { name: 'TEAM_MCP_TOKEN', value: 'token' },
          ]),
        })
      );
    }
    for (const member of storedMembers) {
      expect(h.members.get(member.id)?.status).toBe('idle');
      expect(h.emitAgentStatusChanged).toHaveBeenCalledWith({ team_id: team.id, slot_id: member.id, status: 'idle' });
    }
  });

  it('team_members roster includes assistant_id and is_delegated', async () => {
    const service = await importService();
    const team = await service.createTeam('user-1', 'Team', '/workspace', [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
    ]);
    await service.rebuildTeam(team.id);

    const result = await service.dispatchTeamTool(team.id, leaderFor(team.id), 'team_members', {});
    expect(result.ok).toBe(true);
    const members = result.data?.members ?? [];
    expect(members).toHaveLength(2);
    for (const entry of members) {
      expect(entry).toHaveProperty('assistant_id');
      expect(entry).toHaveProperty('is_delegated');
    }
    expect(members.find((entry) => entry.role === 'teammate')?.assistant_id).toBe('claude');
    // Before any delegation, every teammate's is_delegated is false — the first-task signal.
    for (const entry of members) {
      expect(entry.is_delegated).toBe(false);
    }
  });

  it('bootstrap attach failure marks failed without waking leader and stops session', async () => {
    const service = await importService();
    const team = await service.createTeam('user-1', 'Team', '/workspace', [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
    ]);
    h.buildConversation.mockReturnValue(null);

    await service.rebuildTeam(team.id);

    const leader = leaderFor(team.id);
    expect(h.members.get(leader.id)?.status).toBe('failed');
    expect(h.emitAgentStatusChanged).toHaveBeenCalledWith({ team_id: team.id, slot_id: leader.id, status: 'failed', last_message: 'attach failed' });
    expect(h.emitSessionChanged).toHaveBeenCalledWith(expect.objectContaining({ teamId: team.id, status: 'ready' }));
    expect(h.mails).toHaveLength(0);
    expect(h.notifyWake).not.toHaveBeenCalled();
    expect(service.sessions.has(team.id)).toBe(true);
  });

  it('bootstrap missing conversation fails warmup and stops session', async () => {
    const service = await importService();
    const team = await service.createTeam('user-1', 'Team', '/workspace', [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
    ]);
    const leader = leaderFor(team.id);
    if (!leader.conversation_id) throw new Error('missing leader conversation');
    h.conversations.delete(leader.conversation_id);

    await service.rebuildTeam(team.id);

    expect(h.emitSessionChanged).toHaveBeenCalledWith(expect.objectContaining({ teamId: team.id, status: 'ready' }));
    expect(h.members.get(leader.id)?.status).toBe('failed');
    expect(service.sessions.has(team.id)).toBe(true);
  });

  it('spawnMember returns after pending persistence and completes runtime later', async () => {
    vi.useFakeTimers();
    try {
      const service = await importService();
      const team = await service.createTeam('user-1', 'Team', '/workspace', [{ assistant_id: 'scode', name: 'Leader', role: 'lead' }]);
      await service.rebuildTeam(team.id);
      const leader = leaderFor(team.id);
      h.mails.length = 0;
      h.buildConversation.mockClear();
      h.emitAgentStatusChanged.mockClear();
      h.emitMemberSpawned.mockClear();
      h.notifyWake.mockClear();

      const teammate = await service.spawnMember(team.id, { assistant_id: 'claude', name: 'Worker', role: 'teammate', model: 'model-1' });
      const spawnCall = h.createConversation.mock.calls.at(-1)?.[0] as { skipWorkerRegistration?: boolean };

      expect(teammate.role).toBe('teammate');
      expect(teammate.status).toBe('pending');
      expect(spawnCall.skipWorkerRegistration).toBe(true);
      expect(h.emitMemberSpawned).toHaveBeenCalledTimes(1);
      expect(h.emitMemberSpawned).toHaveBeenCalledWith({ team_id: team.id, member: expect.objectContaining({ id: teammate.id, status: 'pending' }) });
      expect(h.buildConversation).not.toHaveBeenCalled();
      expect(h.members.get(teammate.id)?.status).toBe('pending');

      await vi.runOnlyPendingTimersAsync();

      const notice = h.mails.find((mail) => mail.to_member_id === leader.id && mail.from_member_id === teammate.id);
      const record = service.sessions.get(team.id)?.teamRun.getRecord();

      expect(h.members.get(teammate.id)?.status).toBe('idle');
      expect(service.sessions.get(team.id)?.members.get(teammate.id)?.member.status).toBe('idle');
      expect(h.emitAgentStatusChanged).toHaveBeenCalledWith({ team_id: team.id, slot_id: teammate.id, status: 'idle' });
      expect(notice?.content).toContain('A teammate was added to the team');
      expect(notice?.content).toContain(`slot_id=${teammate.id}`);
      expect(notice?.content).toContain('assistant_id=claude');
      expect(record?.pending_wakes.get(leader.id)?.some((wake) => wake.source === 'team_membership_changed')).toBe(true);
      expect(h.emitMemberSpawned).toHaveBeenCalledTimes(1);
    } finally {
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });

  it('spawnMember marks the member failed when dynamic attach fails', async () => {
    vi.useFakeTimers();
    try {
      const service = await importService();
      const team = await service.createTeam('user-1', 'Team', '/workspace', [{ assistant_id: 'scode', name: 'Leader', role: 'lead' }]);
      await service.rebuildTeam(team.id);
      h.buildConversation.mockClear();
      h.buildConversation.mockReturnValue(null);
      h.emitMemberSpawned.mockClear();
      h.emitAgentStatusChanged.mockClear();

      const teammate = await service.spawnMember(team.id, { assistant_id: 'claude', name: 'Worker', role: 'teammate', notifyLeaderOnSpawn: false });

      expect(h.emitMemberSpawned).toHaveBeenCalledTimes(1);
      await vi.runOnlyPendingTimersAsync();

      expect(h.emitMemberSpawned).toHaveBeenCalledTimes(1);
      expect(h.members.get(teammate.id)?.status).toBe('failed');
      expect(h.emitAgentStatusChanged).toHaveBeenCalledWith(expect.objectContaining({ team_id: team.id, slot_id: teammate.id, status: 'failed' }));
    } finally {
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });

  it('spawnMember keeps the member when leader membership notice fails', async () => {
    vi.useFakeTimers();
    try {
      const service = await importService();
      const team = await service.createTeam('user-1', 'Team', '/workspace', [{ assistant_id: 'scode', name: 'Leader', role: 'lead' }]);
      await service.rebuildTeam(team.id);
      const leader = leaderFor(team.id);
      h.emitMemberRemoved.mockClear();
      h.insertMail.mockImplementation((mail: TeamMail) => {
        if (mail.to_member_id === leader.id && mail.from_member_id !== 'user') throw new Error('notice failed');
        h.mails.push({ ...mail });
      });

      const teammate = await service.spawnMember(team.id, { assistant_id: 'claude', name: 'Worker', role: 'teammate' });

      await vi.runOnlyPendingTimersAsync();

      expect(h.members.has(teammate.id)).toBe(true);
      expect(h.members.get(teammate.id)?.status).toBe('idle');
      expect(h.emitMemberRemoved).not.toHaveBeenCalledWith({ team_id: team.id, slot_id: teammate.id });
    } finally {
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });

  it('spawnMember post-create runtime stops when the pending member is removed', async () => {
    vi.useFakeTimers();
    try {
      const service = await importService();
      const team = await service.createTeam('user-1', 'Team', '/workspace', [{ assistant_id: 'scode', name: 'Leader', role: 'lead' }]);
      await service.rebuildTeam(team.id);
      h.emitAgentStatusChanged.mockClear();
      h.insertMail.mockClear();

      const teammate = await service.spawnMember(team.id, { assistant_id: 'claude', name: 'Worker', role: 'teammate' });
      await service.removeMember(team.id, teammate.id);
      await vi.runOnlyPendingTimersAsync();

      expect(h.members.has(teammate.id)).toBe(false);
      expect(h.emitAgentStatusChanged).not.toHaveBeenCalledWith({ team_id: team.id, slot_id: teammate.id, status: 'idle' });
      expect(h.insertMail).not.toHaveBeenCalled();
    } finally {
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });

  it('rolls back the whole team when a teammate fails during initial creation', async () => {
    const service = await importService();
    h.createConversation.mockImplementation(({ extra }: { extra: TChatConversation['extra'] }) => {
      if (h.createConversation.mock.calls.length > 1) return Promise.resolve({ success: false, error: 'teammate failed' });
      const conversation = makeConversation('conv-leader', { ...extra, workspace: extra?.workspace ?? '/resolved-workspace' });
      h.conversations.set(conversation.id, conversation);
      return Promise.resolve({ success: true, conversation });
    });

    await expect(
      service.createTeam('user-1', 'Team', '/workspace', [
        { assistant_id: 'scode', name: 'Leader', role: 'lead' },
        { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
      ])
    ).rejects.toThrow('teammate failed');

    expect(h.teams.size).toBe(0);
    expect(h.members.size).toBe(0);
    expect(h.softDeletedTeams).toHaveLength(1);
    expect(h.softDeletedMemberTeams).toHaveLength(1);
    expect(h.reapConversation).toHaveBeenCalledWith('conv-leader', { reason: 'team-spawn-rollback', deleteWorkspace: false });
  });

  // ---- spawn (toolSpawnAgent): gate removed; is_delegated now backs the first-task signal ----

  it('team_spawn_agent is allowed even while a pre-selected teammate is untried (gate removed)', async () => {
    vi.useFakeTimers();
    try {
      const service = await importService();
      const team = await service.createTeam('user-1', 'Team', '/workspace', [
        { assistant_id: 'scode', name: 'Leader', role: 'lead' },
        { assistant_id: 'claude', name: 'PresetWorker', role: 'teammate' },
      ]);
      await service.rebuildTeam(team.id);
      const leader = leaderFor(team.id);

      const result = await service.dispatchTeamTool(team.id, leader, 'team_spawn_agent', {
        name: 'Debater',
        assistant_id: 'claude',
        role: 'teammate',
      });

      expect(result.ok).toBe(true);
      await vi.runOnlyPendingTimersAsync();
    } finally {
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });

  it('leader delegation marks the teammate is_delegated (first-task signal) and spawn is allowed', async () => {
    vi.useFakeTimers();
    try {
      const service = await importService();
      const team = await service.createTeam('user-1', 'Team', '/workspace', [
        { assistant_id: 'scode', name: 'Leader', role: 'lead' },
        { assistant_id: 'claude', name: 'PresetWorker', role: 'teammate' },
      ]);
      await service.rebuildTeam(team.id);
      const leader = leaderFor(team.id);
      const teammate = [...h.members.values()].find((m) => m.role === 'teammate')!;

      const delegated = await service.dispatchTeamTool(team.id, leader, 'team_send_message', { to: teammate.id, message: 'Argue the pro side.' });
      expect(delegated.ok).toBe(true);
      expect(h.members.get(teammate.id)?.isDelegated).toBe(true);

      const spawn = await service.dispatchTeamTool(team.id, leader, 'team_spawn_agent', {
        name: 'Debater',
        assistant_id: 'claude',
        role: 'teammate',
      });
      expect(spawn.ok).toBe(true);
      await vi.runOnlyPendingTimersAsync();
    } finally {
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });

  it('team_send_message broadcast does not mark teammates is_delegated', async () => {
    vi.useFakeTimers();
    try {
      const service = await importService();
      const team = await service.createTeam('user-1', 'Team', '/workspace', [
        { assistant_id: 'scode', name: 'Leader', role: 'lead' },
        { assistant_id: 'claude', name: 'PresetWorker', role: 'teammate' },
      ]);
      await service.rebuildTeam(team.id);
      const leader = leaderFor(team.id);
      const teammate = [...h.members.values()].find((m) => m.role === 'teammate')!;

      const broadcast = await service.dispatchTeamTool(team.id, leader, 'team_send_message', { to: '*', message: 'Heads up' });
      expect(broadcast.ok).toBe(true);
      expect(h.members.get(teammate.id)?.isDelegated).toBe(false);

      const spawn = await service.dispatchTeamTool(team.id, leader, 'team_spawn_agent', {
        name: 'Debater',
        assistant_id: 'claude',
        role: 'teammate',
      });
      expect(spawn.ok).toBe(true);
      await vi.runOnlyPendingTimersAsync();
    } finally {
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });

  it('team_send_message excludes failed broadcast targets but keeps pending targets', async () => {
    const service = await importService();
    const team = await service.createTeam('user-1', 'Team', '/workspace', [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'claude', name: 'FailedWorker', role: 'teammate' },
      { assistant_id: 'claude', name: 'PendingWorker', role: 'teammate' },
    ]);
    await service.rebuildTeam(team.id);
    const leader = leaderFor(team.id);
    const teammates = [...h.members.values()].filter((m) => m.role === 'teammate');
    const failed = teammates[0];
    const pending = teammates[1];
    h.members.set(failed.id, { ...failed, status: 'failed' });
    h.members.set(pending.id, { ...pending, status: 'pending' });

    const result = await service.dispatchTeamTool(team.id, leader, 'team_send_message', { to: '*', message: 'Heads up' });

    expect(result).toMatchObject({ ok: true, data: { targets: [pending.id] } });
    expect(h.mails.some((mail) => mail.to_member_id === failed.id)).toBe(false);
    expect(h.mails.some((mail) => mail.to_member_id === pending.id)).toBe(true);
  });

  it('team_send_message and team_shutdown_agent reject failed direct targets', async () => {
    const service = await importService();
    const team = await service.createTeam('user-1', 'Team', '/workspace', [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'claude', name: 'FailedWorker', role: 'teammate' },
    ]);
    await service.rebuildTeam(team.id);
    const leader = leaderFor(team.id);
    const teammate = [...h.members.values()].find((m) => m.role === 'teammate')!;
    h.members.set(teammate.id, { ...teammate, status: 'failed' });

    const send = await service.dispatchTeamTool(team.id, leader, 'team_send_message', { to: teammate.id, message: 'Ping' });
    const shutdown = await service.dispatchTeamTool(team.id, leader, 'team_shutdown_agent', { slot_id: teammate.id });

    expect(send).toMatchObject({ ok: false, error: expect.stringContaining('has failed') });
    expect(shutdown).toMatchObject({ ok: false, error: expect.stringContaining('has failed') });
  });

  it('team_spawn_agent is allowed regardless of pre-selected teammate state (gate removed)', async () => {
    vi.useFakeTimers();
    try {
      const service = await importService();
      const team = await service.createTeam('user-1', 'Team', '/workspace', [
        { assistant_id: 'scode', name: 'Leader', role: 'lead' },
        { assistant_id: 'claude', name: 'PresetWorker', role: 'teammate' },
      ]);
      await service.rebuildTeam(team.id);
      const leader = leaderFor(team.id);
      const teammate = [...h.members.values()].find((m) => m.role === 'teammate')!;
      h.members.set(teammate.id, { ...teammate, status: 'failed' });

      const spawn = await service.dispatchTeamTool(team.id, leader, 'team_spawn_agent', {
        name: 'Debater',
        assistant_id: 'claude',
        role: 'teammate',
      });
      expect(spawn.ok).toBe(true);
      await vi.runOnlyPendingTimersAsync();
    } finally {
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });

  it('team_spawn_agent spawns teammates without gating (is_preset false for spawned)', async () => {
    vi.useFakeTimers();
    try {
      const service = await importService();
      const team = await service.createTeam('user-1', 'Team', '/workspace', [{ assistant_id: 'scode', name: 'Leader', role: 'lead' }]);
      await service.rebuildTeam(team.id);
      const leader = leaderFor(team.id);

      const first = await service.dispatchTeamTool(team.id, leader, 'team_spawn_agent', {
        name: 'Debater',
        assistant_id: 'claude',
        role: 'teammate',
      });
      expect(first.ok).toBe(true);
      await vi.runOnlyPendingTimersAsync();
      const spawned = [...h.members.values()].find((m) => m.role === 'teammate');
      expect(spawned?.isPreset).toBe(false);

      const second = await service.dispatchTeamTool(team.id, leader, 'team_spawn_agent', {
        name: 'Judge',
        assistant_id: 'claude',
        role: 'teammate',
      });
      expect(second.ok).toBe(true);
      await vi.runOnlyPendingTimersAsync();
    } finally {
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });

  it('terminateSlot kills and unregisters a crashed teammate runtime', async () => {
    const service = await importService();
    const team = await service.createTeam('user-1', 'Team', '/workspace', [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
    ]);
    await service.rebuildTeam(team.id);
    const teammate = [...h.members.values()].find((m) => m.role === 'teammate')!;
    const runtime = service.sessions.get(team.id)?.members.get(teammate.id) as { agent: { kill: ReturnType<typeof vi.fn> } };

    service.terminateSlot(team.id, teammate.id, false, { kind: 'Unknown', msg: 'disconnected' });

    expect(runtime.agent.kill).toHaveBeenCalledTimes(1);
    expect(service.sessions.get(team.id)?.members.has(teammate.id)).toBe(false);
    expect(h.members.get(teammate.id)?.status).toBe('failed');
    expect(h.mails.some((mail) => mail.from_member_id === teammate.id && mail.to_member_id === leaderFor(team.id).id)).toBe(true);
  });

  it('rate-limit stream errors unregister the runtime instead of leaving a zombie member', async () => {
    const service = await importService();
    const team = await service.createTeam('user-1', 'Team', '/workspace', [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
    ]);
    await service.rebuildTeam(team.id);
    const teammate = [...h.members.values()].find((m) => m.role === 'teammate')!;
    const runtime = service.sessions.get(team.id)?.members.get(teammate.id) as { agent: { kill: ReturnType<typeof vi.fn> } };

    service.handleResponseStream({ conversation_id: teammate.conversation_id!, type: 'error', data: { error: '429 rate limit' } });

    expect(runtime.agent.kill).toHaveBeenCalledTimes(1);
    expect(service.sessions.get(team.id)?.members.has(teammate.id)).toBe(false);
    expect(h.members.get(teammate.id)?.status).toBe('failed');
  });

  it('channelEventBus stream events reset the watchdog instead of letting it fire at arm+60s', async () => {
    vi.useFakeTimers();
    try {
      const service = await importService();
      const channelEventBus = await importChannelEventBus();
      const team = await service.createTeam('user-1', 'Team', '/workspace', [
        { assistant_id: 'scode', name: 'Leader', role: 'lead' },
        { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
      ]);
      await service.rebuildTeam(team.id);
      const teammate = [...h.members.values()].find((m) => m.role === 'teammate')!;
      const session = service.sessions.get(team.id) as unknown as {
        crashRecovery: { armWakeTimeout: (slot: string) => void; disarmWakeTimeout: (slot: string) => void };
        members: Map<string, { agent: { kill: ReturnType<typeof vi.fn> } }>;
      };
      const runtime = session.members.get(teammate.id)!;
      runtime.agent.kill.mockClear();

      session.crashRecovery.armWakeTimeout(teammate.id);
      // A stream event arriving via channelEventBus (the in-main path AcpAgent dual-emits to)
      // must reset the watchdog timer: advancing 60s after the event does NOT fire the timeout.
      channelEventBus.emitAgentMessage(teammate.conversation_id!, { type: 'content', data: 'progress' });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(runtime.agent.kill).not.toHaveBeenCalled();
      expect(session.members.has(teammate.id)).toBe(true);

      // Silence for a further 60s: watchdog fires but is log-only — no kill, no dispose.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(runtime.agent.kill).not.toHaveBeenCalled();
      expect(session.members.has(teammate.id)).toBe(true);
      expect(h.members.get(teammate.id)?.status).not.toBe('failed');
      session.crashRecovery.disarmWakeTimeout(teammate.id);
    } finally {
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });

  it('channelEventBus disconnected events still terminate the crashed teammate (real crash path)', async () => {
    const service = await importService();
    const channelEventBus = await importChannelEventBus();
    const team = await service.createTeam('user-1', 'Team', '/workspace', [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
    ]);
    await service.rebuildTeam(team.id);
    const teammate = [...h.members.values()].find((m) => m.role === 'teammate')!;
    const leader = leaderFor(team.id);
    const session = service.sessions.get(team.id) as unknown as { members: Map<string, { agent: { kill: ReturnType<typeof vi.fn> } }> };
    const runtime = session.members.get(teammate.id)!;

    channelEventBus.emitAgentMessage(teammate.conversation_id!, {
      type: 'agent_status',
      data: { status: 'disconnected', error: 'process exited code 1' },
    });

    expect(runtime.agent.kill).toHaveBeenCalledTimes(1);
    expect(session.members.has(teammate.id)).toBe(false);
    expect(h.members.get(teammate.id)?.status).toBe('failed');
    expect(h.mails.some((mail) => mail.from_member_id === teammate.id && mail.to_member_id === leader.id)).toBe(true);
  });

  it('inactive 60s watchdog no longer kills the slot (log-only)', async () => {
    vi.useFakeTimers();
    try {
      const service = await importService();
      const team = await service.createTeam('user-1', 'Team', '/workspace', [
        { assistant_id: 'scode', name: 'Leader', role: 'lead' },
        { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
      ]);
      await service.rebuildTeam(team.id);
      const teammate = [...h.members.values()].find((m) => m.role === 'teammate')!;
      const session = service.sessions.get(team.id) as unknown as {
        crashRecovery: { armWakeTimeout: (slot: string) => void; disarmWakeTimeout: (slot: string) => void };
        members: Map<string, { agent: { kill: ReturnType<typeof vi.fn> } }>;
      };
      const runtime = session.members.get(teammate.id)!;
      runtime.agent.kill.mockClear();
      h.mails.length = 0;

      session.crashRecovery.armWakeTimeout(teammate.id);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(runtime.agent.kill).not.toHaveBeenCalled();
      expect(session.members.has(teammate.id)).toBe(true);
      expect(h.members.get(teammate.id)?.status).not.toBe('failed');
      expect(h.mails.some((mail) => mail.from_member_id === teammate.id)).toBe(false);
      session.crashRecovery.disarmWakeTimeout(teammate.id);
    } finally {
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });

  it('recordSystemWake skips failed targets without creating an unclaimable run', async () => {
    const service = await importService();
    const team = await service.createTeam('user-1', 'Team', '/workspace', [{ assistant_id: 'scode', name: 'Leader', role: 'lead' }]);
    await service.rebuildTeam(team.id);
    const leader = leaderFor(team.id);
    h.members.set(leader.id, { ...leader, status: 'failed' });
    h.notifyWake.mockClear();

    service.recordSystemWake(team.id, leader.id, 'crash_notification', 'mail-1');

    expect(service.sessions.get(team.id)?.teamRun.getRecord()).toBeNull();
    expect(h.notifyWake).not.toHaveBeenCalled();
  });

  it('pauseMember requires a live session and skips slots without runtime', async () => {
    const service = await importService();
    await expect(service.pauseMember('missing-team', 'slot-1')).rejects.toThrow('Team session not active: missing-team');

    const team = await service.createTeam('user-1', 'Team', '/workspace', [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
    ]);
    await service.rebuildTeam(team.id);
    const teammate = [...h.members.values()].find((m) => m.role === 'teammate')!;
    service.sessions.get(team.id)?.members.delete(teammate.id);
    h.mails.length = 0;
    h.notifyWake.mockClear();

    await service.pauseMember(team.id, teammate.id);

    expect(h.mails).toHaveLength(0);
    expect(h.notifyWake).not.toHaveBeenCalled();
  });

  it('pauseMember notifies the leader for teammate interruption but not for leader interruption', async () => {
    const service = await importService();
    const team = await service.createTeam('user-1', 'Team', '/workspace', [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
    ]);
    await service.rebuildTeam(team.id);
    const leader = leaderFor(team.id);
    const teammate = [...h.members.values()].find((m) => m.role === 'teammate')!;
    h.mails.length = 0;
    h.notifyWake.mockClear();

    await service.pauseMember(team.id, teammate.id);

    expect(h.mails).toHaveLength(1);
    expect(h.mails[0]).toMatchObject({ to_member_id: leader.id, from_member_id: teammate.id });
    expect(h.mails[0].content).toContain('was interrupted by the user');
    expect(
      service.sessions
        .get(team.id)
        ?.teamRun.getRecord()
        ?.pending_wakes.get(leader.id)
        ?.some((wake) => wake.source === 'member_interrupted')
    ).toBe(true);
    expect(h.notifyWake).toHaveBeenCalledTimes(1);

    h.mails.length = 0;
    h.notifyWake.mockClear();
    await service.pauseMember(team.id, leader.id);

    expect(h.mails).toHaveLength(0);
    expect(h.notifyWake).not.toHaveBeenCalled();
  });

  it('retryMemberStart re-attaches a failed member and recovers unread backlog with no active run', async () => {
    const service = await importService();
    const team = await service.createTeam('user-1', 'Team', '/workspace', [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
    ]);
    await service.rebuildTeam(team.id);
    const teammate = [...h.members.values()].find((m) => m.role === 'teammate')!;
    service.sessions.get(team.id)?.members.delete(teammate.id);
    h.members.set(teammate.id, { ...teammate, status: 'failed' });
    h.mails.push({ id: 'mail-1', team_id: team.id, to_member_id: teammate.id, from_member_id: 'user', type: 'message', content: 'retry this', summary: null, files: null, read: false, created_at: 1 });
    h.buildConversation.mockClear();
    h.notifyWake.mockClear();

    await service.retryMemberStart(team.id, teammate.id);

    expect(h.buildConversation).toHaveBeenCalledTimes(1);
    expect(service.sessions.get(team.id)?.members.has(teammate.id)).toBe(true);
    expect(h.members.get(teammate.id)?.status).toBe('idle');
    expect(
      service.sessions
        .get(team.id)
        ?.teamRun.getRecord()
        ?.pending_wakes.get(teammate.id)
        ?.some((wake) => wake.source === 'recovery_drain')
    ).toBe(true);
    expect(h.notifyWake).toHaveBeenCalledTimes(1);
  });

  it('retryMemberStart reseeds unread backlog when an active run already exists', async () => {
    const service = await importService();
    const team = await service.createTeam('user-1', 'Team', '/workspace', [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
    ]);
    await service.rebuildTeam(team.id);
    const leader = leaderFor(team.id);
    const teammate = [...h.members.values()].find((m) => m.role === 'teammate')!;
    const session = service.sessions.get(team.id)!;
    const { lease } = session.teamRun.acquireWake(leader.id, 'lead', 'mcp_send_message');
    session.teamRun.commitLease(lease.lease_id, { slot_id: leader.id, role: 'lead', source: 'mcp_send_message', message_id: 'leader-mail' });
    session.members.delete(teammate.id);
    h.members.set(teammate.id, { ...teammate, status: 'failed' });
    h.mails.push({ id: 'mail-2', team_id: team.id, to_member_id: teammate.id, from_member_id: 'user', type: 'message', content: 'retry this too', summary: null, files: null, read: false, created_at: 2 });
    h.notifyWake.mockClear();

    await service.retryMemberStart(team.id, teammate.id);

    expect(
      session.teamRun
        .getRecord()
        ?.pending_wakes.get(teammate.id)
        ?.some((wake) => wake.source === 'recovery_drain')
    ).toBe(true);
    expect(h.notifyWake).toHaveBeenCalledTimes(1);
  });

  it('retryMemberStart reports attach failure directly to the caller', async () => {
    const service = await importService();
    const team = await service.createTeam('user-1', 'Team', '/workspace', [
      { assistant_id: 'scode', name: 'Leader', role: 'lead' },
      { assistant_id: 'claude', name: 'Worker', role: 'teammate' },
    ]);
    await service.rebuildTeam(team.id);
    const teammate = [...h.members.values()].find((m) => m.role === 'teammate')!;
    service.sessions.get(team.id)?.members.delete(teammate.id);
    h.members.set(teammate.id, { ...teammate, status: 'failed' });
    h.buildConversation.mockReturnValueOnce(null);

    await expect(service.retryMemberStart(team.id, teammate.id)).rejects.toThrow('Failed to attach member runtime: Worker');
  });

  it('spawn runtime errors dispose runtime state and clear spawn-window pending wakes', async () => {
    vi.useFakeTimers();
    try {
      const service = await importService();
      const team = await service.createTeam('user-1', 'Team', '/workspace', [{ assistant_id: 'scode', name: 'Leader', role: 'lead' }]);
      await service.rebuildTeam(team.id);
      h.buildConversation.mockImplementationOnce(() => {
        throw new Error('spawn runtime exploded');
      });

      const teammate = await service.spawnMember(team.id, { assistant_id: 'claude', name: 'Worker', role: 'teammate', notifyLeaderOnSpawn: false });
      const session = service.sessions.get(team.id)!;
      const { lease } = session.teamRun.acquireWake(teammate.id, 'teammate', 'mcp_send_message');
      session.teamRun.commitLease(lease.lease_id, { slot_id: teammate.id, role: 'teammate', source: 'mcp_send_message', message_id: 'spawn-window-mail' });
      expect(session.teamRun.getRecord()?.pending_wakes.get(teammate.id)).toBeDefined();

      await vi.runOnlyPendingTimersAsync();

      expect(h.members.get(teammate.id)?.status).toBe('failed');
      expect(service.sessions.get(team.id)?.members.has(teammate.id)).toBe(false);
      expect(session.teamRun.getRecord()?.pending_wakes.get(teammate.id)).toBeUndefined();
      expect(session.teamRun.getRecord()?.status).toBe('cancelled');
    } finally {
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });
});
