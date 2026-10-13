// Derived from Moss 5034b39feaa770d72e7cdfc36362d149f76fd617:contracts/external-provider/v1/contract.ts. DO NOT EDIT.
/** Moss-owned external-provider pilot wire contract. ADR-003/004 remain Proposed. */
export const EXTERNAL_PROVIDER_API = 'external-provider.sudo.dev/v1alpha1' as const
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
  attempt_id: string | null
  status: ExternalTaskStatus
  query: string
  answer: string
  raw_answer: string
  output_status: 'pending' | 'valid' | 'invalid'
  error_code: string | null
  source_digest: string
  provider: string
  provider_refs: { conversation_id?: string; message_id?: string; task_id?: string; workflow_run_id?: string }
  cancellation: { status: 'none' | 'unsupported'; reason: string | null }
  created_at: number
  updated_at: number
  deadline_at: number
}

export interface ExternalTaskEvent {
  task_id: string
  sequence: number
  type: 'status' | 'answer' | 'provider_refs'
  status: ExternalTaskStatus
  answer?: string
  created_at: number
}

export interface ExternalEventsPage {
  events: ExternalTaskEvent[]
  next_cursor: number
  task: ExternalTask
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
  revision: number
  name: string
  decoder: OutputDecoder
  allowed_user_ids: string[]
  review_days: number
  review_note: string
}
export interface ExternalProviderMember { id: string; name: string }
