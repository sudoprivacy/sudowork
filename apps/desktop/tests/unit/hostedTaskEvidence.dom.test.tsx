import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ evidence: vi.fn() }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ hostedTasks: { evidence: { invoke: mocks.evidence } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, args?: Record<string, unknown>) => `${key}${args ? JSON.stringify(args) : ''}` }) }));
import HostedTaskEvidencePanel from '@renderer/pages/hosted-agents/HostedTaskEvidencePanel';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const page = {
  task_id: 'task-a',
  captured_at: 1,
  release: { version: 'fixed-v1', artifact_id: 'artifact-a', spec_digest: 'digest-a' },
  cleanup: 'confirmed',
  usage: { status: 'pending', verified_quota: 0, verified_prompt_tokens: 0, verified_completion_tokens: 0 },
  trace: [{ sequence: 1, created_at: 1, node: 'first', phase: 'started' }],
  trace_next_cursor: 1,
  trace_has_more: true,
};
it('loads evidence only on demand, keeps pending visible and appends trace without re-executing', async () => {
  mocks.evidence.mockResolvedValueOnce({ success: true, data: page }).mockResolvedValueOnce({
    success: true,
    data: {
      ...page,
      trace: [{ sequence: 2, created_at: 2, node: 'second', phase: 'completed' }],
      trace_next_cursor: 2,
      trace_has_more: false,
    },
  });
  render(<HostedTaskEvidencePanel taskId='task-a' />);
  expect(mocks.evidence).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'agent.hosted.evidence.show' }));
  await screen.findByText('agent.hosted.evidence.pending');
  expect(screen.getByText('agent.hosted.evidence.usage.pending')).toBeTruthy();
  expect(screen.getByText(/fixed-v1/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'agent.hosted.evidence.more' }));
  await screen.findByText(/second/);
  expect(screen.getByText(/first/)).toBeTruthy();
  expect(mocks.evidence.mock.calls.map((args) => args[0])).toEqual([
    { taskId: 'task-a', cursor: 0 },
    { taskId: 'task-a', cursor: 1 },
  ]);
});
it('does not display foreign evidence and allows explicit refresh after failure', async () => {
  mocks.evidence.mockResolvedValueOnce({ success: true, data: { ...page, task_id: 'foreign' } }).mockResolvedValueOnce({ success: true, data: page });
  render(<HostedTaskEvidencePanel taskId='task-a' />);
  fireEvent.click(screen.getByRole('button', { name: 'agent.hosted.evidence.show' }));
  await screen.findByText('agent.hosted.evidence.failed');
  expect(screen.queryByText(/fixed-v1/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'agent.external.refresh' }));
  await waitFor(() => expect(screen.queryByText('agent.hosted.evidence.failed')).toBeNull());
  expect(screen.getByText(/fixed-v1/)).toBeTruthy();
});
