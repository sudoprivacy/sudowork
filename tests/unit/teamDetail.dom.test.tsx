import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  params: { teamId: 'team-1' },
  navigate: vi.fn(),
  useTeamSession: vi.fn(),
  useTeamRunView: vi.fn(),
  getConversation: vi.fn(),
  syncWorkspaceSkills: vi.fn(),
  ensureSession: vi.fn(),
  sendMessage: vi.fn(),
  answerQuestion: vi.fn(),
  chatSiderProps: [] as Array<{ conversation?: { id?: string } }>,
  acpChatProps: [] as Array<{
    conversation_id: string;
    onProcessingChange?: (isProcessing: boolean) => void;
    onTeamAnswerQuestion?: (params: { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }) => Promise<unknown>;
  }>,
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
      answerQuestion: { invoke: (...args: unknown[]) => mocks.answerQuestion(...args) },
    },
    conversation: {
      get: { invoke: (...args: unknown[]) => mocks.getConversation(...args) },
      syncWorkspaceSkills: { invoke: (...args: unknown[]) => mocks.syncWorkspaceSkills(...args) },
    },
  },
}));

vi.mock('../../src/renderer/pages/team/hooks/useTeamSession', () => ({
  useTeamSession: (...args: unknown[]) => mocks.useTeamSession(...args),
}));

vi.mock('../../src/renderer/pages/team/hooks/useTeamRunView', () => ({
  useTeamRunView: (...args: unknown[]) => mocks.useTeamRunView(...args),
}));

vi.mock('../../src/renderer/pages/team/hooks/useTeamWarmup', () => ({
  useTeamWarmup: () => ({ phase: 'ready', runtimeStatus: new Map(), error: undefined, onRetry: () => undefined }),
}));

vi.mock('@renderer/pages/conversation/ChatLayout', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    default: ({ title, headerExtra, sider, children }: { title?: React.ReactNode; headerExtra?: React.ReactNode; sider?: React.ReactNode; children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'chat-layout' }, React.createElement('div', { 'data-testid': 'chat-title' }, title), React.createElement('div', { 'data-testid': 'header-extra' }, headerExtra), sider, children),
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
  return {
    default: (props: { conversation_id: string; onProcessingChange?: (isProcessing: boolean) => void; onTeamAnswerQuestion?: (params: { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }) => Promise<unknown> }) => {
      mocks.acpChatProps.push(props);
      return React.createElement('div', { 'data-testid': 'acp-chat', 'data-conversation-id': props.conversation_id });
    },
  };
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
    mocks.syncWorkspaceSkills.mockReset();
    mocks.syncWorkspaceSkills.mockResolvedValue({ success: true });
    mocks.ensureSession.mockReset();
    mocks.ensureSession.mockResolvedValue(undefined);
    mocks.sendMessage.mockReset();
    mocks.sendMessage.mockResolvedValue(undefined);
    mocks.answerQuestion.mockReset();
    mocks.answerQuestion.mockResolvedValue({ success: true });
    mocks.chatSiderProps = [];
    mocks.acpChatProps = [];
    mocks.useTeamRunView.mockReturnValue({ activeRun: null, childTurnsBySlot: {}, reconcile: vi.fn() });
  });

  it('does not navigate to guid while the current route team is still loading', () => {
    mocks.useTeamSession.mockReturnValue({ team: null, statusMap: new Map(), loading: true });

    const { container } = render(<TeamDetailPage />);

    expect(mocks.navigate).not.toHaveBeenCalledWith('/guid');
    expect(container.querySelector('.arco-spin')).not.toBeNull();
  });

  it('passes leader question answers through the team answerQuestion API', async () => {
    const team = makeTeam('team-1', 'leader-conv');
    mocks.useTeamSession.mockReturnValue({ team, statusMap: new Map(), loading: false });
    mocks.getConversation.mockResolvedValue({ id: 'leader-conv', name: 'Leader Conversation' });

    render(<TeamDetailPage />);

    await waitFor(() => expect(mocks.acpChatProps.at(-1)?.onTeamAnswerQuestion).toBeTypeOf('function'));
    await mocks.acpChatProps.at(-1)?.onTeamAnswerQuestion?.({
      conversationId: 'leader-conv',
      toolCallId: 'tool-1',
      answers: [{ id: 'q1', value: 'yes', label: 'Yes' }],
    });

    expect(mocks.answerQuestion).toHaveBeenCalledWith({
      teamId: 'team-1',
      memberId: 'team-1-leader',
      conversationId: 'leader-conv',
      toolCallId: 'tool-1',
      answers: [{ id: 'q1', value: 'yes', label: 'Yes' }],
    });
  });

  it('syncs workspace skills before passing the leader conversation to ChatSider', async () => {
    const team = makeTeam('team-1', 'leader-conversation');
    mocks.useTeamSession.mockReturnValue({ team, statusMap: new Map(), loading: false });
    mocks.getConversation.mockResolvedValueOnce({
      id: 'leader-conversation',
      name: 'Leader Conversation',
      type: 'acp',
      extra: { backend: 'scode', workspace: 'C:/workspace/team-1' },
    });

    render(<TeamDetailPage />);

    await waitFor(() => expect(mocks.syncWorkspaceSkills).toHaveBeenCalledWith({ conversation_id: 'leader-conversation' }));
    await waitFor(() => expect(mocks.chatSiderProps.some((props) => props.conversation?.id === 'leader-conversation')).toBe(true));
  });

  it('still passes the leader conversation to ChatSider when workspace skill sync fails', async () => {
    const team = makeTeam('team-1', 'leader-conversation');
    mocks.useTeamSession.mockReturnValue({ team, statusMap: new Map(), loading: false });
    mocks.getConversation.mockResolvedValueOnce({
      id: 'leader-conversation',
      name: 'Leader Conversation',
      type: 'acp',
      extra: { backend: 'scode', workspace: 'C:/workspace/team-1' },
    });
    mocks.syncWorkspaceSkills.mockRejectedValueOnce(new Error('sync failed'));

    render(<TeamDetailPage />);

    await waitFor(() => expect(mocks.chatSiderProps.some((props) => props.conversation?.id === 'leader-conversation')).toBe(true));
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

  it('shows the leader header as active for accepted and running runs', () => {
    const team = makeTeam('team-1', 'leader-conversation');
    mocks.useTeamSession.mockReturnValue({ team, statusMap: new Map(), loading: false });
    mocks.getConversation.mockReturnValue(new Promise(() => {}));
    mocks.useTeamRunView.mockReturnValue({ activeRun: { team_id: 'team-1', team_run_id: 'run-1', target_slot_id: 'team-1-leader', target_role: 'lead', status: 'accepted', active_child_count: 0, pending_wake_count: 1, starting_child_count: 0 }, childTurnsBySlot: {}, reconcile: vi.fn() });

    const { rerender } = render(<TeamDetailPage />);

    expect(screen.getByTestId('header-extra')).toHaveTextContent('team.status.active');

    mocks.useTeamRunView.mockReturnValue({ activeRun: { team_id: 'team-1', team_run_id: 'run-1', target_slot_id: 'team-1-leader', target_role: 'lead', status: 'running', active_child_count: 1, pending_wake_count: 0, starting_child_count: 0 }, childTurnsBySlot: {}, reconcile: vi.fn() });
    rerender(<TeamDetailPage />);

    expect(screen.getByTestId('header-extra')).toHaveTextContent('team.status.active');
  });

  it('uses leader chat processing to keep the leader header active and resets on conversation change', async () => {
    const oldTeam = makeTeam('team-1', 'old-conversation');
    const newTeam = makeTeam('team-1', 'new-conversation');
    mocks.useTeamSession.mockReturnValue({ team: oldTeam, statusMap: new Map(), loading: false });
    mocks.getConversation.mockReturnValue(new Promise(() => {}));

    const { rerender } = render(<TeamDetailPage />);

    await waitFor(() => expect(mocks.acpChatProps.some((props) => props.conversation_id === 'old-conversation')).toBe(true));
    expect(screen.getByTestId('header-extra')).toBeEmptyDOMElement();

    act(() => {
      mocks.acpChatProps.at(-1)?.onProcessingChange?.(true);
    });
    expect(screen.getByTestId('header-extra')).toHaveTextContent('team.status.active');

    mocks.useTeamSession.mockReturnValue({ team: newTeam, statusMap: new Map(), loading: false });
    mocks.getConversation.mockReturnValue(new Promise(() => {}));
    mocks.acpChatProps = [];
    rerender(<TeamDetailPage />);

    expect(screen.getByTestId('header-extra')).toBeEmptyDOMElement();
  });
});
