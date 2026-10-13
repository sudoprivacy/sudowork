import React from 'react';
import { Button, Message } from '@arco-design/web-react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@sudowork/common/storage';

const state = vi.hoisted(() => ({ userId: 'user-a', organization: 'org-a', role: 'USER', mode: 'remote', history: vi.fn(), agents: vi.fn(), changed: vi.fn(), emit: vi.fn(), listeners: new Map<string, () => void>() }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ user: { id: state.userId, enterprise_code: state.organization, role: state.role }, ready: true, status: 'authenticated' }) }));
vi.mock('@renderer/pages/guid/hooks/useGuidAgentSelection', () => ({ getRendererSessionMode: () => state.mode }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ eeclaw: { getMyAgents: { invoke: state.agents } }, database: { getUserConversations: { invoke: state.history }, conversationChanged: { on: state.changed } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/utils/emitter', () => ({
  emitter: { emit: state.emit },
  addEventListener: (event: string, callback: () => void) => {
    state.listeners.set(event, callback);
    return () => state.listeners.delete(event);
  },
}));

import { ConversationHistoryProvider, useConversationHistory } from '@renderer/pages/conversation/context/ConversationHistoryContext';
import { useAgentEntry } from '@renderer/pages/conversation/hooks/useAgentEntry';
import { clearGuidDraft, getGuidDraft, setGuidDraft } from '@renderer/pages/guid/hooks/useGuidDraft';
import { resolveAssistantEntryReference, toBackendConfig } from '@renderer/shared/agents/assistantAdapter';

const template = toBackendConfig({ id: '30ae1f95-2b32-48b6-a58b-6239e8bf956c', name: 'recruitment_expert', enabled: true, isBuiltin: false, isHubInstalled: true, category: 'hub', meta: { display_name: 'Recruiter' } });
const reference = resolveAssistantEntryReference(template, true);
function conversation(id: string, time: number, extra = {}): TChatConversation {
  return { id, name: id, type: 'remote-agent', createTime: time, modifyTime: time, extra: { mossAssistantRef: reference, ...extra } } as TChatConversation;
}
function Entry() {
  const { openingReference, onOpenAgent } = useAgentEntry();
  const { conversations } = useConversationHistory();
  const location = useLocation();
  return (
    <>
      <Button loading={openingReference !== null} disabled={openingReference !== null} onClick={() => void onOpenAgent(reference)}>
        Use template
      </Button>
      <output aria-label='route'>{location.pathname + location.search}</output>
      <output aria-label='shared history'>{conversations.map((session) => session.id).join(',')}</output>
    </>
  );
}
function renderEntry() {
  const config = { provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false };
  function element() {
    return (
      <SWRConfig value={config}>
        <MemoryRouter initialEntries={['/agents']}>
          <ConversationHistoryProvider>
            <Entry />
          </ConversationHistoryProvider>
        </MemoryRouter>
      </SWRConfig>
    );
  }
  return { ...render(element()), element };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((callback) => {
    resolve = callback;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.userId = 'user-a';
  state.organization = 'org-a';
  state.role = 'USER';
  state.mode = 'remote';
  state.listeners.clear();
  state.changed.mockReturnValue(() => {});
  state.agents.mockResolvedValue({ success: true, data: [] });
  state.history.mockResolvedValue([conversation('cached', 1)]);
  setGuidDraft({ input: 'Keep this draft until navigation succeeds' });
});
afterEach(() => {
  cleanup();
  clearGuidDraft();
  vi.restoreAllMocks();
});

describe('shared Agent entry', () => {
  it('opens fresh latest history, including pinned sessions, and updates the shared source', async () => {
    renderEntry();
    await screen.findByText('cached');
    state.history.mockResolvedValue([conversation('older', 2), conversation('latest', 3, { pinned: true }), conversation('foreign', 99, { mossAssistantRef: 'another-agent' }), conversation('scheduled', 99, { cronJobId: 'job' }), conversation('health', 99, { isHealthCheck: true })]);
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
    await waitFor(() => expect(screen.getByLabelText('route')).toHaveTextContent('/conversation/latest'));
    expect(screen.getByLabelText('shared history')).toHaveTextContent('older,latest,foreign,scheduled');
    expect(state.history).toHaveBeenLastCalledWith({ page: 0, pageSize: 10000, sessionMode: 'remote' });
    expect(getGuidDraft()).toBeUndefined();
    expect(state.emit).toHaveBeenCalledExactlyOnceWith('guid.reset');
  });
  it('opens an unused Agent draft without creating a Session', async () => {
    state.history.mockResolvedValue([]);
    renderEntry();
    await waitFor(() => expect(state.history).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
    await waitFor(() => expect(screen.getByLabelText('route')).toHaveTextContent(`/guid?assistant=${reference}`));
    expect(getGuidDraft()).toBeUndefined();
  });
  it('keeps the route and draft on failure and lets the user retry', async () => {
    const onError = vi.spyOn(Message, 'error').mockImplementation(() => 'error');
    renderEntry();
    await screen.findByText('cached');
    state.history.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('agent.mine.openFailed'));
    expect(screen.getByLabelText('route').textContent).toBe('/agents');
    expect(getGuidDraft()?.input).toBe('Keep this draft until navigation succeeds');
    expect(state.emit).not.toHaveBeenCalled();
    state.history.mockResolvedValue([conversation('retry', 2)]);
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
    await waitFor(() => expect(screen.getByLabelText('route')).toHaveTextContent('/conversation/retry'));
  });
  it('prevents duplicate clicks while history is loading', async () => {
    renderEntry();
    await screen.findByText('cached');
    const pending = deferred<TChatConversation[]>();
    state.history.mockReturnValueOnce(pending.promise);
    const button = screen.getByRole('button', { name: 'Use template' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(state.history).toHaveBeenCalledTimes(2));
    expect(button).toBeDisabled();
    await act(async () => pending.resolve([conversation('latest', 2)]));
    await waitFor(() => expect(screen.getByLabelText('route')).toHaveTextContent('/conversation/latest'));
    expect(state.history).toHaveBeenCalledTimes(2);
  });
  it.each(['account', 'organization', 'role', 'mode'])('discards a late response after changing %s', async (change) => {
    const page = renderEntry();
    await screen.findByText('cached');
    const pending = deferred<TChatConversation[]>();
    state.history.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
    await waitFor(() => expect(state.history).toHaveBeenCalledTimes(2));
    state.history.mockResolvedValue([]);
    if (change !== 'mode') {
      if (change === 'account') state.userId = 'user-b';
      else if (change === 'organization') state.organization = 'org-b';
      else state.role = 'ADMIN';
      page.rerender(page.element());
    } else {
      state.mode = 'local';
      act(() => state.listeners.get('chat.history.refresh')?.());
    }
    await waitFor(() => expect(state.history).toHaveBeenCalledTimes(3));
    await act(async () => pending.resolve([conversation('private-old-session', 9)]));
    expect(screen.getByLabelText('route').textContent).toBe('/agents');
    expect(screen.getByLabelText('shared history')).not.toHaveTextContent('private-old-session');
    expect(state.emit).not.toHaveBeenCalled();
    expect(getGuidDraft()?.input).toBe('Keep this draft until navigation succeeds');
    expect(screen.getByRole('button', { name: 'Use template' })).toBeEnabled();
  });
});
