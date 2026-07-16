import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TeamMemberListTab from '../../src/renderer/pages/team/components/TeamMemberListTab';
import type { TTeam } from '../../src/renderer/pages/team/types';

const mocks = vi.hoisted(() => ({
  answerQuestion: vi.fn(),
  acpChatProps: [] as Array<{ onTeamAnswerQuestion?: (params: { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }) => Promise<unknown> }>,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      sendMessageToMember: { invoke: vi.fn() },
      answerQuestion: { invoke: (...args: unknown[]) => mocks.answerQuestion(...args) },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/pages/conversation/acp/AcpChat', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    default: (props: { onTeamAnswerQuestion?: (params: { conversationId: string; toolCallId: string; answers: Array<{ id: string; value: string; label?: string }> }) => Promise<unknown> }) => {
      mocks.acpChatProps.push(props);
      return React.createElement('div', { 'data-testid': 'acp-chat' });
    },
  };
});

vi.mock('@/renderer/utils/agentLogo', () => ({ getAgentLogo: vi.fn(() => null) }));
vi.mock('@/renderer/shared/agents/assistantAdapter', () => ({ resolveAssistantName: vi.fn((name: string) => name) }));

function makeTeam(): TTeam {
  return {
    id: 'team-1',
    user_id: 'user-1',
    name: 'Team',
    workspace: null,
    workspace_kind: null,
    leader_member_id: 'leader-slot',
    session_mode: null,
    pinned: false,
    pinned_at: null,
    created_at: 1,
    updated_at: 1,
    assistants: [
      {
        slot_id: 'leader-slot',
        conversation_id: 'leader-conv',
        role: 'leader',
        assistant_backend: 'scode',
        assistant_name: 'Leader',
        status: 'idle',
      },
      {
        slot_id: 'member-slot-1',
        conversation_id: 'member-conv-1',
        role: 'teammate',
        assistant_backend: 'scode',
        assistant_name: 'Member',
        status: 'idle',
      },
    ],
  };
}

beforeEach(() => {
  mocks.answerQuestion.mockReset();
  mocks.answerQuestion.mockResolvedValue({ success: true });
  mocks.acpChatProps = [];
  localStorage.clear();
});

describe('TeamMemberListTab', () => {
  it('passes active member question answers through the team answerQuestion API', async () => {
    render(<TeamMemberListTab team={makeTeam()} statusMap={new Map()} />);

    await waitFor(() => expect(mocks.acpChatProps.at(-1)?.onTeamAnswerQuestion).toBeTypeOf('function'));
    await mocks.acpChatProps.at(-1)?.onTeamAnswerQuestion?.({
      conversationId: 'member-conv-1',
      toolCallId: 'tool-1',
      answers: [{ id: 'q1', value: 'yes', label: 'Yes' }],
    });

    expect(mocks.answerQuestion).toHaveBeenCalledWith({
      teamId: 'team-1',
      memberId: 'member-slot-1',
      conversationId: 'member-conv-1',
      toolCallId: 'tool-1',
      answers: [{ id: 'q1', value: 'yes', label: 'Yes' }],
    });
  });
});
