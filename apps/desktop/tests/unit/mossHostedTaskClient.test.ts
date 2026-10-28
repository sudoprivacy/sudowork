import { describe, expect, it, vi } from 'vitest';
import { TASK_API, type HostedTask, type HostedEventsPage } from '@sudowork/contracts/task';
import { applyHostedEventsPage, createMossHostedTaskPort } from '@sudowork/moss-client/hosted-tasks';
const task: HostedTask = {
  api_version: TASK_API,
  kind: 'HostedTask',
  id: 't1',
  session_id: 's1',
  catalog_id: 'c1',
  asset_id: 'asset:org@example.test',
  attempt_id: 'attempt1',
  status: 'running',
  query: '6 * 7',
  answer: '',
  error_code: null,
  created_at: 1,
  updated_at: 2,
  deadline_at: 10000,
  session_sequence: 1,
  sequence: 2,
  cleanup: 'pending',
  cancel_requested_at: null,
};
const snapshot = (value: HostedTask): HostedEventsPage => ({ api_version: TASK_API, kind: 'HostedEventsPage', task: value, snapshot_sequence: value.sequence, events: [], next_cursor: value.sequence, has_more: false });
describe('hosted task consumer boundary', () => {
  it('preserves the pinned formal request after ambiguous failure without automatic retries', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue({ success: true, data: task });
    const port = createMossHostedTaskPort(transport),
      input = { agent_id: 'c1', requested_version: 'v1', query: '6 * 7', idempotency_key: 'key-123456' };
    await expect(port.create(input)).rejects.toThrow('connection lost');
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(port.create(input)).resolves.toEqual(task);
    expect(transport.mock.calls[0][0]).toEqual(transport.mock.calls[1][0]);
    expect(transport.mock.calls[0][0].body).toMatchObject({ kind: 'SubmitTask', agent: { catalog_id: 'c1', requested_version: 'v1' }, data_classification: 'synthetic', constraints: { idempotency_key: input.idempotency_key, max_attempts: 1 } });
  });
  it('rejects external responses, crossed identities and unsupported query fields', async () => {
    const transport = vi.fn().mockResolvedValue({ success: true, data: { ...task, kind: 'ExternalTask' } });
    const port = createMossHostedTaskPort(transport),
      input = { agent_id: 'c1', query: task.query, idempotency_key: 'key-123456' };
    await expect(port.create(input)).rejects.toThrow();
    transport.mockResolvedValue({ success: true, data: { ...task, catalog_id: 'foreign' } });
    await expect(port.create(input)).rejects.toThrow('HOSTED_TASK_IDENTITY_MISMATCH');
    await expect(port.create({ ...input, resource_refs: ['secret'] } as never)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('requires terminal cleanup evidence but preserves unknown partial output', () => {
    expect(() => applyHostedEventsPage(task, 0, snapshot({ ...task, status: 'succeeded' }))).toThrow();
    expect(() => applyHostedEventsPage(task, 0, snapshot({ ...task, status: 'cancelled', cleanup: 'confirmed' }))).toThrow();
    expect(applyHostedEventsPage(task, 0, snapshot({ ...task, status: 'unknown', answer: 'partial' })).answer).toBe('partial');
  });
  it('accepts exact bootstrap snapshots and contiguous events, rejects stale data, gaps and foreign identity', () => {
    const done = { ...task, status: 'succeeded' as const, cleanup: 'confirmed' as const, sequence: 5, answer: '42' };
    expect(applyHostedEventsPage(task, 0, snapshot(done))).toEqual(done);
    expect(() => applyHostedEventsPage(done, 5, snapshot(task))).toThrow();
    expect(() => applyHostedEventsPage(task, 0, snapshot({ ...done, attempt_id: 'foreign' }))).toThrow('HOSTED_SNAPSHOT_MISMATCH');
    const event = { api_version: TASK_API, kind: 'HostedTaskEvent' as const, task_id: task.id, sequence: 3, created_at: 2, type: 'status' as const, task: { ...task, sequence: 3 } };
    const page: HostedEventsPage = { api_version: TASK_API, kind: 'HostedEventsPage', events: [event], next_cursor: 3, has_more: false };
    expect(applyHostedEventsPage(task, 2, page).sequence).toBe(3);
    expect(() => applyHostedEventsPage(task, 1, page)).toThrow();
    expect(() => applyHostedEventsPage(task, 2, { ...page, events: [{ ...event, task: { ...event.task, session_id: 'foreign' } }] })).toThrow();
  });
  it('continues filtered directory pages and rejects stuck cursors', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({ success: true, data: { items: [], next_cursor: 'next' } })
      .mockResolvedValue({ success: true, data: { items: [], next_cursor: null } });
    expect(await createMossHostedTaskPort(transport).agents()).toEqual([]);
    expect(transport.mock.calls[1][0].path).toBe('/api/v1/hosted-agents?after=next');
    transport.mockResolvedValue({ success: true, data: { items: [], next_cursor: 'next' } });
    await expect(createMossHostedTaskPort(transport).agents()).rejects.toThrow('HOSTED_DIRECTORY_CURSOR');
  });
  it('rejects arbitrary cleanup paths and another task response', async () => {
    const transport = vi.fn().mockResolvedValue({ success: true, data: task }),
      port = createMossHostedTaskPort(transport);
    await expect(port.cancel('../admin')).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    await expect(port.close('t2', 'confirmed cleanup')).rejects.toThrow('HOSTED_TASK_IDENTITY_MISMATCH');
    expect(transport.mock.calls[0][0]).toEqual({ method: 'POST', path: '/api/v1/tasks/t2/close', body: { note: 'confirmed cleanup' } });
  });
});

const evidence = {
  api_version: TASK_API,
  kind: 'HostedTaskEvidence',
  task_id: 't1',
  task_sequence: 5,
  captured_at: 10,
  cleanup: 'confirmed',
  release: null,
  usage: { authority: 'sudorouter', unit: 'router_quota', status: 'pending', verified_quota: 0, verified_prompt_tokens: 0, verified_completion_tokens: 0, pending_calls: 1, calls: [] },
  trace: [{ sequence: 4, created_at: 4, node: 'answer', phase: 'completed', origin: 'worker_reported' }],
  trace_next_cursor: 5,
  trace_has_more: false,
};
it('accepts scoped read-only evidence and rejects currency substitution, crossed tasks, trace gaps and private fields', async () => {
  const transport = vi.fn().mockResolvedValue({ success: true, data: evidence }),
    port = createMossHostedTaskPort(transport);
  await expect(port.evidence('t1')).resolves.toEqual(evidence);
  expect(transport.mock.calls[0][0]).toEqual({ method: 'GET', path: '/api/v1/tasks/t1/evidence?cursor=0' });
  for (const invalid of [
    { ...evidence, task_id: 't2' },
    { ...evidence, usage: { ...evidence.usage, unit: 'USD' } },
    { ...evidence, usage: { ...evidence.usage, status: 'verified' } },
    { ...evidence, routerToken: 'private' },
    { ...evidence, trace_next_cursor: 3 },
    { ...evidence, trace: [], trace_has_more: true },
  ]) {
    transport.mockResolvedValue({ success: true, data: invalid });
    await expect(port.evidence('t1')).rejects.toThrow();
  }
  transport.mockClear();
  await expect(port.evidence('../admin')).rejects.toThrow();
  await expect(port.evidence('t1', -1)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});

it('retains native verification and rejects contradictory success without losing unknown evidence', async () => {
  const native_verification = { kind: 'NativeOutputVerification' as const, policy: 'native-text-completion-v1' as const, profile_digest: `sha256:${'a'.repeat(64)}`, output_digest: `sha256:${'b'.repeat(64)}`, verdict: 'passed' as const, failures: [] };
  const done = { ...task, status: 'succeeded' as const, cleanup: 'confirmed' as const, sequence: 5, answer: '42', native_verification };
  expect(applyHostedEventsPage(task, 0, snapshot(done)).native_verification).toEqual(native_verification);
  const rejected = { ...native_verification, verdict: 'rejected' as const, failures: ['execution_cleanup' as const] };
  expect(() => applyHostedEventsPage(task, 0, snapshot({ ...done, native_verification: rejected }))).toThrow();
  expect(() => applyHostedEventsPage(task, 0, snapshot({ ...done, native_verification: { ...native_verification, failures: rejected.failures } }))).toThrow();
  expect(applyHostedEventsPage(task, 0, snapshot({ ...done, status: 'unknown', cleanup: 'unknown', native_verification: rejected })).native_verification).toEqual(rejected);
  const transport = vi.fn().mockResolvedValue({ success: true, data: { ...evidence, native_verification } });
  expect((await createMossHostedTaskPort(transport).evidence('t1')).native_verification).toEqual(native_verification);
});
