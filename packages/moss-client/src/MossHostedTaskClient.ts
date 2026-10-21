import { z } from 'zod';
import { TASK_API, type HostedAgent, type HostedEventsPage, type HostedSession, type HostedTask, type SubmitTask } from '@sudowork/contracts/task';
import type { MossAgentFetch } from './MossAgentClient.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const assetId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,149}$/);
const stamp = z.number().int().nonnegative();
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const taskSchema = z.object({
  api_version: z.literal(TASK_API), kind: z.literal('HostedTask'), id, session_id: id, catalog_id: id, asset_id: assetId,
  attempt_id: id.nullable(), status: z.enum(['accepted', 'dispatching', 'running', 'succeeded', 'failed', 'rejected', 'unknown', 'cancelled']),
  query: z.string().max(8000), answer: z.string().max(128000), error_code: z.string().nullable(),
  created_at: stamp, updated_at: stamp, deadline_at: stamp, session_sequence: stamp.positive(), sequence: stamp.positive(),
  cleanup: z.enum(['not_started', 'pending', 'confirmed', 'unknown']), cancel_requested_at: stamp.nullable(),
}).strict().superRefine((task, ctx) => {
  if ((task.status === 'rejected' ? task.attempt_id !== null : task.attempt_id === null)
    || (task.status === 'succeeded' && (task.cleanup !== 'confirmed' || task.cancel_requested_at !== null))
    || (task.status === 'cancelled' && (task.cancel_requested_at === null || !['not_started', 'confirmed'].includes(task.cleanup))))
    ctx.addIssue({ code: 'custom', message: 'Invalid terminal evidence' });
});
const agentSchema = z.object({
  api_version: z.literal(TASK_API), kind: z.literal('HostedAgent'), id, name: z.string().max(1000), description: z.string().max(16000).nullable(),
  execution_mode: z.literal('internal_hosted'), asset_id: assetId, version: z.string().min(1).max(128), spec_digest: digest,
  source_platform: z.string().max(128), data_scope: z.literal('synthetic'), conversation_mode: z.literal('independent_turns'),
}).strict();
const sessionSchema = z.object({ id, agent_id: id, title: z.string(), updated_at: stamp, status: z.string(), closed: z.boolean() }).strict();
const pageSchema = z.object({
  api_version: z.literal(TASK_API), kind: z.literal('HostedEventsPage'), task: taskSchema.optional(), snapshot_sequence: stamp.optional(),
  events: z.array(z.object({ api_version: z.literal(TASK_API), kind: z.literal('HostedTaskEvent'), task_id: id, sequence: stamp.positive(), created_at: stamp,
    type: z.enum(['status', 'trace']), task: taskSchema, trace: z.object({ node: z.string(), phase: z.enum(['started', 'completed']), origin: z.literal('worker_reported') }).strict().optional(),
  }).strict()).max(1000), next_cursor: stamp, has_more: z.boolean(),
}).strict();

export interface HostedTaskInput {
  agent_id: string;
  requested_version?: string;
  session_id?: string;
  query: string;
  idempotency_key: string;
}
const inputSchema = z.object({ agent_id: id, requested_version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/).optional(), session_id: id.optional(),
  query: z.string().trim().min(1).max(8000), idempotency_key: z.string().regex(/^[\w-]{8,128}$/),
}).strict();
export const isHostedTaskFinished = (task: HostedTask) => ['succeeded', 'failed', 'rejected', 'unknown', 'cancelled'].includes(task.status);

/** Apply contiguous immutable projections, never jumping over events using a newer snapshot. */
export function applyHostedEventsPage(current: HostedTask, cursor: number, input: HostedEventsPage): HostedTask {
  const page = pageSchema.parse(input);
  let sequence = cursor;
  let result = current;
  for (const event of page.events) {
    if (event.task_id !== current.id || event.sequence !== sequence + 1 || event.sequence !== event.task.sequence
      || event.created_at !== event.task.updated_at || (event.type === 'trace') !== Boolean(event.trace)
      || event.task.id !== current.id || event.task.session_id !== current.session_id || event.task.catalog_id !== current.catalog_id
      || event.task.attempt_id !== current.attempt_id || event.task.query !== current.query || event.task.asset_id !== current.asset_id) throw new Error('HOSTED_EVENT_MISMATCH');
    sequence = event.sequence;
    if (event.task.sequence >= result.sequence) result = event.task;
  }
  if (page.task) {
    if (page.snapshot_sequence !== page.task.sequence || page.task.id !== current.id || page.task.session_id !== current.session_id
      || page.task.catalog_id !== current.catalog_id || page.task.attempt_id !== current.attempt_id || page.task.asset_id !== current.asset_id
      || page.task.query !== current.query || page.task.sequence < sequence) throw new Error('HOSTED_SNAPSHOT_MISMATCH');
    if (!page.events.length && !page.has_more && page.next_cursor === page.snapshot_sequence && page.task.sequence >= current.sequence && page.next_cursor >= cursor) return page.task;
    // A snapshot accompanying events cannot skip unread events.
    if (page.task.sequence === sequence && page.task.sequence >= result.sequence) result = page.task;
  } else if (page.snapshot_sequence !== undefined) throw new Error('HOSTED_SNAPSHOT_MISMATCH');
  if (page.next_cursor !== sequence || (page.has_more && !page.events.length)) throw new Error('HOSTED_EVENT_GAP');
  return result;
}

export interface MossHostedTaskPort {
  agents(): Promise<HostedAgent[]>;
  sessions(): Promise<HostedSession[]>;
  history(sessionId: string): Promise<HostedTask[]>;
  create(input: HostedTaskInput): Promise<HostedTask>;
  events(taskId: string, cursor: number): Promise<HostedEventsPage>;
  cancel(taskId: string): Promise<HostedTask>;
  reconcile(taskId: string): Promise<HostedTask>;
  close(taskId: string, note: string): Promise<HostedTask>;
}
export function createMossHostedTaskPort(fetchTask: MossAgentFetch): MossHostedTaskPort {
  async function read<T>(schema: z.ZodType<T>, path: string, body?: unknown): Promise<T> {
    const value = await fetchTask({ path, method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body }) });
    return z.object({ success: z.literal(true), data: schema }).parse(value).data as T;
  }
  async function taskAction(taskId: string, action: string, body: unknown) {
    const task = await read(taskSchema, `/api/v1/tasks/${id.parse(taskId)}/${action}`, body);
    if (task.id !== taskId) throw new Error('HOSTED_TASK_IDENTITY_MISMATCH');
    return task;
  }
  return {
    async agents() {
      const agents: HostedAgent[] = [], seen = new Set<string>();
      let after = '';
      for (let count = 0; count < 200; count++) {
        const page = await read(z.object({ items: z.array(agentSchema), next_cursor: z.string().nullable() }).strict(), `/api/v1/hosted-agents${after ? `?after=${encodeURIComponent(after)}` : ''}`);
        for (const agent of page.items) { if (seen.has(agent.id)) throw new Error('HOSTED_DIRECTORY_DUPLICATE'); seen.add(agent.id); agents.push(agent); }
        if (!page.next_cursor) return agents;
        if (page.next_cursor === after) throw new Error('HOSTED_DIRECTORY_CURSOR');
        after = page.next_cursor;
      }
      throw new Error('HOSTED_DIRECTORY_LIMIT');
    },
    sessions: () => read(z.array(sessionSchema), '/api/v1/hosted-sessions'),
    async history(sessionId) {
      const tasks = await read(z.array(taskSchema), `/api/v1/hosted-sessions/${id.parse(sessionId)}/tasks`);
      if (tasks.some(task => task.session_id !== sessionId) || new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error('HOSTED_TASK_IDENTITY_MISMATCH');
      return tasks.sort((a, b) => a.session_sequence - b.session_sequence);
    },
    async create(value) {
      const input = inputSchema.parse(value);
      const submission: SubmitTask = { api_version: TASK_API, kind: 'SubmitTask',
        agent: { catalog_id: input.agent_id, ...(input.requested_version ? { requested_version: input.requested_version } : {}) },
        ...(input.session_id ? { session_id: input.session_id } : {}), request_source: 'interactive',
        input: { instruction: input.query, resource_refs: [] }, workspace_refs: [], requested_mode: 'auto',
        data_classification: 'synthetic', required_capabilities: ['idempotency', 'version_pin'], constraints: { idempotency_key: input.idempotency_key, max_attempts: 1 },
      };
      const task = await read(taskSchema, '/api/v1/tasks', submission);
      if (task.catalog_id !== input.agent_id || task.query !== input.query || (input.session_id && task.session_id !== input.session_id)) throw new Error('HOSTED_TASK_IDENTITY_MISMATCH');
      return task;
    },
    async events(taskId, cursor) {
      const page = await read(pageSchema, `/api/v1/tasks/${id.parse(taskId)}/events?cursor=${stamp.parse(cursor)}`);
      if (page.events.some(event => event.task_id !== taskId || event.task.id !== taskId) || (page.task && page.task.id !== taskId)) throw new Error('HOSTED_TASK_IDENTITY_MISMATCH');
      return page;
    },
    cancel: taskId => taskAction(taskId, 'cancel', {}),
    reconcile: taskId => taskAction(taskId, 'reconcile', {}),
    close: (taskId, note) => taskAction(taskId, 'close', { note: z.string().trim().min(1).max(2000).parse(note) }),
  };
}
