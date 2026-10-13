import { expect, it, vi } from 'vitest';
import { applyExternalEventsPage, createMossExternalProviderPort } from '@sudowork/moss-client/external-providers';
import { EXTERNAL_PROVIDER_API, type ExternalTask, type ExternalTaskEvent } from '@sudowork/contracts/external-provider';

it('rejects invalid task input and path injection before transport', async () => {
  const request = vi.fn(),
    port = createMossExternalProviderPort(request);
  expect(() => port.create({ agent_id: 'agent', query: 'test', idempotency_key: 'key' })).toThrow();
  expect(() => port.history('../secret')).toThrow();
  expect(() => port.events('task-1', -1)).toThrow();
  expect(request).not.toHaveBeenCalled();
});

it('cursor reads and history use the same generic task API', async () => {
  const request = vi.fn().mockResolvedValue({ success: true, data: [] }),
    port = createMossExternalProviderPort(request);
  expect(await port.history('session-1')).toEqual([]);
  expect(request).toHaveBeenLastCalledWith({ method: 'GET', path: '/api/v1/external-sessions/session-1/tasks' });
  await expect(port.events('task-1', 12)).rejects.toThrow();
  expect(request).toHaveBeenLastCalledWith({ method: 'GET', path: '/api/v1/tasks/task-1/events?cursor=12' });
});

it.each([null, { success: false }, { success: true, data: [{ id: 'fake' }] }])('rejects malformed agent responses: %j', async (response) => {
  await expect(createMossExternalProviderPort(vi.fn().mockResolvedValue(response)).agents()).rejects.toThrow();
});

const task: ExternalTask = {
  api_version: EXTERNAL_PROVIDER_API,
  id: 'task-1',
  session_id: 'session-1',
  agent_id: 'agent-1',
  agent_name: 'Agent',
  attempt_id: 'attempt-1',
  status: 'running',
  query: 'synthetic',
  answer: 'hel',
  raw_answer: '',
  output_status: 'pending',
  error_code: null,
  source_digest: 'digest',
  provider: 'dify',
  provider_refs: {},
  cancellation: { status: 'unsupported', reason: null },
  created_at: 1,
  updated_at: 2,
  deadline_at: 1000,
};
function event(sequence = 2): ExternalTaskEvent {
  return {
    api_version: EXTERNAL_PROVIDER_API,
    kind: 'ExternalTaskEvent',
    task_id: task.id,
    sequence,
    type: 'answer',
    status: 'running',
    delta: { offset: 3, text: 'lo' },
    state: { status: 'running', attempt_id: task.attempt_id, output_status: 'pending', error_code: null, provider_refs: {}, updated_at: 3 },
    created_at: 3,
  };
}
it('applies ordered deltas and replacements while preserving the request identity', () => {
  const next = applyExternalEventsPage(task, 1, { api_version: EXTERNAL_PROVIDER_API, kind: 'ExternalEventsPage', events: [event()], next_cursor: 2, has_more: false });
  expect(next.answer).toBe('hello');
  expect(next.query).toBe(task.query);
  expect(task.answer).toBe('hel');
  expect(applyExternalEventsPage(next, 2, { api_version: EXTERNAL_PROVIDER_API, kind: 'ExternalEventsPage', events: [{ ...event(3), delta: { offset: 0, text: 'replacement' } }], next_cursor: 3, has_more: false }).answer).toBe('replacement');
});
it('requires an explicit matching snapshot to recover gaps or a reset cursor', () => {
  expect(() => applyExternalEventsPage(task, 1, { api_version: EXTERNAL_PROVIDER_API, kind: 'ExternalEventsPage', events: [event(3)], next_cursor: 3, has_more: false })).toThrow('GAP');
  expect(() => applyExternalEventsPage(task, 1, { api_version: EXTERNAL_PROVIDER_API, kind: 'ExternalEventsPage', events: [{ ...event(), delta: { offset: 9, text: 'bad' } }], next_cursor: 2, has_more: false })).toThrow('OFFSET');
  expect(() => applyExternalEventsPage(task, 1, { api_version: EXTERNAL_PROVIDER_API, kind: 'ExternalEventsPage', events: [], next_cursor: 2, has_more: false })).toThrow('CURSOR');
  const snapshot = { api_version: EXTERNAL_PROVIDER_API, kind: 'ExternalEventsPage' as const, task: { ...task, answer: 'recovered' }, snapshot_sequence: 4, events: [], next_cursor: 4, has_more: false };
  expect(applyExternalEventsPage(task, 9, snapshot).answer).toBe('recovered');
  expect(() => applyExternalEventsPage(task, 1, { ...snapshot, task: { ...task, id: 'other-task' } })).toThrow('MISMATCH');
});

it('restores raw deltas and rejects unknown event or page versions before changing state', () => {
  const page = { api_version: EXTERNAL_PROVIDER_API, kind: 'ExternalEventsPage' as const, events: [{ ...event(), raw_delta: { offset: 0, text: '{"reply":"hello' } }], next_cursor: 2, has_more: false };
  const next = applyExternalEventsPage(task, 1, page);
  expect(next.raw_answer).toBe('{"reply":"hello');
  expect(applyExternalEventsPage(task, 1, { ...page, events: [{ ...event(), raw_delta: { from_answer: true } }] }).raw_answer).toBe('hello');
  expect(() => applyExternalEventsPage(task, 1, { ...page, api_version: 'external-provider.sudo.dev/v999' as typeof EXTERNAL_PROVIDER_API })).toThrow();
  expect(() => applyExternalEventsPage(task, 1, { ...page, events: [{ ...page.events[0], api_version: 'external-provider.sudo.dev/v999' as typeof EXTERNAL_PROVIDER_API }] })).toThrow();
  expect(() => applyExternalEventsPage(task, 1, { ...page, events: [{ ...event(), raw_delta: { offset: 20, text: 'invalid' } }] })).toThrow('OFFSET');
  expect(task.raw_answer).toBe('');
});
