import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TASK_API } from '@sudowork/contracts/task';
const mocks = vi.hoisted(() => ({ agents: vi.fn(), sessions: vi.fn(), history: vi.fn(), create: vi.fn(), events: vi.fn(), evidence: vi.fn(), cancel: vi.fn(), reconcile: vi.fn(), close: vi.fn(), clear: vi.fn(), emit: vi.fn(), identity: 'account-a' }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ hostedTasks: Object.fromEntries(['agents', 'sessions', 'history', 'create', 'events', 'evidence', 'cancel', 'reconcile', 'close'].map((key) => [key, { invoke: mocks[key as 'agents'] }])) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/pages/external-agents/useExternalDirectory', () => ({ useExternalIdentity: () => mocks.identity }));
vi.mock('@renderer/utils/emitter', () => ({ emitter: { emit: mocks.emit }, addEventListener: () => () => {} }));
vi.mock('@renderer/pages/conversation/ChatLayout', () => ({
  default: ({ children, headerLeft, headerExtra }: React.PropsWithChildren<{ headerLeft: React.ReactNode; headerExtra: React.ReactNode }>) => (
    <div>
      {headerLeft}
      {headerExtra}
      {children}
    </div>
  ),
}));
vi.mock('@renderer/pages/conversation/context/ConversationTabsContext', () => ({ useConversationTabs: () => ({ closeAllTabs: mocks.clear }) }));
vi.mock('@renderer/pages/conversation/preview', () => ({ usePreviewContext: () => ({ closePreview: mocks.clear }) }));
vi.mock('@renderer/components/Markdown', () => ({ default: ({ children, isExternalContent }: { children: string; isExternalContent: boolean }) => <div data-external={isExternalContent}>{children}</div> }));
import HostedConversationPage from '@renderer/pages/hosted-agents/HostedConversationPage';
import PublishedHostedAgents from '@renderer/pages/hosted-agents/PublishedHostedAgents';
const agent = { id: 'agent-1', name: 'Hosted LangGraph', source_platform: 'langgraph', version: 'v1' };
const task = {
  api_version: TASK_API,
  kind: 'HostedTask',
  id: 'task-1',
  catalog_id: 'agent-1',
  session_id: 'session-1',
  asset_id: 'asset-1',
  attempt_id: 'attempt-1',
  query: '6 * 7',
  answer: '42',
  status: 'succeeded',
  cleanup: 'confirmed',
  cancel_requested_at: null,
  error_code: null,
  created_at: 1,
  updated_at: 2,
  deadline_at: 10000,
  sequence: 4,
  session_sequence: 1,
};
const session = { id: 'session-1', agent_id: 'agent-1', title: 'Test', status: 'succeeded', closed: false, updated_at: 2 };
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.identity = 'account-a';
  mocks.agents.mockResolvedValue({ success: true, data: [agent] });
  mocks.sessions.mockResolvedValue({ success: true, data: [session] });
  mocks.history.mockResolvedValue({ success: true, data: [task] });
  mocks.create.mockResolvedValue({ success: true, data: task });
});
afterEach(cleanup);
function Location() {
  const location = useLocation();
  return <div data-testid='location'>{location.pathname + location.search}</div>;
}
function page(path = '/conversation/hosted:new?agent=agent-1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path='/conversation/:id' element={<HostedConversationPage />} />
        <Route path='/app/agent' element={<PublishedHostedAgents />} />
      </Routes>
      <Location />
    </MemoryRouter>
  );
}
async function ready(name: string) {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
}
it('uses organization hosted directory and shared conversation without a personal agent', async () => {
  page('/app/agent');
  await screen.findByText(agent.name);
  await ready('agent.external.published.start');
  expect(screen.getByTestId('location')).toHaveTextContent('/conversation/hosted%3Anew?agent=agent-1');
  expect(await screen.findByRole('log')).toBeVisible();
  expect(screen.queryByText('agent.mine.create')).toBeNull();
});
it('retains an ambiguous request across reload with the same key and version', async () => {
  mocks.create.mockRejectedValueOnce(new Error('lost reply'));
  const view = page();
  const input = await screen.findByRole('textbox', { name: 'agent.external.query' });
  await waitFor(() => expect(input).not.toBeDisabled());
  fireEvent.change(input, { target: { value: '6 * 7' } });
  await ready('agent.external.send');
  await screen.findByRole('button', { name: 'agent.external.retrySameRequest' });
  const original = mocks.create.mock.calls[0][0];
  expect(original.requested_version).toBe('v1');
  view.unmount();
  page();
  await ready('agent.external.retrySameRequest');
  await screen.findByText('42');
  expect(mocks.create.mock.calls[1][0]).toEqual(original);
  expect(sessionStorage.length).toBe(0);
});
it('preserves unknown output and requires cleanup plus note to close, without declaring success', async () => {
  const unknown = { ...task, status: 'unknown', answer: 'partial', cleanup: 'unknown', error_code: 'CLEANUP_UNKNOWN' };
  mocks.history.mockResolvedValue({ success: true, data: [unknown] });
  mocks.reconcile.mockResolvedValue({ success: true, data: { ...unknown, cleanup: 'confirmed', sequence: 5 } });
  mocks.close.mockResolvedValue({ success: true, data: { ...unknown, cleanup: 'confirmed', sequence: 6 } });
  page('/conversation/hosted:session-1');
  await screen.findByText('partial');
  expect(screen.queryByRole('button', { name: 'agent.hosted.close' })).toBeNull();
  await ready('agent.hosted.reconcile');
  expect(await screen.findByRole('button', { name: 'agent.hosted.close' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'agent.hosted.closeNote' }), { target: { value: 'Cleanup confirmed; result remains unknown.' } });
  await ready('agent.hosted.close');
  await waitFor(() => expect(screen.queryByRole('button', { name: 'agent.hosted.close' })).toBeNull());
  expect(screen.getByText('agent.external.status.unknown')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'agent.external.query' })).toBeDisabled();
  expect(mocks.create).not.toHaveBeenCalled();
});
it('discards late history after identity disappears', async () => {
  let resolve!: (value: unknown) => void;
  mocks.history.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  const view = page('/conversation/hosted:session-1');
  await waitFor(() => expect(mocks.history).toHaveBeenCalled());
  mocks.identity = '';
  view.rerender(
    <MemoryRouter>
      <HostedConversationPage />
    </MemoryRouter>
  );
  await act(async () => {
    resolve({ success: true, data: [task] });
  });
  expect(screen.queryByText('42')).toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
});
