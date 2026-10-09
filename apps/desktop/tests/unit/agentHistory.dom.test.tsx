import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationItem, GroupedHistoryResult } from '@renderer/pages/conversation/grouped-history/types';
import { buildGroupedHistory } from '@renderer/pages/conversation/grouped-history/utils/groupingHelpers';

const state = vi.hoisted(() => ({ history: {} as GroupedHistoryResult, conversations: [] as ConversationItem[], navigate: vi.fn(), onConversationClick: vi.fn() }));
vi.mock('react-router-dom', () => ({ useParams: () => ({}), useNavigate: () => state.navigate }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/pages/cron/hooks/useCronJobs', () => ({ useCronJobsMap: () => ({ getJobStatus: vi.fn(), markAsRead: vi.fn(), setActiveConversation: vi.fn() }) }));
vi.mock('@renderer/pages/conversation/grouped-history/hooks/useConversations', () => ({
  useConversations: () => ({ ...state.history, conversations: state.conversations, expandedWorkspaces: [], handleToggleWorkspace: vi.fn() }),
}));
vi.mock('@renderer/pages/conversation/grouped-history/hooks/useBatchSelection', () => ({ useBatchSelection: () => ({ selectedConversationIds: new Set(), selectedCount: 0 }) }));
vi.mock('@renderer/pages/conversation/grouped-history/hooks/useConversationActions', () => ({ useConversationActions: () => ({ renameModalName: '', handleConversationClick: state.onConversationClick }) }));
vi.mock('@renderer/pages/conversation/grouped-history/hooks/useExport', () => ({ useExport: () => ({}) }));
vi.mock('@renderer/pages/conversation/grouped-history/hooks/useDragAndDrop', () => ({ useDragAndDrop: () => ({}) }));
vi.mock('@renderer/components/DirectorySelectionModal', () => ({ default: () => null }));
vi.mock('@renderer/pages/conversation/grouped-history/ConversationRow', () => ({
  default: function ConversationRowMock({ conversation }: IConversationRowMockProps) {
    return <button>{conversation.name}</button>;
  },
}));

import WorkspaceGroupedHistory from '@renderer/pages/conversation/grouped-history';

afterEach(() => {
  cleanup();
  localStorage.clear();
  state.conversations = [];
  vi.clearAllMocks();
});

const t = (key: string) => key;
const myAgent = { ref: 'moss-agent:user:me', displayName: 'My Agent', kind: 'default' as const };

function legacyConversations(): ConversationItem[] {
  return Array.from({ length: 20 }, (_, index) => ({
    id: `legacy-${index}`,
    name: `Historical conversation ${index}`,
    type: 'acp',
    createTime: Date.now() - (20 - index) * 60_000,
    modifyTime: Date.now() - (20 - index) * 60_000,
    extra: { backend: 'scode' },
  })) as ConversationItem[];
}

describe('Agent history compatibility', () => {
  it('keeps older conversations without an Agent reference reachable after the Agent list loads', () => {
    const conversations = legacyConversations();
    state.history = buildGroupedHistory(conversations, t, [], [myAgent]);
    render(<WorkspaceGroupedHistory />);

    for (const conversation of conversations) {
      expect(screen.getAllByRole('button', { name: conversation.name }).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(myAgent.displayName)).toBeInTheDocument();
  });

  it('shows known Agent conversations in their group and Recent without adding a timeline copy', () => {
    const conversations = legacyConversations();
    const owned = {
      ...conversations[0],
      id: 'owned',
      name: 'Owned conversation',
      modifyTime: Date.now(),
      extra: { agentName: 'My Agent', presetAssistantId: myAgent.ref },
    } as ConversationItem;
    state.history = buildGroupedHistory([...conversations, owned], t, [], [myAgent]);
    render(<WorkspaceGroupedHistory />);

    expect(screen.getAllByRole('button', { name: owned.name })).toHaveLength(2);
    expect(screen.getByRole('button', { name: conversations[0].name })).toBeInTheDocument();
  });

  it('keeps the complete timeline when the Agent list is unavailable', () => {
    const conversations = legacyConversations();
    state.history = buildGroupedHistory(conversations, t);
    render(<WorkspaceGroupedHistory />);

    for (const conversation of conversations) {
      expect(screen.getByRole('button', { name: conversation.name })).toBeInTheDocument();
    }
  });

  it('opens the latest session when clicking an Agent and collapses only with its arrow', () => {
    const conversations = legacyConversations()
      .slice(0, 2)
      .map((conversation) => ({ ...conversation, extra: { presetAssistantId: myAgent.ref, agentName: myAgent.displayName } }) as ConversationItem);
    state.conversations = conversations;
    state.history = buildGroupedHistory(conversations, t, [], [myAgent]);
    render(<WorkspaceGroupedHistory />);

    fireEvent.click(screen.getByRole('button', { name: myAgent.displayName, exact: true }));
    expect(state.onConversationClick).toHaveBeenCalledWith(conversations[1]);
    expect(state.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: `common.collapse ${myAgent.displayName}` }));
    expect(state.onConversationClick).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: conversations[0].name })).toHaveLength(1);
  });

  it('opens a new conversation under an unused Agent', () => {
    state.history = buildGroupedHistory([], t, [], [myAgent]);
    render(<WorkspaceGroupedHistory />);
    fireEvent.click(screen.getByRole('button', { name: myAgent.displayName, exact: true }));
    expect(state.navigate).toHaveBeenCalledWith(`/guid?assistant=${encodeURIComponent(myAgent.ref)}`);
    expect(state.onConversationClick).not.toHaveBeenCalled();
  });
});

interface IConversationRowMockProps {
  conversation: ConversationItem;
}
