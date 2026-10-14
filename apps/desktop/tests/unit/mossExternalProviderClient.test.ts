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

it('preserves unverified source evidence and refuses unsupported verified claims', async () => {
  const agent = {
    id: 'agent-1',
    name: 'Declared app',
    provider: 'dify',
    execution_mode: 'external_hosted',
    profile: 'synthetic_pilot',
    source_identity_evidence: 'unverified',
    source_digest: 'digest',
    decoder: 'text',
    approved: true,
    review_expires_at: 1000,
    capabilities: { streaming: 'supported', cancel: 'unsupported', resume: 'unsupported', version_pin: 'unsupported' },
  };
  const request = vi.fn().mockResolvedValue({ success: true, data: [agent] });
  const port = createMossExternalProviderPort(request);
  expect((await port.agents())[0].source_identity_evidence).toBe('unverified');
  request.mockResolvedValue({ success: true, data: [{ ...agent, source_identity_evidence: 'verified' }] });
  await expect(port.agents()).rejects.toThrow();
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

it('retains server creation sequence and source evidence in history', async () => {
  const value = { ...task, session_sequence: 2, source_identity_evidence: 'unverified' };
  const port = createMossExternalProviderPort(vi.fn().mockResolvedValue({ success: true, data: [value] }));
  expect((await port.history('session-1'))[0]).toMatchObject({ session_sequence: 2, source_identity_evidence: 'unverified' });
});
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

it('submits a typed TaskSpec request once and retains rejection decisions in history', async () => {
  const decision = { status: 'rejected' as const, reason_code: 'DATA_DOMAIN_FORBIDDEN', reason: 'Synthetic data only', policy_version: 'policy-1' };
  const rejected = { ...task, status: 'rejected', attempt_id: null, task_contract_version: 'task.sudo.dev/v1alpha1', policy_decision: decision, provider: 'custom_http', provider_refs: { run_id: 'remote-run' } };
  const request = vi.fn().mockResolvedValue({ success: true, data: rejected });
  const port = createMossExternalProviderPort(request);
  expect((await port.create({ agent_id: 'agent-1', session_id: 'session-1', query: '6 * 7', idempotency_key: 'request-1234' })).policy_decision).toEqual(decision);
  expect(request).toHaveBeenCalledExactlyOnceWith({
    method: 'POST',
    path: '/api/v1/tasks',
    body: {
      api_version: 'task.sudo.dev/v1alpha1',
      kind: 'SubmitTask',
      agent: { catalog_id: 'agent-1' },
      session_id: 'session-1',
      request_source: 'interactive',
      input: { instruction: '6 * 7', resource_refs: [] },
      workspace_refs: [],
      requested_mode: 'auto',
      data_classification: 'synthetic',
      required_capabilities: [],
      constraints: { idempotency_key: 'request-1234' },
    },
  });
  request.mockResolvedValue({ success: true, data: [rejected] });
  expect((await port.history('session-1'))[0].policy_decision).toEqual(decision);
  request.mockRejectedValue(new Error('connection lost'));
  await expect(port.create({ agent_id: 'agent-1', query: '6 * 7', idempotency_key: 'request-1234' })).rejects.toThrow('connection lost');
  expect(request).toHaveBeenCalledTimes(3);
});
