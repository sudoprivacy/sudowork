// Derived from Moss d1affcde8a127b7b1a54107d57281864a3f92060:contracts/task/v1alpha1/contract.ts. DO NOT EDIT.
import type { ResourceRef } from '@sudo/contracts/common/v1/resource-ref'

/** Product Task ingress implementation; ADR-003/004 remain Proposed. */
export const TASK_API = 'task.sudo.dev/v1alpha1' as const
export interface AgentPrincipalRef { trust_domain: string; agent_name: string }
export interface SubmitTask {
  api_version: typeof TASK_API
  kind: 'SubmitTask'
  agent: { catalog_id: string; requested_version?: string; requested_channel?: string }
  session_id?: string
  request_source: 'interactive' | 'api'
  input: { instruction: string; parameters?: Record<string, unknown>; resource_refs: ResourceRef[] }
  workspace_refs: ResourceRef[]
  requested_mode: 'auto' | 'local' | 'cloud' | 'private'
  data_classification: string
  required_capabilities: string[]
  constraints: { idempotency_key: string; timeout_ms?: number; deadline?: string; max_cost_units?: number; max_attempts?: number }
  output_contract?: { schema_ref?: ResourceRef; artifact_types?: string[]; rubric_ref?: ResourceRef }
  parent_task_id?: string
  supersedes_task_id?: string
}
export interface TaskSpec extends Omit<SubmitTask, 'kind' | 'agent' | 'session_id'> {
  kind: 'TaskSpec'
  task_id: string
  session_id: string
  created_at: string
  requested_by: { subject_type: 'user'; subject_id: string }
  agent: { principal: AgentPrincipalRef; requested_version?: string; requested_channel?: string }
}
interface ResolutionBase {
  api_version: typeof TASK_API
  kind: 'TaskExecutionResolution'
  resolution_id: string
  task_id: string
  reason_code: string
  reason: string
  policy_version: string
  policy_snapshot_digest: string
  decided_at: string
}
export type TaskExecutionResolution = ResolutionBase & (
  | { status: 'rejected' }
  | {
    status: 'accepted'
    attempt_id: string
    execution_mode: 'external_hosted'
    resolved_runtime: 'external_provider'
    resolution_mode: 'default'
    governance_org_id: string
    agent: { principal: AgentPrincipalRef; version: string; source_digest: string; version_evidence: 'source_snapshot_only' | 'provider_revision_fenced'; registry?: { authority: 'nexus_registry'; principal: AgentPrincipalRef; registration_digest: string; signing_key_id: string; evidence: 'signed_registration_only' }; release_digest?: string; execution_revision?: string; resolved_from_channel?: string; channel_revision?: number; source_identity_evidence?: 'unverified'; claimed_app_id?: string; claimed_workspace_id?: string }
    binding_id: string
    configuration_revision: number
    provider_kind: 'dify' | 'custom_http'
  }
  | {
    status: 'accepted'
    attempt_id: string
    execution_mode: 'internal_hosted'
    resolved_runtime: 'hosted_artifact'
    runtime_authority_id: string
    resolution_mode: 'default'
    governance_org_id: string
    catalog_id: string
    asset_id: string
    artifact_id: string
    metadata_digest: string
    agent: { principal: AgentPrincipalRef; version: string; source_digest: string; version_evidence: 'immutable_hosted_artifact'; registry: { authority: 'nexus_registry'; principal: AgentPrincipalRef; registration_digest: string; signing_key_id: string; evidence: 'signed_registration_only' }; release_digest: string; resolved_from_channel?: string; channel_revision?: number }
    artifact: { spec_digest: string; image_id: string; dependency_lock_digest: string; profile: 'dify-0.6.0-linear-text-v1' | 'langgraph-stdio-v1' }
    limits: { timeout_ms: number; max_model_calls: number }
  }
)
export interface TaskRecord {
  api_version: typeof TASK_API
  kind: 'TaskRecord'
  spec: TaskSpec
  resolution: TaskExecutionResolution
}

/** Text-only internal hosted task projection, separate from ExternalTask. */
export interface HostedTask {
  api_version: typeof TASK_API
  kind: 'HostedTask'
  id: string
  session_id: string
  catalog_id: string
  asset_id: string
  attempt_id: string | null
  status: 'accepted' | 'dispatching' | 'running' | 'succeeded' | 'failed' | 'rejected' | 'unknown' | 'cancelled'
  query: string
  answer: string
  error_code: string | null
  created_at: number
  updated_at: number
  deadline_at: number
  session_sequence: number
  sequence: number
  cleanup: 'not_started' | 'pending' | 'confirmed' | 'unknown'
  cancel_requested_at: number | null
}
export interface HostedTaskEvent {
  api_version: typeof TASK_API
  kind: 'HostedTaskEvent'
  task_id: string
  sequence: number
  created_at: number
  type: 'status' | 'trace'
  task: HostedTask
  trace?: { node: string; phase: 'started' | 'completed'; origin: 'worker_reported' }
}

export interface HostedAgent {
  api_version: typeof TASK_API
  kind: 'HostedAgent'
  id: string
  name: string
  description: string | null
  execution_mode: 'internal_hosted'
  asset_id: string
  version: string
  spec_digest: string
  source_platform: string
  data_scope: 'synthetic'
  conversation_mode: 'independent_turns'
}
export interface HostedSession {
  id: string
  agent_id: string
  title: string
  updated_at: number
  status: string
  closed: boolean
}
export interface HostedEventsPage {
  api_version: typeof TASK_API
  kind: 'HostedEventsPage'
  task?: HostedTask
  snapshot_sequence?: number
  events: HostedTaskEvent[]
  next_cursor: number
  has_more: boolean
}

/** Read-only evidence projection. Usage is Router quota, never an invented currency. */
export interface HostedTaskEvidence {
  api_version: typeof TASK_API
  kind: 'HostedTaskEvidence'
  task_id: string
  task_sequence: number
  captured_at: number
  cleanup: HostedTask['cleanup']
  release: { version: string; artifact_id: string; spec_digest: string; image_id: string; registration_digest: string } | null
  usage: {
    authority: 'sudorouter'
    unit: 'router_quota'
    status: 'pending' | 'verified' | 'not_invoked'
    verified_quota: number
    verified_prompt_tokens: number
    verified_completion_tokens: number
    pending_calls: number
    calls: { id: string; model: string; status: 'preparing' | 'dispatching' | 'completed' | 'rejected' | 'unknown'; ledger_status: 'pending' | 'router_verified'; token_cleanup: 'pending' | 'confirmed'; ledger_entries: number }[]
  }
  trace: { sequence: number; created_at: number; node: string; phase: 'started' | 'completed'; origin: 'worker_reported' }[]
  trace_next_cursor: number
  trace_has_more: boolean
}
