import '@arco-design/web-react/lib/_util/react-19-adapter';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Message } from '@arco-design/web-react';
import { createDefaultOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import OntologyPage from '@renderer/pages/ontology';
import { ensureDefaultStudioConversation, requestStudioAiRepair } from '@renderer/pages/ontology/studioConversation';
import locale from '../../../../packages/renderer/src/i18n/locales/zh-CN/ontology.json';

const bridge = vi.hoisted(() => ({
  createWorkbench: vi.fn(),
  listWorkbenches: vi.fn(),
  getWorkbench: vi.fn(),
  listSessions: vi.fn(),
  ensureBuilderMcp: vi.fn(),
  createConversation: vi.fn(),
  createSession: vi.fn(),
  getConversation: vi.fn(),
  updateConversation: vi.fn(),
  sendMessage: vi.fn(),
}));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  ontology: {
    createWorkbench: { invoke: bridge.createWorkbench },
    listWorkbenches: { invoke: bridge.listWorkbenches },
    getWorkbench: { invoke: bridge.getWorkbench },
    workbenchChanged: { on: () => () => {} },
  },
  conversation: { create: { invoke: bridge.createConversation }, get: { invoke: bridge.getConversation }, update: { invoke: bridge.updateConversation }, sendMessage: { invoke: bridge.sendMessage } },
  ontologyAiBuilder: {
    listSessions: { invoke: bridge.listSessions },
    ensureBuilderMcp: { invoke: bridge.ensureBuilderMcp },
    createSession: { invoke: bridge.createSession },
  },
}));
vi.mock('@renderer/pages/ontology/StudioConversationPanel', () => ({ default: () => <div data-testid='studio-chat' /> }));

const i18n = createInstance();
void i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { translation: { ontology: locale } } }, interpolation: { escapeValue: false } });
const snapshot = createDefaultOntologyWorkbenchSnapshot(1, { workspaceId: 'orders', title: '订单模型' });
const session = { id: 'session-1', workspaceId: 'orders', conversationId: 'chat-1', title: '订单模型', createdAt: 1, updatedAt: 1 };
const input = { workspaceId: 'orders', title: '订单模型' };

function mount(path = '/app/ontology') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path='/app/ontology/:ontologyId?/:view?' element={<OntologyPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>
  );
}

async function onCreateOntology() {
  fireEvent.click(await screen.findByRole('button', { name: '新建本体' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: '名称' }), { target: { value: '订单模型' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /确定|OK/ }));
}

beforeEach(() => {
  vi.resetAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() });
  bridge.listWorkbenches.mockResolvedValue({ success: true, data: { activeWorkspaceId: '', items: [] } });
  bridge.createWorkbench.mockResolvedValue({ success: true, data: { snapshot } });
  bridge.getWorkbench.mockResolvedValue({ success: true, data: snapshot });
  bridge.listSessions.mockResolvedValue({ success: true, data: { items: [] } });
  bridge.ensureBuilderMcp.mockResolvedValue({ success: true, data: { mcpConfig: { name: 'ontology-builder' } } });
  bridge.createConversation.mockResolvedValue({ id: 'chat-1' });
  bridge.createSession.mockResolvedValue({ success: true, data: session });
  bridge.getConversation.mockResolvedValue({ id: 'chat-1', type: 'acp', status: 'finished', extra: { purpose: 'ontology', ontologyId: 'orders' } });
  bridge.updateConversation.mockResolvedValue(true);
  bridge.sendMessage.mockResolvedValue({ success: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ontology default conversation', () => {
  it('creates a same-name ontology conversation before opening a new workbench', async () => {
    mount();
    await onCreateOntology();
    await screen.findByTestId('studio-chat');
    expect(bridge.createConversation).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'acp', name: '订单模型', extra: expect.objectContaining({ purpose: 'ontology', ontologyId: 'orders', extraMcpConfigs: [{ name: 'ontology-builder' }] }) }));
    expect(bridge.createSession).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'orders', conversationId: 'chat-1', title: '订单模型' });
    expect(bridge.createWorkbench.mock.invocationCallOrder[0]).toBeLessThan(bridge.ensureBuilderMcp.mock.invocationCallOrder[0]);
    expect(bridge.ensureBuilderMcp.mock.invocationCallOrder[0]).toBeLessThan(bridge.createConversation.mock.invocationCallOrder[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does not create another conversation when opening an existing workbench', async () => {
    const view = mount('/app/ontology/orders/model');
    await screen.findByTestId('studio-chat');
    view.unmount();
    mount('/app/ontology/orders/model');
    await screen.findByTestId('studio-chat');
    expect(bridge.createConversation).not.toHaveBeenCalled();
    expect(bridge.createWorkbench).not.toHaveBeenCalled();
  });

  it('keeps the created ontology accessible when its default conversation fails', async () => {
    bridge.ensureBuilderMcp.mockResolvedValue({ success: false });
    const warning = vi.spyOn(Message, 'warning').mockReturnValue(vi.fn());
    mount();
    await onCreateOntology();
    await screen.findByTestId('studio-chat');
    expect(warning).toHaveBeenCalledWith(locale.studio.errors.defaultSessionFailed);
    expect(bridge.createWorkbench).toHaveBeenCalledTimes(1);
    expect(bridge.createConversation).not.toHaveBeenCalled();
  });

  it('reuses an existing session within the requested ontology', async () => {
    bridge.listSessions.mockResolvedValue({ success: true, data: { items: [{ ...session, workspaceId: 'other', updatedAt: 100 }, session] } });
    await expect(ensureDefaultStudioConversation(input)).resolves.toEqual(session);
    expect(bridge.listSessions).toHaveBeenCalledWith({ workspaceId: 'orders' });
    expect(bridge.createConversation).not.toHaveBeenCalled();
  });

  it('coalesces concurrent default creation requests', async () => {
    const first = ensureDefaultStudioConversation(input);
    const second = ensureDefaultStudioConversation(input);
    expect(first).toBe(second);
    await expect(Promise.all([first, second])).resolves.toEqual([session, session]);
    expect(bridge.createConversation).toHaveBeenCalledTimes(1);
    expect(bridge.createSession).toHaveBeenCalledTimes(1);
  });

  it('allows retry after a failed creation attempt', async () => {
    bridge.createConversation.mockResolvedValueOnce({ __error: 'Runtime unavailable' });
    await expect(ensureDefaultStudioConversation(input)).rejects.toThrow('Runtime unavailable');
    expect(bridge.createSession).not.toHaveBeenCalled();
    await expect(ensureDefaultStudioConversation(input)).resolves.toEqual(session);
    expect(bridge.createConversation).toHaveBeenCalledTimes(2);
    expect(bridge.createSession).toHaveBeenCalledTimes(1);
  });
});

describe('ontology AI check repairs', () => {
  it('reuses an owned conversation, refreshes tools, and sends the requested repair exactly once', async () => {
    bridge.listSessions.mockResolvedValue({ success: true, data: { items: [session] } });
    const onReady = vi.fn();
    await requestStudioAiRepair({ ...input, prompt: 'Repair the checked relation' }, onReady);
    expect(bridge.createConversation).not.toHaveBeenCalled();
    expect(bridge.updateConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'chat-1', mergeExtra: true, updates: { extra: expect.objectContaining({ extraMcpConfigs: [{ name: 'ontology-builder' }] }) } }));
    expect(onReady).toHaveBeenCalledExactlyOnceWith('chat-1');
    expect(bridge.sendMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ conversation_id: 'chat-1', input: 'Repair the checked relation', msg_id: expect.any(String) }));
    expect(onReady.mock.invocationCallOrder[0]).toBeLessThan(bridge.sendMessage.mock.invocationCallOrder[0]);
  });

  it('rejects a conversation from another ontology without sending a repair', async () => {
    bridge.getConversation.mockResolvedValue({ id: 'chat-1', type: 'acp', extra: { purpose: 'ontology', ontologyId: 'other' } });
    await expect(requestStudioAiRepair({ ...input, prompt: 'Repair' }, vi.fn())).rejects.toThrow('ontology.studio.errors.repairScope');
    expect(bridge.sendMessage).not.toHaveBeenCalled();
  });

  it('does not interrupt an active conversation or report a failed dispatch as accepted', async () => {
    bridge.getConversation.mockResolvedValueOnce({ id: 'chat-1', type: 'acp', status: 'running', extra: { purpose: 'ontology', ontologyId: 'orders' } });
    await expect(requestStudioAiRepair({ ...input, prompt: 'Repair' }, vi.fn())).rejects.toThrow('ontology.studio.errors.repairBusy');
    expect(bridge.sendMessage).not.toHaveBeenCalled();
    bridge.sendMessage.mockResolvedValueOnce({ success: false, msg: 'busy' });
    await expect(requestStudioAiRepair({ ...input, prompt: 'Repair' }, vi.fn())).rejects.toThrow('ontology.studio.errors.repairBusy');
  });
});
