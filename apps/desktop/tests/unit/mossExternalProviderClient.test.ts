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

it('maps explicit version selection into TaskSpec and rejects ambiguous selectors before sending', async () => {
  const request = vi.fn().mockResolvedValue({ success: true, data: task });
  const port = createMossExternalProviderPort(request);
  await port.create({ agent_id: 'agent-1', query: 'synthetic', idempotency_key: 'request-123', requested_version: '1.2.0' });
  expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.objectContaining({ agent: { catalog_id: 'agent-1', requested_version: '1.2.0' } }) }));
  expect(() => port.create({ agent_id: 'agent-1', query: 'synthetic', idempotency_key: 'request-456', requested_version: '1.2.0', requested_channel: 'stable' })).toThrow();
  expect(request).toHaveBeenCalledTimes(1);
});

it('checks release identity, page bounds and execution evidence correlation', async () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const options = {
    api_version: 'agent-federation.sudo.dev/v1alpha1',
    kind: 'AgentReleaseOptions',
    catalog_id: 'agent-1',
    principal: { trust_domain: 'moss.local', agent_name: 'external-agent-1' },
    items: [{ version: '1.0.0', source_digest: digest, spec_digest: digest, approval_expires_at: 9000 }],
    channels: [],
    next_cursor: null,
  };
  const request = vi.fn().mockResolvedValue({ success: true, data: options });
  const port = createMossExternalProviderPort(request);
  expect((await port.versions('agent-1', '1.0.0')).items).toHaveLength(1);
  expect(request).toHaveBeenLastCalledWith({ method: 'GET', path: '/api/v1/external-agents/agent-1/versions?after=1.0.0' });
  request.mockResolvedValue({ success: true, data: { ...options, catalog_id: 'foreign' } });
  await expect(port.versions('agent-1')).rejects.toThrow('IDENTITY_MISMATCH');
  request.mockResolvedValue({ success: true, data: { ...options, endpoint: 'private-admin-config' } });
  await expect(port.versions('agent-1')).rejects.toThrow();
  const evidence = {
    api_version: EXTERNAL_PROVIDER_API,
    kind: 'ExternalTaskEvidence',
    task_id: 'task-1',
    session_id: 'session-1',
    attempt_id: 'attempt-1',
    status: 'succeeded',
    selection: { version: '1.0.0', source_digest: digest, execution_revision: digest, version_evidence: 'provider_revision_fenced' },
    execution: { provider_run_id: 'run-1', execution_revision: digest, version_evidence: 'provider_revision_fenced', resume: 'query_only' },
  };
  request.mockResolvedValue({ success: true, data: evidence });
  expect((await port.evidence('task-1')).execution?.execution_revision).toBe(digest);
  request.mockResolvedValue({ success: true, data: { ...evidence, execution: { ...evidence.execution, execution_revision: `sha256:${'b'.repeat(64)}` } } });
  await expect(port.evidence('task-1')).rejects.toThrow();
});

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

const usageAgent = {
  id: 'usage-agent',
  name: 'Usage',
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
const usage = {
  data_scope: 'synthetic_only',
  input: 'text_query_only',
  attachments: 'unsupported',
  resource_refs: 'unsupported',
  tools: 'unsupported',
  content_classification: 'caller_declared_only',
  capability_basis: 'adapter_contract',
  evaluated_at: 100,
  reviewed_at: null,
  review_state: 'current',
};
it('retains optional usage from new servers and accepts old servers without fabricating it', async () => {
  const request = vi.fn().mockResolvedValue({ success: true, data: [usageAgent] });
  const port = createMossExternalProviderPort(request);
  expect((await port.agents())[0].usage).toBeUndefined();
  request.mockResolvedValue({ success: true, data: [{ ...usageAgent, usage }] });
  expect((await port.agents())[0].usage).toEqual(usage);
});
it.each([{ data_scope: 'internal' }, { attachments: 'supported' }, { tools: 'supported' }, { content_classification: 'verified' }, { capability_basis: 'remote_attestation' }, { evaluated_at: -1 }, { reviewed_at: 'yesterday' }])('rejects unsupported or malformed usage claims: %j', async (patch) => {
  const request = vi.fn().mockResolvedValue({ success: true, data: [{ ...usageAgent, usage: { ...usage, ...patch } }] });
  await expect(createMossExternalProviderPort(request).agents()).rejects.toThrow();
});

it('keeps Registry provenance distinct from execution evidence and rejects mismatched identities', async () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const principal = { trust_domain: 'agents.example', agent_name: 'external-agent-1' };
  const registry = { authority: 'nexus_registry', principal, registration_digest: digest, signing_key_id: digest, evidence: 'signed_registration_only' };
  const options = { api_version: 'agent-federation.sudo.dev/v1alpha1', kind: 'AgentReleaseOptions', catalog_id: 'agent-1', principal, items: [{ version: 'v1', source_digest: digest, spec_digest: digest, registry, approval_expires_at: 9000 }], channels: [], next_cursor: null };
  const request = vi.fn().mockResolvedValue({ success: true, data: options });
  const port = createMossExternalProviderPort(request);
  expect((await port.versions('agent-1')).items[0].registry).toEqual(registry);
  request.mockResolvedValue({ success: true, data: { ...options, principal: { ...principal, trust_domain: 'another.example' } } });
  await expect(port.versions('agent-1')).rejects.toThrow();
  const evidence = {
    api_version: EXTERNAL_PROVIDER_API,
    kind: 'ExternalTaskEvidence',
    task_id: 'task-1',
    session_id: 'session-1',
    attempt_id: 'attempt-1',
    status: 'succeeded',
    selection: { version: 'v1', source_digest: digest, release_digest: digest, registry, version_evidence: 'source_snapshot_only' },
  };
  request.mockResolvedValue({ success: true, data: evidence });
  expect((await port.evidence('task-1')).selection?.registry).toEqual(registry);
  request.mockResolvedValue({ success: true, data: { ...evidence, selection: { ...evidence.selection, release_digest: undefined } } });
  await expect(port.evidence('task-1')).rejects.toThrow();
  request.mockResolvedValue({ success: true, data: { ...evidence, selection: { ...evidence.selection, registry: { ...registry, evidence: 'verified_execution' } } } });
  await expect(port.evidence('task-1')).rejects.toThrow();
});
