import { TASK_API, type SubmitTask } from "@sudowork/contracts/task";
import {
  AGENT_FEDERATION_API,
  type AgentReleaseOptions,
} from "@sudowork/contracts/agent-federation";
import {
  type ExternalAgentAdmin,
  type ExternalPilotPolicy,
  type ExternalProviderAccess,
  type ExternalProviderMember,
  type InspectExternalConnection,
  type ExternalConnectionInspection,
  type OnboardExternalAgent,
  type UpdateExternalAgent,
  EXTERNAL_PROVIDER_API,
  type CreateExternalTask,
  type ExternalAgent,
  type ExternalEventsPage,
  type ExternalSession,
  type ExternalTask,
  type ExternalTaskEvidence,
} from "@sudowork/contracts/external-provider";
import { z } from "zod";
import type { MossAgentFetch } from "./MossAgentClient.js";

export const EXTERNAL_REQUEST_TIMEOUT_MS = 15_000;
/** One deadline covers token refresh, HTTP retries and response decoding. Never retries execution. */
export async function withExternalRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("EXTERNAL_TASK_TIMEOUT"));
    }, EXTERNAL_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([operation(controller.signal), expired]);
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("EXTERNAL_TASK_TIMEOUT", { cause: error });
    throw error;
  } finally {
    clearTimeout(timer!);
  }
}

const id = z.string().regex(/^[\w-]{1,100}$/);
const taskInput = z
  .object({
    agent_id: id,
    requested_version: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
      .optional(),
    requested_channel: z.enum(["stable", "canary"]).optional(),
    session_id: id.optional(),
    query: z.string().min(1).max(8000),
    idempotency_key: z.string().regex(/^[\w-]{8,128}$/),
  })
  .strict()
  .refine(
    (value) => !(value.requested_version && value.requested_channel),
    "Ambiguous version selector",
  );
const status = z.enum([
  "accepted",
  "dispatching",
  "running",
  "succeeded",
  "failed",
  "unknown",
  "rejected",
]);
const task = z.object({
  source_identity_evidence: z.literal("unverified").optional(),
  session_sequence: z.number().int().positive().optional(),
  api_version: z.literal(EXTERNAL_PROVIDER_API),
  id,
  session_id: id,
  agent_id: id,
  agent_name: z.string(),
  task_contract_version: z.literal(TASK_API).optional(),
  policy_decision: z
    .object({
      status: z.enum(["accepted", "rejected"]),
      reason_code: z.string(),
      reason: z.string(),
      policy_version: z.string(),
    })
    .optional(),
  configuration_revision: z.number().int().positive().optional(),
  dispatch_authorized_at: z.number().optional(),
  reconciliation: z
    .object({
      action: z.literal("closed"),
      note: z.string(),
      user_id: z.string(),
      created_at: z.number(),
    })
    .optional(),
  attempt_id: z.string().nullable(),
  status,
  query: z.string(),
  answer: z.string(),
  raw_answer: z.string(),
  raw_answer_freshness: z.enum(["current", "legacy_checkpoint"]).optional(),
  output_status: z.enum(["pending", "valid", "invalid"]),
  error_code: z.string().nullable(),
  source_digest: z.string(),
  provider: z.string(),
  provider_refs: z.object({
    conversation_id: z.string().optional(),
    message_id: z.string().optional(),
    task_id: z.string().optional(),
    workflow_run_id: z.string().optional(),
    run_id: z.string().optional(),
  }),
  cancellation: z.object({
    status: z.enum(["none", "unsupported"]),
    reason: z.string().nullable(),
  }),
  created_at: z.number(),
  updated_at: z.number(),
  deadline_at: z.number(),
});
const session = z.object({
  id,
  agent_id: id,
  agent_name: z.string(),
  title: z.string(),
  active_task_id: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});
const standardProtocol = z.enum([
  "openai-chat-completions/v1",
  "mcp/2025-06-18",
  "a2a/0.3.0",
]);
const capability = z.enum(["supported", "unsupported", "unknown"]);
const agentUsage = z.object({
  data_scope: z.literal("synthetic_only"),
  input: z.literal("text_query_only"),
  attachments: z.literal("unsupported"),
  resource_refs: z.literal("unsupported"),
  tools: z.literal("unsupported"),
  content_classification: z.literal("caller_declared_only"),
  capability_basis: z.literal("adapter_contract"),
  evaluated_at: z.number().int().nonnegative(),
  reviewed_at: z.number().int().nonnegative().nullable(),
  review_state: z.enum(["not_approved", "expired", "current"]),
});
const agent = z.object({
  id,
  name: z.string(),
  provider: z.string(),
  execution_mode: z.literal("external_hosted"),
  profile: z.literal("synthetic_pilot"),
  protocol: z.string().max(100).optional(),
  conversation_mode: z.literal("single_turn").optional(),
  source_identity_evidence: z.literal("unverified"),
  source_digest: z.string(),
  decoder: z.enum(["text", "reply_actions_v1"]),
  approved: z.boolean(),
  review_expires_at: z.number(),
  usage: agentUsage.optional(),
  capabilities: z.object({
    streaming: capability,
    cancel: capability,
    resume: capability,
    version_pin: capability,
  }),
});
const events = z.object({
  api_version: z.literal(EXTERNAL_PROVIDER_API),
  kind: z.literal("ExternalEventsPage"),
  task: task.optional(),
  snapshot_sequence: z.number().int().positive().optional(),
  has_more: z.boolean(),
  next_cursor: z.number().int().nonnegative(),
  events: z.array(
    z.object({
      api_version: z.literal(EXTERNAL_PROVIDER_API),
      kind: z.literal("ExternalTaskEvent"),
      task_id: id,
      sequence: z.number().int().positive(),
      type: z.enum(["status", "answer", "provider_refs"]),
      status,
      delta: z
        .object({
          offset: z.number().int().nonnegative(),
          text: z.string().max(128000),
        })
        .optional(),
      raw_delta: z
        .union([
          z.object({
            offset: z.number().int().nonnegative(),
            text: z.string().max(128000),
          }),
          z.object({ from_answer: z.literal(true) }),
        ])
        .optional(),
      state: task.pick({
        status: true,
        attempt_id: true,
        output_status: true,
        error_code: true,
        provider_refs: true,
        updated_at: true,
        dispatch_authorized_at: true,
        reconciliation: true,
      }),
      created_at: z.number(),
    }),
  ),
});

const releaseVersion = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const releaseDigest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const registryEvidence = z
  .object({
    authority: z.literal("nexus_registry"),
    principal: z
      .object({
        trust_domain: z.string().min(1).max(253),
        agent_name: z.string().min(1).max(128),
      })
      .strict(),
    registration_digest: releaseDigest,
    signing_key_id: releaseDigest,
    evidence: z.literal("signed_registration_only"),
  })
  .strict();
const releaseOptionsSchema = z
  .object({
    api_version: z.literal(AGENT_FEDERATION_API),
    kind: z.literal("AgentReleaseOptions"),
    catalog_id: id,
    principal: z
      .object({
        trust_domain: z.string().min(1).max(200),
        agent_name: z.string().min(1).max(200),
      })
      .strict(),
    items: z
      .array(
        z
          .object({
            version: releaseVersion,
            source_digest: releaseDigest,
            spec_digest: releaseDigest,
            execution_revision: releaseDigest.optional(),
            approval_expires_at: z.number().int().nonnegative(),
            registry: registryEvidence.optional(),
          })
          .strict(),
      )
      .max(50),
    channels: z
      .array(
        z
          .object({
            name: z.enum(["stable", "canary"]),
            version: releaseVersion,
            revision: z.number().int().positive(),
            updated_at: z.number().int().nonnegative(),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .max(2),
    next_cursor: releaseVersion.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.items.some(
        (item) =>
          item.registry &&
          (item.registry.principal.trust_domain !==
            value.principal.trust_domain ||
            item.registry.principal.agent_name !== value.principal.agent_name),
      )
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Registry principal mismatch",
      });
  });
const versionEvidence = z.enum([
  "source_snapshot_only",
  "provider_revision_fenced",
]);
const evidenceSchema = z
  .object({
    api_version: z.literal(EXTERNAL_PROVIDER_API),
    kind: z.literal("ExternalTaskEvidence"),
    task_id: id,
    session_id: id,
    attempt_id: id.nullable(),
    status,
    selection: z
      .object({
        version: releaseVersion,
        source_digest: releaseDigest,
        release_digest: releaseDigest.optional(),
        resolved_from_channel: z.string().optional(),
        channel_revision: z.number().int().positive().optional(),
        execution_revision: releaseDigest.optional(),
        version_evidence: versionEvidence,
        registry: registryEvidence.optional(),
      })
      .strict()
      .optional(),
    execution: z
      .object({
        provider_run_id: z.string().min(1).max(200).optional(),
        provider_response_id: z.string().min(1).max(200).optional(),
        protocol: standardProtocol.optional(),
        trace_id: z
          .string()
          .regex(/^[a-f0-9]{32}$/)
          .optional(),
        usage: z
          .object({
            source: z.literal("provider_reported"),
            input_tokens: z.number().int().nonnegative().safe(),
            output_tokens: z.number().int().nonnegative().safe(),
          })
          .strict()
          .optional(),
        execution_revision: releaseDigest.optional(),
        version_evidence: versionEvidence,
        resume: z.enum(["unsupported", "query_only"]),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const execution = value.execution;
    if (execution) {
      const isStandard = Boolean(execution.protocol);
      const hasRun = Boolean(execution.provider_run_id),
        hasResponse = Boolean(execution.provider_response_id);
      if (
        (!isStandard &&
          (!hasRun || execution.trace_id || hasResponse || execution.usage)) ||
        (isStandard &&
          (!execution.trace_id ||
            execution.version_evidence !== "source_snapshot_only" ||
            execution.resume !== "unsupported")) ||
        (execution.protocol === "mcp/2025-06-18" && (hasRun || hasResponse)) ||
        (execution.protocol === "openai-chat-completions/v1" &&
          (hasRun || !hasResponse)) ||
        (execution.protocol === "a2a/0.3.0" && hasRun === hasResponse) ||
        (execution.usage && execution.protocol !== "openai-chat-completions/v1")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Protocol execution evidence mismatch",
        });
      }
    }
    if (value.selection?.registry && !value.selection.release_digest)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Registry selection requires a release digest",
      });
    for (const item of [value.selection, value.execution]) {
      if (
        item &&
        (item.version_evidence === "provider_revision_fenced") !==
          Boolean(item.execution_revision)
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Execution revision evidence mismatch",
        });
    }
    if (
      value.execution?.execution_revision &&
      value.execution.execution_revision !== value.selection?.execution_revision
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Executed revision differs from resolution",
      });
  });

const policySchema = z.object({
  enabled: z.boolean(),
  endpoints: z.array(z.string()),
  revision: z.number().int(),
});
const accessSchema = z.object({
  can_manage: z.boolean(),
  can_manage_policy: z.boolean(),
  credential_storage_available: z.boolean(),
});
const inspectionSchema = z.object({
  source_identity_evidence: z.literal("unverified"),
  name: z.string(),
  parameters_digest: z.string(),
  checked_at: z.number(),
});
const adminAgentSchema = agent.extend({
  endpoint: z.string(),
  app_id: z.string(),
  workspace_id: z.string(),
  allowed_user_ids: z.array(z.string()),
  review_note: z.string(),
  revision: z.number().int(),
  archived: z.boolean(),
  credential_configured: z.boolean(),
  credential_state: z.enum(["ready", "updating", "rotation_required"]),
  registration_mode: z.enum(["onboarding", "reference_compat"]),
  definition_evidence: z.enum([
    "validated_dsl",
    "validated_manifest",
    "digest_only",
  ]),
});

export interface MossExternalProviderPort {
  access(): Promise<ExternalProviderAccess>;
  policy(): Promise<ExternalPilotPolicy>;
  savePolicy(input: ExternalPilotPolicy): Promise<ExternalPilotPolicy>;
  adminAgents(): Promise<ExternalAgentAdmin[]>;
  members(): Promise<ExternalProviderMember[]>;
  inspect(
    input: InspectExternalConnection,
  ): Promise<ExternalConnectionInspection>;
  onboard(input: OnboardExternalAgent): Promise<ExternalAgentAdmin>;
  update(
    agentId: string,
    input: UpdateExternalAgent,
  ): Promise<ExternalAgentAdmin>;
  rotate(
    agentId: string,
    input: { revision: number; api_key: string },
  ): Promise<ExternalAgentAdmin>;
  archive(agentId: string, revision: number): Promise<ExternalAgentAdmin>;
  testAgent(agentId: string): Promise<ExternalConnectionInspection>;
  review(
    agentId: string,
    input: { approved: boolean; revision: number; review_days?: number },
  ): Promise<ExternalAgentAdmin>;

  agents(): Promise<ExternalAgent[]>;
  versions(agentId: string, after?: string): Promise<AgentReleaseOptions>;
  evidence(taskId: string): Promise<ExternalTaskEvidence>;
  sessions(): Promise<ExternalSession[]>;
  history(sessionId: string): Promise<ExternalTask[]>;
  create(input: CreateExternalTask): Promise<ExternalTask>;
  events(taskId: string, cursor: number): Promise<ExternalEventsPage>;
}

/** Hosts provide per-account authenticated transport. Only explicit admin inspection/onboarding/rotation carries a provider key; user execution uses the Moss session. */
export function createMossExternalProviderPort(
  request: MossAgentFetch,
): MossExternalProviderPort {
  const read = async <T>(
    schema: z.ZodType<T>,
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const response = await request({
      method: body === undefined ? "GET" : "POST",
      path,
      ...(body === undefined ? {} : { body }),
    });
    return schema.parse(
      z.object({ success: z.literal(true), data: z.unknown() }).parse(response)
        .data,
    );
  };
  return {
    access: () => read(accessSchema, "/api/v1/external-agents/access"),
    policy: () => read(policySchema, "/api/v1/external-agents/admin/policy"),
    savePolicy: (input) =>
      read(policySchema, "/api/v1/external-agents/admin/policy", input),
    adminAgents: () =>
      read(z.array(adminAgentSchema), "/api/v1/external-agents/admin/agents"),
    members: () =>
      read(
        z.array(z.object({ id: z.string(), name: z.string() })),
        "/api/v1/external-agents/admin/members",
      ),
    inspect: (input) =>
      read(inspectionSchema, "/api/v1/external-agents/admin/inspect", input),
    onboard: (input) =>
      read(adminAgentSchema, "/api/v1/external-agents/admin/onboard", input),
    update: (agentId, input) =>
      read(
        adminAgentSchema,
        `/api/v1/external-agents/admin/${id.parse(agentId)}/update`,
        input,
      ),
    rotate: (agentId, input) =>
      read(
        adminAgentSchema,
        `/api/v1/external-agents/admin/${id.parse(agentId)}/rotate`,
        input,
      ),
    archive: (agentId, revision) =>
      read(
        adminAgentSchema,
        `/api/v1/external-agents/admin/${id.parse(agentId)}/archive`,
        { revision },
      ),
    testAgent: (agentId) =>
      read(
        inspectionSchema,
        `/api/v1/external-agents/admin/${id.parse(agentId)}/test`,
        {},
      ),
    review: (agentId, input) =>
      read(
        adminAgentSchema,
        `/api/v1/external-agents/${id.parse(agentId)}/review`,
        input,
      ),
    agents: () => read(z.array(agent), "/api/v1/external-agents"),
    versions: async (agentId, after = "") => {
      const data = await read(
        releaseOptionsSchema,
        `/api/v1/external-agents/${id.parse(agentId)}/versions${after ? `?after=${encodeURIComponent(releaseVersion.parse(after))}` : ""}`,
      );
      if (data.catalog_id !== agentId)
        throw new Error("EXTERNAL_RELEASE_IDENTITY_MISMATCH");
      return data;
    },
    evidence: async (taskId) => {
      const data = await read(
        evidenceSchema,
        `/api/v1/tasks/${id.parse(taskId)}/evidence`,
      );
      if (data.task_id !== taskId)
        throw new Error("EXTERNAL_TASK_IDENTITY_MISMATCH");
      return data;
    },
    sessions: () => read(z.array(session), "/api/v1/external-sessions"),
    history: (sessionId) =>
      read(
        z.array(task),
        `/api/v1/external-sessions/${id.parse(sessionId)}/tasks`,
      ),
    create: (input) => {
      const legacy = taskInput.parse(input);
      const submission: SubmitTask = {
        api_version: TASK_API,
        kind: "SubmitTask",
        agent: {
          catalog_id: legacy.agent_id,
          ...(legacy.requested_version
            ? { requested_version: legacy.requested_version }
            : {}),
          ...(legacy.requested_channel
            ? { requested_channel: legacy.requested_channel }
            : {}),
        },
        ...(legacy.session_id ? { session_id: legacy.session_id } : {}),
        request_source: "interactive",
        input: { instruction: legacy.query, resource_refs: [] },
        workspace_refs: [],
        requested_mode: "auto",
        data_classification: "synthetic",
        required_capabilities: [],
        constraints: { idempotency_key: legacy.idempotency_key },
      };
      // No fallback POST: an ambiguous response may already have created a task.
      return read(task, "/api/v1/tasks", submission);
    },
    events: (taskId, cursor) =>
      read(
        events,
        `/api/v1/tasks/${id.parse(taskId)}/events?cursor=${z.number().int().nonnegative().parse(cursor)}`,
      ),
  };
}

/** Apply only a contiguous stream or an explicit snapshot. The caller resyncs from
 * cursor 0 after a gap; accepted tasks are never resubmitted to repair a read. */
export function applyExternalEventsPage(
  current: ExternalTask,
  cursor: number,
  input: ExternalEventsPage,
): ExternalTask {
  const page = events.parse(input);
  if (page.next_cursor < cursor && !page.task)
    throw new Error("EXTERNAL_EVENT_CURSOR_REGRESSED");
  if (page.task) {
    if (
      page.task.id !== current.id ||
      page.task.session_id !== current.session_id ||
      page.task.agent_id !== current.agent_id ||
      page.snapshot_sequence !== page.next_cursor
    )
      throw new Error("EXTERNAL_SNAPSHOT_MISMATCH");
    return page.task;
  }
  const next = { ...current };
  let sequence = cursor;
  for (const event of page.events) {
    if (
      event.task_id !== current.id ||
      event.sequence !== sequence + 1 ||
      event.state.status !== event.status
    )
      throw new Error("EXTERNAL_EVENT_GAP");
    if (event.delta) {
      if (event.delta.offset > next.answer.length)
        throw new Error("EXTERNAL_DELTA_OFFSET");
      next.answer = next.answer.slice(0, event.delta.offset) + event.delta.text;
      if (next.answer.length > 128000) throw new Error("EXTERNAL_ANSWER_LIMIT");
    }
    if (event.raw_delta) {
      if ("from_answer" in event.raw_delta) next.raw_answer = next.answer;
      else {
        if (event.raw_delta.offset > next.raw_answer.length)
          throw new Error("EXTERNAL_RAW_DELTA_OFFSET");
        next.raw_answer =
          next.raw_answer.slice(0, event.raw_delta.offset) +
          event.raw_delta.text;
      }
      if (next.raw_answer.length > 128000)
        throw new Error("EXTERNAL_RAW_ANSWER_LIMIT");
    }
    Object.assign(next, event.state);
    sequence = event.sequence;
  }
  if (sequence !== page.next_cursor || (page.has_more && sequence === cursor))
    throw new Error("EXTERNAL_EVENT_CURSOR_MISMATCH");
  return next;
}
