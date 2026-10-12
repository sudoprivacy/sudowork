import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ access: vi.fn(), agents: vi.fn(), sessions: vi.fn(), history: vi.fn(), create: vi.fn(), events: vi.fn() }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ externalProviders: Object.fromEntries(Object.entries(mocks).map(([key, invoke]) => [key, { invoke }])) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import ExternalAgents from '@renderer/pages/external-agents';

const agent = { id: 'agent-1', name: 'Dify pilot' };
const task = { id: 'task-1', agent_id: 'agent-1', session_id: 'session-1', query: '6 * 7', answer: '42', status: 'succeeded', output_status: 'valid', error_code: null };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ success: true, data: { can_manage: false, can_manage_policy: false, credential_storage_available: true } });
  mocks.agents.mockResolvedValue({ success: true, data: [agent] });
  mocks.sessions.mockResolvedValue({ success: true, data: [] });
  mocks.history.mockResolvedValue({ success: true, data: [task] });
  mocks.create.mockResolvedValue({ success: true, data: task });
  mocks.events.mockResolvedValue({ success: true, data: { task, events: [], next_cursor: 4 } });
});
afterEach(cleanup);
function page(path = '/app/agents/external') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ExternalAgents />
    </MemoryRouter>
  );
}

it('sends a selected agent and restores the acknowledged durable history', async () => {
  page();
  await screen.findByText('Dify pilot');
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'agent.external.query' })).not.toBeDisabled());
  fireEvent.change(screen.getByRole('textbox', { name: 'agent.external.query' }), { target: { value: '6 * 7' } });
  fireEvent.click(screen.getByRole('button', { name: 'agent.external.send' }));
  await screen.findByText('42');
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ agent_id: 'agent-1', query: '6 * 7', idempotency_key: expect.any(String) }));
  await waitFor(() => expect(mocks.history).toHaveBeenCalledWith({ sessionId: 'session-1' }));
});

it('retains the original idempotency key and query after ambiguous acceptance', async () => {
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

it('unknown locks the conversation and never advertises a stop button', async () => {
  mocks.sessions.mockResolvedValue({ success: true, data: [{ id: 'session-1', agent_id: agent.id, title: 'Test', active_task_id: task.id }] });
  mocks.history.mockResolvedValue({ success: true, data: [{ ...task, status: 'unknown' }] });
  page('/app/agents/external?session=session-1');
  await screen.findByText('agent.external.unknown');
  expect(screen.getByRole('button', { name: 'agent.external.send' })).toBeDisabled();
  expect(mocks.events).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /cancel|stop/i })).toBeNull();
});

it('resumes reading an active task after reload, then shows its terminal answer', async () => {
  mocks.history.mockResolvedValue({ success: true, data: [{ ...task, status: 'running', answer: '' }] });
  page('/app/agents/external?session=session-1');
  await screen.findByText('42');
  expect(mocks.events).toHaveBeenCalledWith({ taskId: task.id, cursor: 0 });
});

it('reports subscription failure without creating another task', async () => {
  mocks.history.mockResolvedValue({ success: true, data: [{ ...task, status: 'running', answer: '' }] });
  mocks.events.mockResolvedValue({ success: false });
  page('/app/agents/external?session=session-1');
  await screen.findByText('agent.external.pollFailed');
  expect(mocks.create).not.toHaveBeenCalled();
});
