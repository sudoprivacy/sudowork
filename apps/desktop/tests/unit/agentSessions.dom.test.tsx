import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@sudowork/common/storage';

const state = vi.hoisted(() => ({ userId: 'user-a', isGuest: false, sessionMode: 'remote', history: vi.fn(), agents: vi.fn(), onChanged: vi.fn(), emit: vi.fn(), save: vi.fn(), listeners: new Map<string, () => void>() }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ user: { id: state.userId }, ready: true, status: state.isGuest ? 'guest' : 'authenticated', isGuest: state.isGuest }) }));
vi.mock('@renderer/hooks/useAppMode', () => ({ useAppMode: () => ({ isEnterprise: !state.isGuest }) }));
vi.mock('@sudowork/common/storage', () => ({ ConfigStorage: { set: state.save } }));
vi.mock('@renderer/pages/guid/hooks/useGuidAgentSelection', () => ({ getRendererSessionMode: () => state.sessionMode }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  eeclaw: { getMyAgents: { invoke: state.agents } },
  database: { getUserConversations: { invoke: state.history }, conversationChanged: { on: state.onChanged } },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/utils/emitter', () => ({
  emitter: { emit: state.emit },
  addEventListener: (event: string, callback: () => void) => {
    state.listeners.set(event, callback);
    return () => state.listeners.delete(event);
  },
}));
vi.mock('@renderer/pages/conversation/components/ConversationTitleMinimap', () => ({ default: ({ title }: { title: string }) => <span>{title}</span> }));
vi.mock('@renderer/pages/conversation/context/ConversationTabsContext', () => ({ useConversationTabs: () => ({ openTab: vi.fn() }) }));

import AgentSessionHeader from '@renderer/pages/conversation/components/AgentSessionHeader';
import NewConversationButton from '@renderer/pages/conversation/components/NewConversationButton';
import { clearGuidDraft, getGuidDraft, setGuidDraft } from '@renderer/pages/guid/hooks/useGuidDraft';
import { ConversationHistoryProvider, useConversationHistory } from '@renderer/pages/conversation/context/ConversationHistoryContext';

const reference = 'moss-agent:own:agent-a';
const agents = [
  { ref: reference, displayName: 'Renamed Agent', kind: 'own' },
  { ref: 'moss-agent:own:agent-b', displayName: 'Renamed Agent', kind: 'own' },
  { ref: 'moss-agent:user:user-a', displayName: 'Personal default', kind: 'default' },
];
function conversation(id: string, agentRef = reference, extra = {}): TChatConversation {
  return { id, name: `Session ${id}`, type: 'remote-agent', createTime: 1, modifyTime: id === 'current' ? 10 : 1, extra: { agentName: 'Old name', mossAssistantRef: agentRef, ...extra } } as TChatConversation;
}
function HistoryReader({ label }: { label: string }) {
  const { conversations } = useConversationHistory();
  return <output aria-label={label}>{conversations.map((session) => session.id).join(',')}</output>;
}
function Page() {
  const location = useLocation();
  const id = location.pathname.split('/')[2];
  return (
    <>
      <NewConversationButton onSessionClick={() => {}} />
      <AgentSessionHeader conversationId={id} title='Fallback title' />
      <output aria-label='route'>{location.pathname + location.search}</output>
      <HistoryReader label='sidebar history' />
      <HistoryReader label='tab history' />
    </>
  );
}
function renderPage() {
  const cache = new Map();
  const value = { provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false };
  function element() {
    return (
      <SWRConfig value={value}>
        <MemoryRouter initialEntries={['/conversation/current']}>
          <ConversationHistoryProvider>
            <Page />
          </ConversationHistoryProvider>
        </MemoryRouter>
      </SWRConfig>
    );
  }
  return { ...render(element()), element };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.userId = 'user-a';
  state.isGuest = false;
  state.sessionMode = 'remote';
  state.listeners.clear();
  state.onChanged.mockReturnValue(() => {});
  state.save.mockResolvedValue(undefined);
  state.agents.mockResolvedValue({ success: true, data: agents });
  state.history.mockResolvedValue([conversation('current'), conversation('pinned', reference, { pinned: true }), conversation('other', agents[1].ref), conversation('scheduled', reference, { cronJobId: 'job' }), conversation('health', reference, { isHealthCheck: true })]);
});
afterEach(() => {
  cleanup();
  clearGuidDraft();
});

describe('Agent session navigation', () => {
  it('keeps template-only history as a conversation without presenting a persistent Agent', async () => {
    state.agents.mockResolvedValue({ success: true, data: [...agents, { ref: 'template-a', displayName: 'Template A', kind: 'template' }] });
    state.history.mockResolvedValue([conversation('current', 'template-a')]);
    renderPage();
    await screen.findByText('Fallback title');
    await waitFor(() => expect(screen.getByRole('button', { name: 'conversation.welcome.newConversation' })).toBeEnabled());
    expect(screen.queryByRole('combobox', { name: 'conversation.agentSessions.select' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'conversation.agentSessions.new' })).toBeNull();
  });

  it('shows the managed Agent and billing owner while keeping same-named owners apart', async () => {
    const context = { ownerId: 'alice', ownerName: 'Alice', agentName: 'research', displayName: 'Research Agent' };
    state.history.mockResolvedValue([
      conversation('current', 'moss-agent:nexus:cmVzZWFyY2g', { agentManagement: context }),
      conversation('pinned', 'moss-agent:nexus:cmVzZWFyY2g', { agentManagement: context }),
      conversation('other', 'moss-agent:nexus:cmVzZWFyY2g', { agentManagement: { ...context, ownerId: 'bob', ownerName: 'Bob' } }),
    ]);
    renderPage();
    await screen.findByText('Research Agent');
    expect(screen.getByText('conversation.agentSessions.ownerBilling')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'conversation.agentSessions.new' })).toBeNull();
    fireEvent.click(screen.getByRole('combobox', { name: 'conversation.agentSessions.select' }));
    await screen.findByText('Session pinned');
    expect(screen.queryByText('Session other')).toBeNull();
  });
  it('uses the personal default Agent for global New instead of retaining the current Agent', async () => {
    setGuidDraft({ input: 'Previous Agent draft' });
    renderPage();
    const button = screen.getByRole('button', { name: 'conversation.welcome.newConversation' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(screen.getByLabelText('route')).toHaveTextContent(`/guid?assistant=${encodeURIComponent('moss-agent:user:user-a')}`);
    expect(state.emit).toHaveBeenCalledExactlyOnceWith('guid.reset');
    expect(state.save).toHaveBeenCalledWith('guid.lastSelectedAgent', '');
    expect(getGuidDraft()).toBeUndefined();
  });

  it('keeps offline New available without an online Agent catalogue', async () => {
    state.isGuest = true;
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('sidebar history')).toHaveTextContent('current'));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.welcome.newConversation' }));
    expect(screen.getByLabelText('route').textContent).toBe('/guid');
    expect(state.agents).not.toHaveBeenCalled();
  });
  it('uses the current Agent name and offers its pinned history without another Agent or background runs', async () => {
    renderPage();
    await screen.findByText('Renamed Agent');
    fireEvent.click(screen.getByRole('combobox', { name: 'conversation.agentSessions.select' }));
    await screen.findByText('Session pinned');
    expect(screen.queryByText('Session other')).toBeNull();
    expect(screen.queryByText('Session scheduled')).toBeNull();
    expect(screen.queryByText('Session health')).toBeNull();
    fireEvent.click(screen.getByText('Session pinned'));
    await waitFor(() => expect(screen.getByLabelText('route')).toHaveTextContent('/conversation/pinned'));
  });

  it('keeps the Agent identity when starting a new session without allocating a runtime on navigation', async () => {
    setGuidDraft({ input: 'Previous Session draft' });
    renderPage();
    const button = await screen.findByRole('button', { name: 'conversation.agentSessions.new' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(screen.getByLabelText('route')).toHaveTextContent(`/guid?assistant=${encodeURIComponent(reference)}`);
    expect(state.emit).toHaveBeenCalledExactlyOnceWith('guid.reset');
    expect(getGuidDraft()).toBeUndefined();
  });

  it('loads history and installs subscriptions once for all three consumers', async () => {
    renderPage();
    await screen.findByText('Renamed Agent');
    expect(state.history).toHaveBeenCalledTimes(1);
    expect(state.agents).toHaveBeenCalledTimes(1);
    expect(state.onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('sidebar history')).toHaveTextContent('current,pinned,other,scheduled');
    expect(screen.getByLabelText('tab history')).toHaveTextContent('current,pinned,other,scheduled');
  });

  it('does not expose cached history or a late response after switching accounts', async () => {
    const page = renderPage();
    await screen.findByText('Renamed Agent');
    let resolveOld!: (sessions: TChatConversation[]) => void;
    state.history.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    );
    act(() => state.listeners.get('chat.history.refresh')?.());
    await waitFor(() => expect(state.history).toHaveBeenCalledTimes(2));
    state.userId = 'user-b';
    state.history.mockResolvedValue([]);
    state.agents.mockResolvedValue({ success: true, data: [] });
    page.rerender(page.element());
    await waitFor(() => expect(state.history).toHaveBeenCalledTimes(3));
    expect(screen.getByLabelText('sidebar history').textContent).toBe('');
    await act(async () => resolveOld([conversation('old-account-private')]));
    expect(screen.getByLabelText('sidebar history')).not.toHaveTextContent('old-account-private');
    expect(screen.queryByText('Renamed Agent')).toBeNull();
  });

  it('changes the query scope when the local or remote mode changes', async () => {
    renderPage();
    await screen.findByText('Renamed Agent');
    state.sessionMode = 'local';
    act(() => state.listeners.get('chat.history.refresh')?.());
    await waitFor(() => expect(state.history).toHaveBeenLastCalledWith({ page: 0, pageSize: 10000, sessionMode: 'local' }));
  });
});
