// Derived from Moss 9f6456de38de159821fdbac415d6ea51a7a60768:contracts/task/v1alpha1/contract.ts. DO NOT EDIT.
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
    agent: { principal: AgentPrincipalRef; version: string; source_digest: string; version_evidence: 'source_snapshot_only' | 'provider_revision_fenced'; release_digest?: string; execution_revision?: string; resolved_from_channel?: string; channel_revision?: number; source_identity_evidence?: 'unverified'; claimed_app_id?: string; claimed_workspace_id?: string }
    binding_id: string
    configuration_revision: number
    provider_kind: 'dify' | 'custom_http'
  }
)
export interface TaskRecord {
  api_version: typeof TASK_API
  kind: 'TaskRecord'
  spec: TaskSpec
  resolution: TaskExecutionResolution
}
