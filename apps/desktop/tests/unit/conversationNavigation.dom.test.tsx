import React, { useState, type PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@sudowork/common/storage';
import type { IMyAgent } from '@sudowork/common/personalAgents';

const state = vi.hoisted(() => ({ get: vi.fn(), conversations: [] as TChatConversation[], agents: [] as IMyAgent[], closePreview: vi.fn(), openTab: vi.fn() }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  conversation: { get: { invoke: state.get } },
  skillHub: { changed: { on: () => () => {} } },
}));
vi.mock('@renderer/hooks/useAppMode', () => ({ useAppMode: () => ({ isEnterprise: true }) }));
vi.mock('@renderer/utils/platform', () => ({ isWebBridgeAvailable: () => true }));
vi.mock('@renderer/utils/emitter', () => ({ addEventListener: () => () => {}, emitter: { emit: vi.fn() } }));
vi.mock('@renderer/pages/conversation/preview', () => ({ usePreviewContext: () => ({ closePreview: state.closePreview }) }));
vi.mock('@renderer/pages/conversation/context/ConversationTabsContext', () => ({ useConversationTabs: () => ({ openTab: state.openTab }) }));
vi.mock('@renderer/pages/conversation/context/ConversationHistoryContext', () => ({ useConversationHistory: () => ({ conversations: state.conversations, agents: state.agents }) }));
vi.mock('@renderer/hooks/usePresetAssistantInfo', () => ({ usePresetAssistantInfo: () => ({}) }));
vi.mock('@renderer/components/AgentStatusBanner', () => ({ default: () => null }));
vi.mock('@renderer/components/AcpModelSelector', () => ({ default: () => null }));
vi.mock('@renderer/pages/conversation/ChatSider', () => ({ default: () => null }));
vi.mock('@renderer/pages/conversation/workspace/TaskPanelHeaderContext', () => ({ TaskPanelHeaderProvider: ({ children }: PropsWithChildren) => children }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/pages/conversation/acp/AcpChat', () => ({
  default: ({ conversation_id, agentName, sessionMode }: { conversation_id: string; agentName?: string; sessionMode?: string }) => (
    <>
      <textarea aria-label={`Send to ${conversation_id}`} />
      <output aria-label={`Recipient ${conversation_id}`}>{agentName}</output>
      <output aria-label={`Permission mode ${conversation_id}`}>{sessionMode}</output>
    </>
  ),
}));
vi.mock('@renderer/pages/conversation/ChatLayout', () => ({
  default: function Frame({ children, conversationId, executionTarget }: PropsWithChildren<{ conversationId?: string; executionTarget?: 'local' | 'remote' }>) {
    const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(true);
    return (
      <section aria-label='Conversation frame'>
        <header>
          <span>{conversationId}</span>
          <output aria-label='Execution target'>{executionTarget}</output>
          <button onClick={() => setIsWorkspaceOpen((isOpen) => !isOpen)}>Toggle workspace</button>
        </header>
        {isWorkspaceOpen && <aside>Workspace</aside>}
        {children}
      </section>
    );
  },
}));

import ChatConversationIndex from '@renderer/pages/conversation';

function Navigation() {
  const navigate = useNavigate();
  return <button onClick={() => void navigate('/conversation/next')}>Next session</button>;
}

function renderConversation() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <MemoryRouter initialEntries={['/conversation/current']}>
        <Navigation />
        <Routes>
          <Route path='/conversation/:id' element={<ChatConversationIndex />} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state.agents = [];
  state.conversations = ['current', 'next'].map((id) => ({ id, name: id, type: 'remote-agent', createTime: 1, modifyTime: 1, extra: {} }) as TChatConversation);
});
afterEach(cleanup);

describe('Conversation navigation', () => {
  it('preserves the frame while loading another session and removes the old sender immediately', async () => {
    let resolveNext!: (conversation: TChatConversation) => void;
    const next = new Promise<TChatConversation>((resolve) => {
      resolveNext = resolve;
    });
    state.get.mockImplementation(({ id }: { id: string }) => (id === 'current' ? Promise.resolve(state.conversations[0]) : next));
    renderConversation();
    await screen.findByRole('textbox', { name: 'Send to current' });
    const frame = screen.getByRole('region', { name: 'Conversation frame' });
    const header = frame.querySelector('header');
    fireEvent.click(screen.getByText('Toggle workspace'));
    expect(screen.queryByText('Workspace')).toBeNull();

    fireEvent.click(screen.getByText('Next session'));
    await screen.findByRole('status', { name: 'common.loading' });
    expect(screen.getByRole('region', { name: 'Conversation frame' })).toBe(frame);
    expect(frame.querySelector('header')).toBe(header);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('Workspace')).toBeNull();

    await act(async () => {
      resolveNext(state.conversations[1]);
    });
    await screen.findByRole('textbox', { name: 'Send to next' });
    expect(screen.getByRole('region', { name: 'Conversation frame' })).toBe(frame);
    expect(frame.querySelector('header')).toBe(header);
    expect(screen.queryByText('Workspace')).toBeNull();
  });

  it('keeps a failed target inside the frame and retries without restoring the old sender', async () => {
    state.get.mockResolvedValueOnce(state.conversations[0]).mockRejectedValueOnce(new Error('Target unavailable')).mockResolvedValue(state.conversations[1]);
    renderConversation();
    await screen.findByRole('textbox', { name: 'Send to current' });
    const frame = screen.getByRole('region', { name: 'Conversation frame' });
    fireEvent.click(screen.getByText('Next session'));
    await screen.findByText('common.errorBoundaryTitle');
    expect(screen.getByRole('region', { name: 'Conversation frame' })).toBe(frame);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Send to next' })).toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Conversation frame' })).toBe(frame);
  });

  it('updates the execution location from persisted conversation metadata', async () => {
    state.conversations = [{ id: 'current', name: 'current', type: 'remote-agent', createTime: 1, modifyTime: 1, extra: {} } as TChatConversation, { id: 'next', name: 'next', type: 'acp', createTime: 1, modifyTime: 1, extra: { backend: 'scode', executionTarget: 'local' } } as TChatConversation];
    state.get.mockImplementation(({ id }: { id: string }) => Promise.resolve(state.conversations.find((conversation) => conversation.id === id)));
    renderConversation();

    await waitFor(() => expect(screen.getByLabelText('Execution target')).toHaveTextContent('remote'));
    fireEvent.click(screen.getByText('Next session'));
    await waitFor(() => expect(screen.getByLabelText('Execution target')).toHaveTextContent('local'));
  });

  it('uses a friendly Agent name instead of exposing an internal personal reference', async () => {
    const reference = 'moss-agent:own:22222222-2222-4222-8222-222222222222';
    state.agents = [{ ref: reference, displayName: 'Friendly Agent', kind: 'own' }];
    state.conversations = [{ id: 'current', name: 'current', type: 'remote-agent', createTime: 1, modifyTime: 1, extra: { mossAssistantRef: reference, agentName: reference } } as TChatConversation];
    state.get.mockResolvedValue(state.conversations[0]);
    renderConversation();
    await waitFor(() => expect(screen.getByLabelText('Recipient current')).toHaveTextContent('Friendly Agent'));
    expect(screen.getByLabelText('Recipient current')).not.toHaveTextContent('moss-agent:');
  });

  it('uses a generic Agent label when an internal reference is no longer in the catalogue', async () => {
    const reference = 'moss-agent:own:33333333-3333-4333-8333-333333333333';
    state.conversations = [{ id: 'current', name: 'current', type: 'remote-agent', createTime: 1, modifyTime: 1, extra: { mossAssistantRef: reference, agentName: reference } } as TChatConversation];
    state.get.mockResolvedValue(state.conversations[0]);
    renderConversation();
    await waitFor(() => expect(screen.getByLabelText('Recipient current')).toHaveTextContent('conversation.sidebar.myAgent'));
    expect(screen.getByLabelText('Recipient current')).not.toHaveTextContent('moss-agent:');
  });

  it.each([
    { dangerouslySkipPermissions: true, expectedMode: 'yolo' },
    { dangerouslySkipPermissions: false, expectedMode: 'default' },
  ])('restores the persisted remote permission mode ($expectedMode)', async ({ dangerouslySkipPermissions, expectedMode }) => {
    state.conversations = [{ id: 'current', name: 'current', type: 'remote-agent', createTime: 1, modifyTime: 1, extra: { sessionMode: 'remote', dangerouslySkipPermissions } } as TChatConversation];
    state.get.mockResolvedValue(state.conversations[0]);
    renderConversation();
    await waitFor(() => expect(screen.getByLabelText('Permission mode current')).toHaveTextContent(expectedMode));
  });
});
