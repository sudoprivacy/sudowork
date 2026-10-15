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
  default: function ConversationRowMock({ conversation, agentDisplayName }: IConversationRowMockProps) {
    return <button>{agentDisplayName ? `${agentDisplayName} · ${conversation.name}` : conversation.name}</button>;
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
    expect(screen.queryByText(myAgent.displayName)).toBeNull();
  });

  it('separates persistent Agents from the complete session timeline and template references', () => {
    const conversations = legacyConversations();
    const owned = { ...conversations[0], id: 'owned', name: 'Owned conversation', extra: { presetAssistantId: myAgent.ref, pinned: true } } as ConversationItem;
    const template = { ...conversations[1], id: 'template', name: 'Template conversation', extra: { presetAssistantId: 'template-a', agentName: 'Template A' } } as ConversationItem;
    state.history = buildGroupedHistory([...conversations, owned, template], t, [], [myAgent, { ref: 'template-a', displayName: 'Template A', kind: 'template' }]);
    const { rerender } = render(<WorkspaceGroupedHistory activeTab='agents' />);
    expect(screen.queryByText('Template A')).toBeNull();
    expect(screen.queryByRole('button', { name: template.name })).toBeNull();
    expect(screen.queryByRole('button', { name: conversations[0].name })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `common.expandMore ${myAgent.displayName}` }));
    expect(screen.getAllByRole('button', { name: owned.name })).toHaveLength(1);

    rerender(<WorkspaceGroupedHistory activeTab='timeline' />);
    expect(screen.queryByText(myAgent.displayName)).toBeNull();
    expect(screen.getAllByRole('button', { name: template.name })).toHaveLength(1);
    for (const conversation of conversations) expect(screen.getAllByRole('button', { name: conversation.name })).toHaveLength(1);
    expect(screen.getByText(owned.name)).toBeInTheDocument();
  });

  it('keeps the complete timeline when the Agent list is unavailable', () => {
    const conversations = legacyConversations();
    state.history = buildGroupedHistory(conversations, t);
    render(<WorkspaceGroupedHistory />);

    for (const conversation of conversations) {
      expect(screen.getByRole('button', { name: conversation.name })).toBeInTheDocument();
    }
  });

  it('opens the latest session when clicking an Agent and changes expansion only with its arrow', () => {
    const conversations = legacyConversations()
      .slice(0, 2)
      .map((conversation) => ({ ...conversation, extra: { presetAssistantId: myAgent.ref, agentName: myAgent.displayName } }) as ConversationItem);
    state.conversations = conversations;
    state.history = buildGroupedHistory(conversations, t, [], [myAgent]);
    render(<WorkspaceGroupedHistory activeTab='agents' />);

    fireEvent.click(screen.getByRole('button', { name: myAgent.displayName, exact: true }));
    expect(state.onConversationClick).toHaveBeenCalledWith(conversations[1]);
    expect(state.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: conversations[0].name })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `common.expandMore ${myAgent.displayName}` }));
    expect(state.onConversationClick).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: conversations[0].name })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: `common.collapse ${myAgent.displayName}` }));
    expect(screen.queryByRole('button', { name: conversations[0].name })).toBeNull();
  });

  it('opens a new conversation under an unused Agent', () => {
    state.history = buildGroupedHistory([], t, [], [myAgent]);
    render(<WorkspaceGroupedHistory activeTab='agents' />);
    fireEvent.click(screen.getByRole('button', { name: myAgent.displayName, exact: true }));
    expect(state.navigate).toHaveBeenCalledWith(`/guid?assistant=${encodeURIComponent(myAgent.ref)}`);
    expect(state.onConversationClick).not.toHaveBeenCalled();
  });
});

interface IConversationRowMockProps {
  conversation: ConversationItem;
  agentDisplayName?: string;
}
