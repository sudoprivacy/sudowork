import '@arco-design/web-react/lib/_util/react-19-adapter';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import StudioConversationPanel from '@renderer/pages/ontology/StudioConversationPanel';
import locale from '../../../../packages/renderer/src/i18n/locales/zh-CN/ontology.json';

const bridge = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), register: vi.fn(), prepare: vi.fn(), get: vi.fn(), update: vi.fn(), remove: vi.fn(), listeners: new Set<(event: { workspaceId: string }) => void>() }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  conversation: { create: { invoke: bridge.create }, get: { invoke: bridge.get }, update: { invoke: bridge.update } },
  ontologyAiBuilder: {
    listSessions: { invoke: bridge.list },
    createSession: { invoke: bridge.register },
    ensureBuilderMcp: { invoke: bridge.prepare },
    deleteSession: { invoke: bridge.remove },
    sessionsChanged: {
      on: (callback: (event: { workspaceId: string }) => void) => {
        bridge.listeners.add(callback);
        return () => bridge.listeners.delete(callback);
      },
    },
  },
}));
vi.mock('@renderer/pages/conversation/acp/AcpChat', () => ({ default: ({ conversation_id }: { conversation_id: string }) => <div data-testid='ready-conversation'>{conversation_id}</div> }));
const i18n = createInstance();
void i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: { ontology: locale } } }, interpolation: { escapeValue: false } });
const session = { id: 'registry', workspaceId: 'northwind', conversationId: 'northwind-chat', title: 'Northwind本体', createdAt: 1, updatedAt: 1 };
let sessions: (typeof session)[];
function mount() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <StudioConversationPanel workspaceId='northwind' workspaceName='Northwind本体' />
      </MemoryRouter>
    </I18nextProvider>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  bridge.listeners.clear();
  sessions = [];
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() });
  bridge.list.mockImplementation(async () => ({ success: true, data: { items: [...sessions] } }));
  bridge.create.mockResolvedValue({ id: session.conversationId });
  bridge.register.mockImplementation(async () => {
    sessions = [session];
    return { success: true, data: session };
  });
  bridge.prepare.mockResolvedValue({ success: true, data: { mcpConfig: { name: 'ontology-builder' } } });
  bridge.get.mockResolvedValue({ id: session.conversationId, type: 'acp', extra: { purpose: 'ontology', ontologyId: 'northwind', workspace: '/tmp/northwind', backend: 'scode' } });
  bridge.update.mockResolvedValue(true);
  bridge.remove.mockImplementation(async () => {
    sessions = [];
    for (const listener of bridge.listeners) listener({ workspaceId: 'northwind' });
    return { success: true };
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ontology conversation setup', () => {
  it('automatically creates a same-name default conversation when the workspace opens', async () => {
    mount();
    await screen.findByTestId('ready-conversation');
    expect(bridge.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'Northwind本体', extra: expect.objectContaining({ purpose: 'ontology', ontologyId: 'northwind' }) }));
    expect(bridge.register).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'northwind', conversationId: 'northwind-chat', title: 'Northwind本体' });
  });

  it('shows setup failure and retries without requiring another ontology or conversation name', async () => {
    bridge.create.mockResolvedValueOnce({ __error: 'Runtime download failed' });
    mount();
    expect(await screen.findByText('Runtime download failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试初始化对话' }));
    await screen.findByTestId('ready-conversation');
    expect(bridge.create).toHaveBeenCalledTimes(2);
    expect(bridge.register).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ends the visible wait after a timeout and reuses the pending request on retry', async () => {
    vi.useFakeTimers();
    let finish!: (value: { id: string }) => void;
    bridge.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('正在准备本体对话，可继续编辑右侧本体…')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByRole('button', { name: '重试初始化对话' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试初始化对话' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(bridge.create).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ id: session.conversationId });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('ready-conversation')).toHaveTextContent('northwind-chat');
    expect(bridge.register).toHaveBeenCalledTimes(1);
  });

  it('reuses existing sessions and allows retrying tool setup without creating duplicates', async () => {
    sessions = [session];
    bridge.prepare.mockResolvedValueOnce({ success: false, msg: 'Tools unavailable' });
    mount();
    expect(await screen.findByText('Tools unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试初始化对话' }));
    await screen.findByTestId('ready-conversation');
    expect(bridge.create).not.toHaveBeenCalled();
  });

  it('does not recreate a session after the user explicitly deletes it', async () => {
    sessions = [session];
    mount();
    await screen.findByTestId('ready-conversation');
    fireEvent.click(screen.getByRole('button', { name: locale.studio.deleteSession }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /确定|OK/ }));
    await waitFor(() => expect(screen.queryByTestId('ready-conversation')).not.toBeInTheDocument());
    expect(bridge.create).not.toHaveBeenCalled();
    expect(bridge.remove).toHaveBeenCalledOnce();
  });
});
