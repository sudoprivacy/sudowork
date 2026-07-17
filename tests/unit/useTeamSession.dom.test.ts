import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface IDeferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): IDeferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const getTeamInvoke = vi.fn();
const listMembersInvoke = vi.fn();
const removeMemberInvoke = vi.fn();

let memberSpawnedCallback: ((event: { team_id: string; member: TestMember }) => void) | null = null;
let _memberRemovedCallback: ((event: { team_id: string; slot_id: string }) => void) | null = null;
let _memberRenamedCallback: ((event: { team_id: string }) => void) | null = null;
let _agentStatusChangedCallback: ((event: { team_id: string; slot_id: string; status: string }) => void) | null = null;
let _sessionChangedCallback: ((event: { teamId: string }) => void) | null = null;

const onMemberSpawned = vi.fn((cb: (event: { team_id: string; member: TestMember }) => void) => {
  memberSpawnedCallback = cb;
  return () => {
    memberSpawnedCallback = null;
  };
});
const onMemberRemoved = vi.fn((cb: (event: { team_id: string; slot_id: string }) => void) => {
  _memberRemovedCallback = cb;
  return () => {
    _memberRemovedCallback = null;
  };
});
const onMemberRenamed = vi.fn((cb: (event: { team_id: string }) => void) => {
  _memberRenamedCallback = cb;
  return () => {
    _memberRenamedCallback = null;
  };
});
const onAgentStatusChanged = vi.fn((cb: (event: { team_id: string; slot_id: string; status: string }) => void) => {
  _agentStatusChangedCallback = cb;
  return () => {
    _agentStatusChangedCallback = null;
  };
});
const onSessionChanged = vi.fn((cb: (event: { teamId: string }) => void) => {
  _sessionChangedCallback = cb;
  return () => {
    _sessionChangedCallback = null;
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      getTeam: { invoke: (...args: unknown[]) => getTeamInvoke(...args) },
      listMembers: { invoke: (...args: unknown[]) => listMembersInvoke(...args) },
      removeMember: { invoke: (...args: unknown[]) => removeMemberInvoke(...args) },
      onMemberSpawned: { on: (...args: unknown[]) => onMemberSpawned(...args) },
      onMemberRemoved: { on: (...args: unknown[]) => onMemberRemoved(...args) },
      onMemberRenamed: { on: (...args: unknown[]) => onMemberRenamed(...args) },
      onAgentStatusChanged: { on: (...args: unknown[]) => onAgentStatusChanged(...args) },
      onSessionChanged: { on: (...args: unknown[]) => onSessionChanged(...args) },
    },
  },
}));

import { useTeamSession } from '../../src/renderer/pages/team/hooks/useTeamSession';

type TestTeam = ReturnType<typeof makeTeam>;
type TestMember = ReturnType<typeof makeMember>;

const teamResponses = new Map<string, Promise<TestTeam | null>>();
const memberResponses = new Map<string, Promise<TestMember[]>>();

function makeTeam(id: string, name: string) {
  return {
    id,
    user_id: 'user-1',
    name,
    workspace: null,
    workspace_kind: null,
    leader_member_id: `${id}-leader`,
    session_mode: null,
    pinned: false,
    pinned_at: null,
    created_at: 1,
    updated_at: 1,
  };
}

function makeMember(teamId: string, role: 'lead' | 'teammate' = 'lead', overrides: Partial<{ id: string; name: string; status: string }> = {}) {
  return {
    id: overrides.id ?? `${teamId}-${role}`,
    team_id: teamId,
    role,
    name: overrides.name ?? (role === 'lead' ? 'Leader' : 'Member'),
    assistant_id: 'scode',
    backend: 'scode',
    preset_agent_type: null,
    skills: [],
    preset_context: null,
    model: null,
    avatar: null,
    conversation_id: `${teamId}-conversation`,
    status: overrides.status ?? 'idle',
    created_at: 1,
  };
}

function mockResolvedTeam(teamId: string, name = teamId) {
  teamResponses.set(teamId, Promise.resolve(makeTeam(teamId, name)));
  memberResponses.set(teamId, Promise.resolve([makeMember(teamId)]));
}

function mockDeferredTeam(teamId: string, name = teamId) {
  const teamDeferred = deferred<TestTeam | null>();
  const membersDeferred = deferred<TestMember[]>();
  teamResponses.set(teamId, teamDeferred.promise);
  memberResponses.set(teamId, membersDeferred.promise);
  return {
    resolveTeam: () => teamDeferred.resolve(makeTeam(teamId, name)),
    resolveMembers: () => membersDeferred.resolve([makeMember(teamId)]),
  };
}

async function resolveDeferredTeam(response: ReturnType<typeof mockDeferredTeam>) {
  await act(async () => {
    response.resolveTeam();
  });
  await act(async () => {
    response.resolveMembers();
  });
}

describe('useTeamSession', () => {
  beforeEach(() => {
    teamResponses.clear();
    memberResponses.clear();
    getTeamInvoke.mockReset();
    listMembersInvoke.mockReset();
    removeMemberInvoke.mockReset();
    getTeamInvoke.mockImplementation(({ teamId }: { teamId: string }) => teamResponses.get(teamId) ?? Promise.resolve(null));
    listMembersInvoke.mockImplementation(({ teamId }: { teamId: string }) => memberResponses.get(teamId) ?? Promise.resolve([]));
    removeMemberInvoke.mockResolvedValue(undefined);
    onMemberSpawned.mockClear();
    onMemberRemoved.mockClear();
    onMemberRenamed.mockClear();
    onAgentStatusChanged.mockClear();
    onSessionChanged.mockClear();
    memberSpawnedCallback = null;
    _memberRemovedCallback = null;
    _memberRenamedCallback = null;
    _agentStatusChangedCallback = null;
    _sessionChangedCallback = null;
  });

  it('does not expose the previous team after teamId changes and treats the mismatch as loading', async () => {
    mockResolvedTeam('old-team', 'Old Team');
    const newTeamResponse = mockDeferredTeam('new-team', 'New Team');

    const { result, rerender } = renderHook(({ teamId }) => useTeamSession(teamId), {
      initialProps: { teamId: 'old-team' },
    });

    await waitFor(() => expect(result.current.team?.id).toBe('old-team'));
    expect(result.current.loading).toBe(false);

    rerender({ teamId: 'new-team' });

    expect(result.current.team).toBeNull();
    expect(result.current.loading).toBe(true);

    await resolveDeferredTeam(newTeamResponse);
    await waitFor(() => expect(result.current.team?.id).toBe('new-team'));
  });

  it('keeps loading false during member-spawn background refresh after initial load', async () => {
    mockResolvedTeam('team-1', 'Team 1');

    const { result } = renderHook(() => useTeamSession('team-1'));

    await waitFor(() => expect(result.current.team?.id).toBe('team-1'));
    expect(result.current.loading).toBe(false);

    const refreshResponse = mockDeferredTeam('team-1', 'Team 1');
    act(() => {
      memberSpawnedCallback?.({ team_id: 'team-1', member: makeMember('team-1', 'teammate', { status: 'pending' }) });
    });

    expect(result.current.loading).toBe(false);

    await resolveDeferredTeam(refreshResponse);
    await waitFor(() => expect(result.current.team?.id).toBe('team-1'));
  });

  it('inserts a pending spawned member before the background refetch resolves', async () => {
    mockResolvedTeam('team-1', 'Team 1');

    const { result } = renderHook(() => useTeamSession('team-1'));

    await waitFor(() => expect(result.current.team?.id).toBe('team-1'));

    const refreshResponse = mockDeferredTeam('team-1', 'Team 1');
    act(() => {
      memberSpawnedCallback?.({ team_id: 'team-1', member: makeMember('team-1', 'teammate', { id: 'slot-new', name: 'New Member', status: 'pending' }) });
    });

    expect(result.current.team?.assistants.some((assistant) => assistant.slot_id === 'slot-new' && assistant.status === 'pending')).toBe(true);
    expect(result.current.statusMap.get('slot-new')).toBe('pending');

    await resolveDeferredTeam(refreshResponse);
    await waitFor(() => expect(result.current.team?.assistants.some((assistant) => assistant.slot_id === 'slot-new')).toBe(false));
  });

  it('replaces an existing spawned member instead of duplicating it', async () => {
    mockResolvedTeam('team-1', 'Team 1');

    const { result } = renderHook(() => useTeamSession('team-1'));

    await waitFor(() => expect(result.current.team?.id).toBe('team-1'));

    const refreshResponse = mockDeferredTeam('team-1', 'Team 1');
    act(() => {
      memberSpawnedCallback?.({ team_id: 'team-1', member: makeMember('team-1', 'teammate', { id: 'slot-new', name: 'Pending Member', status: 'pending' }) });
    });
    act(() => {
      memberSpawnedCallback?.({ team_id: 'team-1', member: makeMember('team-1', 'teammate', { id: 'slot-new', name: 'Updated Member', status: 'pending' }) });
    });

    const matches = result.current.team?.assistants.filter((assistant) => assistant.slot_id === 'slot-new') ?? [];
    expect(matches).toHaveLength(1);
    expect(matches[0].assistant_name).toBe('Updated Member');

    await resolveDeferredTeam(refreshResponse);
  });

  it('ignores stale team detail responses after a newer team request starts', async () => {
    const oldTeamResponse = mockDeferredTeam('old-team', 'Old Team');
    const newTeamResponse = mockDeferredTeam('new-team', 'New Team');

    const { result, rerender } = renderHook(({ teamId }) => useTeamSession(teamId), {
      initialProps: { teamId: 'old-team' },
    });

    rerender({ teamId: 'new-team' });
    await resolveDeferredTeam(newTeamResponse);
    await waitFor(() => expect(result.current.team?.id).toBe('new-team'));

    await resolveDeferredTeam(oldTeamResponse);

    expect(result.current.team?.id).toBe('new-team');
  });

  it('clears foreground loading when superseded by a background refresh', async () => {
    const foregroundResponse = mockDeferredTeam('team-1', 'Team 1');

    const { result } = renderHook(() => useTeamSession('team-1'));

    expect(result.current.loading).toBe(true);

    const backgroundResponse = mockDeferredTeam('team-1', 'Team 1');
    act(() => {
      memberSpawnedCallback?.({ team_id: 'team-1', member: makeMember('team-1', 'teammate', { status: 'pending' }) });
    });

    await resolveDeferredTeam(backgroundResponse);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.team?.id).toBe('team-1'));

    await resolveDeferredTeam(foregroundResponse);

    expect(result.current.team?.id).toBe('team-1');
    expect(result.current.loading).toBe(false);
  });
});
