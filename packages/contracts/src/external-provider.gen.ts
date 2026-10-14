// Derived from Moss a5b336c33e6e74025502f279581bf52f3e37d80c:contracts/external-provider/v1/contract.ts. DO NOT EDIT.
/** Moss-owned external-provider pilot wire contract. ADR-003/004 remain Proposed. */
export const EXTERNAL_PROVIDER_API = 'external-provider.sudo.dev/v1alpha4' as const
export type Capability = 'supported' | 'unsupported' | 'unknown'
export type ExternalTaskStatus = 'accepted' | 'dispatching' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'rejected'
export type OutputDecoder = 'text' | 'reply_actions_v1'

export interface ExternalAgent {
  id: string
  name: string
  provider: string
  execution_mode: 'external_hosted'
  profile: 'synthetic_pilot'
  source_digest: string
  decoder: OutputDecoder
  approved: boolean
  review_expires_at: number
  capabilities: { streaming: Capability; cancel: Capability; resume: Capability; version_pin: Capability }
}

export interface CreateExternalTask {
  agent_id: string
  session_id?: string
  query: string
  idempotency_key: string
}

export interface ExternalSession {
  id: string
  agent_id: string
  agent_name: string
  title: string
  active_task_id: string | null
  created_at: number
  updated_at: number
}

export interface ExternalTask {
  api_version: typeof EXTERNAL_PROVIDER_API
  id: string
  session_id: string
  agent_id: string
  agent_name: string
  configuration_revision?: number
  dispatch_authorized_at?: number
  attempt_id: string | null
  status: ExternalTaskStatus
  query: string
  answer: string
  raw_answer: string
  raw_answer_freshness?: 'current' | 'legacy_checkpoint'
  output_status: 'pending' | 'valid' | 'invalid'
  error_code: string | null
  source_digest: string
  provider: string
  provider_refs: { conversation_id?: string; message_id?: string; task_id?: string; workflow_run_id?: string }
  reconciliation?: { action: 'closed'; note: string; user_id: string; created_at: number }
  cancellation: { status: 'none' | 'unsupported'; reason: string | null }
  created_at: number
  updated_at: number
  deadline_at: number
}

export interface ExternalTaskEvent {
  api_version: typeof EXTERNAL_PROVIDER_API
  kind: 'ExternalTaskEvent'
  task_id: string
  sequence: number
  type: 'status' | 'answer' | 'provider_refs'
  status: ExternalTaskStatus
  delta?: { offset: number; text: string }
  raw_delta?: { offset: number; text: string } | { from_answer: true }
  state: Pick<ExternalTask, 'status' | 'attempt_id' | 'output_status' | 'error_code' | 'provider_refs' | 'updated_at' | 'dispatch_authorized_at' | 'reconciliation'>
  created_at: number
}

export interface ExternalEventsPage {
  api_version: typeof EXTERNAL_PROVIDER_API
  kind: 'ExternalEventsPage'
  events: ExternalTaskEvent[]
  next_cursor: number
  task?: ExternalTask
  snapshot_sequence?: number
  has_more: boolean
}

export interface RegisterExternalAgent {
  name: string
  endpoint: string
  app_id: string
  workspace_id: string
  credential_ref: string
  source_digest: string
  decoder: OutputDecoder
  allowed_user_ids: string[]
  review_expires_at: number
  review_note: string
}

export interface RegisterExternalAgentRequest extends RegisterExternalAgent {
  request_id: string
  source_definition: string
}

export interface ExternalPilotPolicy {
  enabled: boolean
  endpoints: string[]
  revision: number
}
export interface ExternalProviderAccess {
  can_manage: boolean
  can_manage_policy: boolean
  credential_storage_available: boolean
}
export interface ExternalAgentAdmin extends ExternalAgent {
  endpoint: string
  app_id: string
  workspace_id: string
  allowed_user_ids: string[]
  review_note: string
  revision: number
  archived: boolean
  credential_configured: boolean
  credential_state: 'ready' | 'updating' | 'rotation_required'
  registration_mode: 'onboarding' | 'reference_compat'
  definition_evidence: 'validated_dsl' | 'digest_only'
}
export interface InspectExternalConnection { endpoint: string; api_key: string }
export interface ExternalConnectionInspection { name: string; parameters_digest: string; checked_at: number }
export interface OnboardExternalAgent extends InspectExternalConnection {
  request_id: string
  name: string
  app_id: string
  workspace_id: string
  source_definition: string
  decoder: OutputDecoder
  allowed_user_ids: string[]
  review_days: number
  review_note: string
}
export interface UpdateExternalAgent {
  source_definition?: string
  revision: number
  name: string
  decoder: OutputDecoder
  allowed_user_ids: string[]
  review_days: number
  review_note: string
}
export interface ExternalProviderMember { id: string; name: string }
