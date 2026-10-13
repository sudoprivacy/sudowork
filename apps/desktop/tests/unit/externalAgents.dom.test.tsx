import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ access: vi.fn(), agents: vi.fn(), sessions: vi.fn(), history: vi.fn(), create: vi.fn(), events: vi.fn(), emit: vi.fn(), close: vi.fn(), user: { id: 'user-a', enterprise_code: 'org-a' } }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ externalProviders: Object.fromEntries(['access', 'agents', 'sessions', 'history', 'create', 'events'].map((key) => [key, { invoke: mocks[key as 'access'] }])) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user, isGuest: false }) }));
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
vi.mock('@renderer/pages/conversation/context/ConversationTabsContext', () => ({ useConversationTabs: () => ({ closeAllTabs: mocks.close }) }));
vi.mock('@renderer/pages/conversation/preview', () => ({ usePreviewContext: () => ({ closePreview: mocks.close }) }));
vi.mock('@renderer/utils/clipboard', () => ({ copyText: vi.fn().mockResolvedValue(undefined) }));
import ExternalAgents from '@renderer/pages/external-agents';
import ExternalConversationPage from '@renderer/pages/external-agents/ExternalConversationPage';
import PublishedExternalAgents from '@renderer/pages/external-agents/PublishedExternalAgents';
import { useExternalHistory } from '@renderer/pages/external-agents/useExternalHistory';

const agent = { id: 'agent-1', name: 'Dify pilot', provider: 'dify' };
const task = { id: 'task-1', agent_id: 'agent-1', session_id: 'session-1', query: '6 * 7', answer: '42', status: 'succeeded', output_status: 'valid', error_code: null };
const session = { id: 'session-1', agent_id: agent.id, title: 'Test conversation', active_task_id: null, created_at: 1, updated_at: 2 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 'user-a', enterprise_code: 'org-a' };
  mocks.access.mockResolvedValue({ success: true, data: { can_manage: false, can_manage_policy: false, credential_storage_available: true } });
  mocks.agents.mockResolvedValue({ success: true, data: [agent] });
  mocks.sessions.mockResolvedValue({ success: true, data: [session] });
  mocks.history.mockResolvedValue({ success: true, data: [task] });
  mocks.create.mockResolvedValue({ success: true, data: task });
  mocks.events.mockResolvedValue({ success: true, data: { task, events: [], next_cursor: 4 } });
});
afterEach(cleanup);
function Location() {
  const location = useLocation();
  return <div data-testid='location'>{location.pathname + location.search}</div>;
}
function page(path = '/conversation/external:new?agent=agent-1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path='/conversation/:id' element={<ExternalConversationPage />} />
        <Route path='/app/agents/external' element={<ExternalAgents />} />
        <Route path='/app/agent' element={<PublishedExternalAgents />} />
      </Routes>
      <Location />
    </MemoryRouter>
  );
}

it('starts from the organization directory and uses the conversation route without installing a personal agent', async () => {
  page('/app/agent');
  await screen.findByText('Dify pilot');
  expect(screen.queryByText('agent.mine.create')).toBeNull();
  expect(screen.queryByRole('button', { name: 'agent.external.manage.title' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'agent.external.published.start' }));
  await screen.findByRole('log');
  expect(screen.getByTestId('location')).toHaveTextContent('/conversation/external%3Anew?agent=agent-1');
});

it('keeps administrator usage in the client and exposes no onboarding or management', async () => {
  mocks.access.mockResolvedValue({ success: true, data: { can_manage: true, can_manage_policy: true, credential_storage_available: true } });
  render(
    <MemoryRouter>
      <PublishedExternalAgents />
    </MemoryRouter>
  );
  await screen.findByText('Dify pilot');
  expect(screen.queryByRole('button', { name: 'agent.external.manage.title' })).toBeNull();
  expect(mocks.access).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /download|install|edit/i })).toBeNull();
});

it('sends the selected agent, refreshes shared history and restores the acknowledged conversation', async () => {
  page();
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'agent.external.query' })).not.toBeDisabled());
  fireEvent.change(screen.getByRole('textbox', { name: 'agent.external.query' }), { target: { value: '6 * 7' } });
  fireEvent.click(screen.getByRole('button', { name: 'agent.external.send' }));
  await screen.findByText('42');
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ agent_id: 'agent-1', query: '6 * 7', idempotency_key: expect.any(String) }));
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/conversation/external%3Asession-1'));
  expect(mocks.emit).toHaveBeenCalledWith('chat.history.refresh');
});

it('continues using the same session and Enter, but not Shift+Enter or IME composition', async () => {
  page('/conversation/external:session-1');
  await screen.findByText('42');
  const input = screen.getByRole('textbox', { name: 'agent.external.query' });
  fireEvent.change(input, { target: { value: 'add 8' } });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(mocks.create).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'session-1', agent_id: 'agent-1', query: 'add 8' })));
});

it('retains the exact request after ambiguous acceptance', async () => {
  mocks.create.mockResolvedValueOnce({ success: false });
  page();
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'agent.external.query' })).not.toBeDisabled());
  fireEvent.change(screen.getByRole('textbox', { name: 'agent.external.query' }), { target: { value: '6 * 7' } });
  fireEvent.click(screen.getByRole('button', { name: 'agent.external.send' }));
  await screen.findByText('agent.external.sendUnconfirmed');
  expect(screen.getByRole('textbox', { name: 'agent.external.query' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'agent.external.retrySameRequest' }));
  await screen.findByText('42');
  expect(mocks.create.mock.calls[0][0]).toEqual(mocks.create.mock.calls[1][0]);
});

it('redirects old links, preserves unavailable-agent history and prevents new dispatch', async () => {
  mocks.agents.mockResolvedValue({ success: true, data: [] });
  page('/app/agents/external?session=session-1');
  await screen.findByText('42');
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/conversation/external%3Asession-1'));
  expect(screen.getByRole('button', { name: 'agent.external.send' })).toBeDisabled();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
});

it('unknown locks the conversation and never advertises a stop button', async () => {
  mocks.history.mockResolvedValue({ success: true, data: [{ ...task, status: 'unknown' }] });
  page('/conversation/external:session-1');
  await screen.findByText('agent.external.unknown');
  expect(screen.getByRole('button', { name: 'agent.external.send' })).toBeDisabled();
  expect(mocks.events).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /cancel|stop/i })).toBeNull();
});

it('resumes reading an active task after reload without resending', async () => {
  mocks.history.mockResolvedValue({ success: true, data: [{ ...task, status: 'running', answer: '' }] });
  page('/conversation/external:session-1');
  await screen.findByText('42');
  expect(mocks.events).toHaveBeenCalledWith({ taskId: task.id, cursor: 0 });
  expect(mocks.create).not.toHaveBeenCalled();
});

it('retries event reads after failure without creating another task', async () => {
  mocks.history.mockResolvedValue({ success: true, data: [{ ...task, status: 'running', answer: '' }] });
  mocks.events.mockResolvedValueOnce({ success: false });
  page('/conversation/external:session-1');
  await screen.findByText('agent.external.pollFailed');
  fireEvent.click(screen.getByRole('button', { name: 'agent.external.refresh' }));
  await screen.findByText('42');
  expect(mocks.create).not.toHaveBeenCalled();
});

it('shows provider content without fetching embedded images or granting native file link behavior', async () => {
  mocks.history.mockResolvedValue({ success: true, data: [{ ...task, answer: '![remote](https://tracking.invalid/x) [file](file:///etc/passwd) <script>alert(1)</script>' }] });
  page('/conversation/external:session-1');
  await screen.findByText('remote');
  expect(document.querySelector('img')).toBeNull();
  expect(screen.getByText('file').getAttribute('href')).toBeNull();
  expect(document.querySelector('script')).toBeNull();
});

it('discards a former account’s pending directory response', async () => {
  let resolve!: (value: unknown) => void;
  mocks.agents.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  const view = render(
    <MemoryRouter>
      <PublishedExternalAgents />
    </MemoryRouter>
  );
  mocks.user = { id: 'user-b', enterprise_code: 'org-b' };
  mocks.agents.mockResolvedValue({ success: true, data: [] });
  view.rerender(
    <MemoryRouter>
      <PublishedExternalAgents />
    </MemoryRouter>
  );
  resolve({ success: true, data: [agent] });
  await waitFor(() => expect(mocks.agents).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Dify pilot')).toBeNull();
});

it('removes former account history immediately and ignores late results', async () => {
  let resolve!: (value: unknown) => void;
  mocks.sessions.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  function History() {
    const { conversations } = useExternalHistory();
    return (
      <div>
        {conversations.map((item) => (
          <span key={item.id}>{item.name}</span>
        ))}
      </div>
    );
  }
  const view = render(<History />);
  mocks.user = { id: 'user-b', enterprise_code: 'org-b' };
  mocks.sessions.mockResolvedValue({ success: true, data: [] });
  view.rerender(<History />);
  resolve({ success: true, data: [session] });
  await waitFor(() => expect(mocks.sessions).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Test conversation')).toBeNull();
});
