import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TTeam } from '../../src/renderer/pages/team/types';

const mocks = vi.hoisted(() => ({
  sendMessageToMember: vi.fn(),
  answerQuestion: vi.fn(),
  acpChatProps: [] as Array<{
    conversation_id: string;
    onProcessingChange?: (isProcessing: boolean) => void;
    onTeamAnswerQuestion?: (params: { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }) => Promise<unknown>;
  }>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      sendMessageToMember: { invoke: (...args: unknown[]) => mocks.sendMessageToMember(...args) },
      answerQuestion: { invoke: (...args: unknown[]) => mocks.answerQuestion(...args) },
    },
  },
}));

vi.mock('@/renderer/utils/agentLogo', () => ({
  getAgentLogo: () => null,
}));

vi.mock('@/renderer/shared/agents/assistantAdapter', () => ({
  resolveAssistantName: (name: string) => name,
}));

vi.mock('@renderer/components/AcpModelSelector', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return { default: () => React.createElement('div', { 'data-testid': 'model-selector' }) };
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

import TeamMemberListTab from '../../src/renderer/pages/team/components/TeamMemberListTab';

function makeTeam(assistants: TTeam['assistants']): TTeam {
  return {
    id: 'team-1',
    user_id: 'user-1',
    name: 'Team 1',
    workspace: 'C:/workspace/team-1',
    workspace_kind: 'custom',
    leader_member_id: 'leader-slot',
    assistants,
    session_mode: null,
    pinned: false,
    pinned_at: null,
    created_at: 1,
    updated_at: 1,
  };
}

const leader = {
  slot_id: 'leader-slot',
  conversation_id: 'leader-conversation',
  role: 'leader' as const,
  assistant_backend: 'scode' as const,
  icon: null,
  assistant_name: 'Leader',
  status: 'idle' as const,
  assistant_id: 'scode',
  model: null,
};

const teammate = {
  slot_id: 'member-slot',
  conversation_id: 'member-conversation',
  role: 'teammate' as const,
  assistant_backend: 'scode' as const,
  icon: null,
  assistant_name: 'Teammate',
  status: 'idle' as const,
  assistant_id: 'scode',
  model: null,
};

function makeTeammate(status: TTeam['assistants'][number]['status']): TTeam['assistants'][number] {
  return { ...teammate, status };
}

describe('TeamMemberListTab', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.sendMessageToMember.mockReset();
    mocks.answerQuestion.mockReset();
    mocks.answerQuestion.mockResolvedValue({ success: true });
    mocks.acpChatProps = [];
  });

  it('shows one no-members empty state when the team only has a leader', () => {
    render(<TeamMemberListTab team={makeTeam([leader])} statusMap={new Map()} />);

    expect(screen.getAllByText('team.detail.noMembers')).toHaveLength(1);
    expect(screen.queryByText('team.detail.selectMember')).toBeNull();
    expect(screen.queryByTestId('acp-chat')).toBeNull();
  });

  it('renders the active teammate chat when a teammate exists', async () => {
    render(<TeamMemberListTab team={makeTeam([leader, teammate])} statusMap={new Map()} />);

    expect(screen.getByText('Teammate')).toBeInTheDocument();
    expect(await screen.findByTestId('acp-chat')).toHaveAttribute('data-conversation-id', 'member-conversation');
    expect(mocks.acpChatProps.some((props) => props.conversation_id === 'member-conversation')).toBe(true);
  });

  it('passes active member question answers through the team answerQuestion API', async () => {
    render(<TeamMemberListTab team={makeTeam([leader, teammate])} statusMap={new Map()} />);

    await waitFor(() => expect(mocks.acpChatProps.at(-1)?.onTeamAnswerQuestion).toBeTypeOf('function'));
    await mocks.acpChatProps.at(-1)?.onTeamAnswerQuestion?.({
      conversationId: 'member-conversation',
      toolCallId: 'tool-1',
      answers: [{ id: 'q1', value: 'yes', label: 'Yes' }],
    });

    expect(mocks.answerQuestion).toHaveBeenCalledWith({
      teamId: 'team-1',
      memberId: 'member-slot',
      conversationId: 'member-conversation',
      toolCallId: 'tool-1',
      answers: [{ id: 'q1', value: 'yes', label: 'Yes' }],
    });
  });

  it('shows an idle member as active when activeSlotIds contains the member slot', () => {
    render(<TeamMemberListTab team={makeTeam([leader, teammate])} statusMap={new Map()} activeSlotIds={new Set(['member-slot'])} />);

    expect(screen.getByText('team.status.active')).toBeInTheDocument();
  });

  it('uses selected chat processing to override an idle member row while processing', async () => {
    render(<TeamMemberListTab team={makeTeam([leader, teammate])} statusMap={new Map()} />);

    expect(screen.getByText('team.status.idle')).toBeInTheDocument();
    await screen.findByTestId('acp-chat');

    act(() => {
      mocks.acpChatProps.at(-1)?.onProcessingChange?.(true);
    });
    expect(screen.getByText('team.status.active')).toBeInTheDocument();

    act(() => {
      mocks.acpChatProps.at(-1)?.onProcessingChange?.(false);
    });
    expect(screen.getByText('team.status.idle')).toBeInTheDocument();
  });

  it('does not override failed or pending member statuses', async () => {
    const { rerender } = render(<TeamMemberListTab team={makeTeam([leader, makeTeammate('failed')])} statusMap={new Map()} activeSlotIds={new Set(['member-slot'])} />);

    expect(screen.getByText('team.status.failed')).toBeInTheDocument();
    await screen.findByTestId('acp-chat');
    act(() => {
      mocks.acpChatProps.at(-1)?.onProcessingChange?.(true);
    });
    expect(screen.getByText('team.status.failed')).toBeInTheDocument();

    mocks.acpChatProps = [];
    rerender(<TeamMemberListTab team={makeTeam([leader, makeTeammate('pending')])} statusMap={new Map()} activeSlotIds={new Set(['member-slot'])} />);

    expect(screen.getByText('team.status.pending')).toBeInTheDocument();
  });
});
