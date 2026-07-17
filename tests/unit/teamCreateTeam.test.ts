import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Team, TeamMail, TeamMember } from '@process/services/team/TeamStore';

const h = vi.hoisted(() => {
  const teams = new Map<string, Team>();
  const members = new Map<string, TeamMember>();
  const mails: TeamMail[] = [];
  const conversations = new Map<string, { id: string; extra: { workspace?: string } }>();
  const insertedMemberRoles: Array<'lead' | 'teammate'> = [];
  const softDeletedTeams: string[] = [];
  const softDeletedMemberTeams: string[] = [];
  const createConversation = vi.fn();
  const reapConversation = vi.fn();
  const buildConversation = vi.fn(() => ({ kill: vi.fn().mockResolvedValue(undefined) }));
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
    updateConversation: vi.fn(),
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
        'team.membership.initialRosterNotice': 'The user pre-selected these teammates when creating the team. They already exist and should be considered before creating more teammates. Call team_members to get the latest roster before delegating work.',
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
    getMember: (memberId: string) => h.members.get(memberId) ?? null,
    insertMail: (mail: TeamMail) => h.mails.push({ ...mail }),
    hasUnread: (teamId: string, toMemberId: string) => h.mails.some((mail) => mail.team_id === teamId && mail.to_member_id === toMemberId && !mail.read),
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

function defaultCreateConversation() {
  h.createConversation.mockImplementation(({ extra }: { extra: { workspace?: string } }) => {
    const id = `conv-${h.createConversation.mock.calls.length}`;
    const conversation = { id, extra: { workspace: extra.workspace ?? '/resolved-workspace' } };
    h.conversations.set(id, conversation);
    return Promise.resolve({ success: true, conversation });
  });
}

async function importService() {
  const mod = await import('@process/services/team/TeamService');
  const service = mod.teamService as unknown as {
    createTeam: typeof mod.teamService.createTeam;
    spawnMember: typeof mod.teamService.spawnMember;
    ensureSession: (teamId: string) => Promise<unknown>;
    rebuildTeam: typeof mod.teamService.rebuildTeam;
    cleanup: () => void;
    sessions: Map<string, { teamRun: { getRecord: () => { pending_wakes: Map<string, Array<{ source: string }>> } | null } }>;
    startTeamHttpServer: () => Promise<{ server: { close: (cb?: () => void) => void }; port: number; token: string }>;
  };
  service.startTeamHttpServer = vi.fn().mockResolvedValue({ server: { close: (cb?: () => void) => cb?.() }, port: 12345, token: 'token' });
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
  h.buildConversation.mockClear();
  h.notifyWake.mockClear();
  h.emitListChanged.mockClear();
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
    h.conversations.set('conv-1', { id: 'conv-1', extra: { workspace: '/workspace' } });
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

  it('allows duplicate assistants and more than eight members, then notifies the leader with full roster wake', async () => {
    const service = await importService();
    const members = [{ assistant_id: 'scode', name: 'Leader', role: 'lead' as const }, ...Array.from({ length: 8 }, (_, index) => ({ assistant_id: 'scode', name: `Worker ${index + 1}`, role: 'teammate' as const }))];

    const team = await service.createTeam('user-1', 'Team', '/workspace', members);
    const storedMembers = [...h.members.values()].filter((member) => member.team_id === team.id);
    const leader = leaderFor(team.id);
    const rosterMail = h.mails.find((mail) => mail.to_member_id === leader.id && mail.from_member_id === 'team_system');
    const record = service.sessions.get(team.id)?.teamRun.getRecord();

    expect(storedMembers).toHaveLength(9);
    expect(storedMembers.filter((member) => member.assistant_id === 'scode')).toHaveLength(9);
    expect(h.insertedMemberRoles).toEqual(['lead', 'teammate', 'teammate', 'teammate', 'teammate', 'teammate', 'teammate', 'teammate', 'teammate']);
    expect(rosterMail?.content).toContain('pre-selected these teammates');
    expect(rosterMail?.content).not.toContain('team.membership.initialRosterNotice');
    for (const member of storedMembers) {
      expect(rosterMail?.content).toContain(`slot_id=${member.id}`);
      expect(rosterMail?.content).toContain(`role=${member.role}`);
      expect(rosterMail?.content).toContain(`backend=${member.backend}`);
    }
    expect(record?.pending_wakes.get(leader.id)?.[0]?.source).toBe('team_membership_changed');
    expect(h.emitListChanged).toHaveBeenCalledWith({ team_id: team.id, action: 'created' });
  });

  it('creates the leader first, resolves temporary workspace, then creates teammates with that workspace', async () => {
    const service = await importService();
    const workspaceByConversationCall: Array<string | undefined> = [];
    h.createConversation.mockImplementation(({ extra }: { extra: { workspace?: string } }) => {
      workspaceByConversationCall.push(extra.workspace);
      const id = `conv-${h.createConversation.mock.calls.length}`;
      const conversation = { id, extra: { workspace: extra.workspace ?? '/resolved-workspace' } };
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

  it('notifies the leader when a teammate is dynamically added', async () => {
    const service = await importService();
    const team = await service.createTeam('user-1', 'Team', '/workspace', [{ assistant_id: 'scode', name: 'Leader', role: 'lead' }]);
    const leader = leaderFor(team.id);

    const teammate = await service.spawnMember(team.id, { assistant_id: 'claude', name: 'Worker', role: 'teammate', model: 'model-1' });
    const notice = h.mails.find((mail) => mail.to_member_id === leader.id && mail.from_member_id === teammate.id);
    const record = service.sessions.get(team.id)?.teamRun.getRecord();

    expect(notice?.content).toContain('A teammate was added to the team');
    expect(notice?.content).not.toContain('team.membership.memberAddedNotice');
    expect(notice?.content).toContain(`slot_id=${teammate.id}`);
    expect(notice?.content).toContain('assistant_id=claude');
    expect(notice?.content).toContain('Call team_members to get the latest roster');
    expect(record?.pending_wakes.get(leader.id)?.some((wake) => wake.source === 'team_membership_changed')).toBe(true);
  });

  it('rolls back the whole team when a teammate fails during initial creation', async () => {
    const service = await importService();
    h.createConversation.mockImplementation(({ extra }: { extra: { workspace?: string } }) => {
      if (h.createConversation.mock.calls.length > 1) return Promise.resolve({ success: false, error: 'teammate failed' });
      const id = 'conv-leader';
      const conversation = { id, extra: { workspace: extra.workspace ?? '/resolved-workspace' } };
      h.conversations.set(id, conversation);
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
});
