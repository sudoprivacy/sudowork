import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  params: { teamId: 'team-1' },
  navigate: vi.fn(),
  useTeamSession: vi.fn(),
  useTeamRunView: vi.fn(),
  getConversation: vi.fn(),
  ensureSession: vi.fn(),
  sendMessage: vi.fn(),
  chatSiderProps: [] as Array<{ conversation?: { id?: string } }>,
}));

vi.mock('react-router-dom', () => ({
  useParams: () => mocks.params,
  useNavigate: () => mocks.navigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      ensureSession: { invoke: (...args: unknown[]) => mocks.ensureSession(...args) },
      sendMessage: { invoke: (...args: unknown[]) => mocks.sendMessage(...args) },
    },
    conversation: {
      get: { invoke: (...args: unknown[]) => mocks.getConversation(...args) },
    },
  },
}));

vi.mock('../../src/renderer/pages/team/hooks/useTeamSession', () => ({
  useTeamSession: (...args: unknown[]) => mocks.useTeamSession(...args),
}));

vi.mock('../../src/renderer/pages/team/hooks/useTeamRunView', () => ({
  useTeamRunView: (...args: unknown[]) => mocks.useTeamRunView(...args),
}));

vi.mock('@renderer/pages/conversation/ChatLayout', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    default: ({ title, sider, children }: { title?: React.ReactNode; sider?: React.ReactNode; children?: React.ReactNode }) => React.createElement('div', { 'data-testid': 'chat-layout' }, React.createElement('div', { 'data-testid': 'chat-title' }, title), sider, children),
  };
});

vi.mock('@renderer/pages/conversation/ChatSider', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    default: (props: { conversation?: { id?: string } }) => {
      mocks.chatSiderProps.push(props);
      return React.createElement('div', { 'data-testid': 'chat-sider', 'data-conversation-id': props.conversation?.id ?? '' });
    },
  };
});

vi.mock('@renderer/pages/conversation/acp/AcpChat', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return { default: () => React.createElement('div', { 'data-testid': 'acp-chat' }) };
});

vi.mock('@renderer/components/AcpModelSelector', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return { default: () => React.createElement('div', { 'data-testid': 'model-selector' }) };
});

vi.mock('../../src/renderer/pages/team/components/TeamMemberListTab', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return { default: () => React.createElement('div', { 'data-testid': 'team-member-list' }) };
});

vi.mock('../../src/renderer/pages/team/components/TeamLeaderEmptyState', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return { default: () => React.createElement('div', { 'data-testid': 'team-leader-empty' }) };
});

import TeamDetailPage from '../../src/renderer/pages/team/detail';

function makeTeam(id: string, leaderConversationId: string) {
  return {
    id,
    user_id: 'user-1',
    name: `Team ${id}`,
    workspace: null,
    workspace_kind: null,
    leader_member_id: `${id}-leader`,
    session_mode: null,
    pinned: false,
    pinned_at: null,
    created_at: 1,
    updated_at: 1,
    assistants: [
      {
        slot_id: `${id}-leader`,
        conversation_id: leaderConversationId,
        role: 'leader' as const,
        assistant_backend: 'scode',
        icon: null,
        assistant_name: 'Leader',
        status: 'idle' as const,
        assistant_id: 'scode',
        model: null,
      },
    ],
  };
}

describe('TeamDetailPage route safety', () => {
  beforeEach(() => {
    mocks.params = { teamId: 'team-1' };
    mocks.navigate.mockReset();
    mocks.useTeamSession.mockReset();
    mocks.useTeamRunView.mockReset();
    mocks.getConversation.mockReset();
    mocks.ensureSession.mockReset();
    mocks.ensureSession.mockResolvedValue(undefined);
    mocks.sendMessage.mockReset();
    mocks.sendMessage.mockResolvedValue(undefined);
    mocks.chatSiderProps = [];
    mocks.useTeamRunView.mockReturnValue({ activeRun: null, childTurnsBySlot: {}, reconcile: vi.fn() });
  });

  it('does not navigate to guid while the current route team is still loading', () => {
    mocks.useTeamSession.mockReturnValue({ team: null, statusMap: new Map(), loading: true });

    const { container } = render(<TeamDetailPage />);

    expect(mocks.navigate).not.toHaveBeenCalledWith('/guid');
    expect(container.querySelector('.arco-spin')).not.toBeNull();
  });

  it('does not pass a stale leader conversation to ChatSider after the leader conversation changes', async () => {
    const oldTeam = makeTeam('team-1', 'old-conversation');
    const newTeam = makeTeam('team-1', 'new-conversation');
    mocks.useTeamSession.mockReturnValue({ team: oldTeam, statusMap: new Map(), loading: false });
    mocks.getConversation.mockResolvedValueOnce({ id: 'old-conversation', name: 'Old Conversation' });

    const { rerender } = render(<TeamDetailPage />);

    await waitFor(() => expect(mocks.chatSiderProps.some((props) => props.conversation?.id === 'old-conversation')).toBe(true));

    mocks.useTeamSession.mockReturnValue({ team: newTeam, statusMap: new Map(), loading: false });
    mocks.getConversation.mockReturnValueOnce(new Promise(() => {}));
    mocks.chatSiderProps = [];

    rerender(<TeamDetailPage />);

    expect(mocks.chatSiderProps.at(-1)?.conversation).toBeUndefined();
  });
});
