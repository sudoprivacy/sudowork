import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listTeams: vi.fn(),
  listMembers: vi.fn(),
  onListChanged: vi.fn(() => () => undefined),
}));

vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  team: {
    listTeams: { invoke: (...args: unknown[]) => h.listTeams(...args) },
    listMembers: { invoke: (...args: unknown[]) => h.listMembers(...args) },
    onListChanged: { on: (...args: unknown[]) => h.onListChanged(...args) },
  },
}));

import { useTeams } from '../../src/renderer/pages/team/hooks/useTeams';

function makeBackendTeam(id: string) {
  return {
    id,
    user_id: 'user-1',
    name: `Team ${id}`,
    workspace: '/workspace',
    workspace_kind: 'custom' as const,
    leader_member_id: 'leader-1',
    session_mode: null,
    pinned: false,
    pinned_at: null,
    created_at: 1,
    updated_at: 2,
  };
}

describe('useTeams', () => {
  beforeEach(() => {
    h.listTeams.mockReset();
    h.listMembers.mockReset();
    h.onListChanged.mockReset();
    h.onListChanged.mockReturnValue(() => undefined);
  });

  it('fetches only the team list and leaves assistants empty for the sidebar hot path', async () => {
    h.listTeams.mockResolvedValue([makeBackendTeam('team-1')]);

    const { result } = renderHook(() => useTeams());

    await waitFor(() => expect(result.current.teams).toHaveLength(1));
    expect(h.listTeams).toHaveBeenCalledTimes(1);
    expect(h.listMembers).not.toHaveBeenCalled();
    expect(result.current.teams[0]).toMatchObject({ id: 'team-1', name: 'Team team-1', assistants: [] });
  });
});
