// Derived from Moss c356ce319087e5926104bb3f8c0aba40d609420e:contracts/external-provider/v1/contract.ts. DO NOT EDIT.
/** Moss-owned external-provider pilot wire contract. ADR-003/004 remain Proposed. */
export const EXTERNAL_PROVIDER_API = 'external-provider.sudo.dev/v1alpha5' as const
export type Capability = 'supported' | 'unsupported' | 'unknown'
export interface ExternalCapabilities {
  streaming: Capability; cancel: Capability; resume: Capability; version_pin: Capability
  idempotency?: Capability; human_approval?: Capability; trace_export?: 'full' | 'partial' | 'none' | 'unknown'
}
/** Recorded at dispatch authorization, never reconstructed from current configuration. */
export interface ExternalTaskProvenance {
  recorded_at: number; stage: 'dispatch_authorized'; protocol: string; adapter_version: string
  source_revision: string | null; revision_basis: 'provider_declared' | 'content_digest'
  source_id: string | null; candidate_id: string | null; capabilities: ExternalCapabilities
  observability: 'partial'; source_digest: string
}
export type ExternalTaskStatus = 'accepted' | 'dispatching' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'rejected'
export type OutputDecoder = 'text' | 'reply_actions_v1'

/** Optional additive read metadata. Not admission, health, DLP or remote execution evidence. */
export interface ExternalAgentUsage {
  data_scope: 'synthetic_only'
  input: 'text_query_only'
  attachments: 'unsupported'
  resource_refs: 'unsupported'
  tools: 'unsupported'
  content_classification: 'caller_declared_only'
  capability_basis: 'adapter_contract'
  /** Projection time; no provider probe is performed by this read. */
  evaluated_at: number
  /** Successful explicit review of this configuration; null for unrecorded/invalidated reviews. */
  reviewed_at: number | null
  /** Only the review window; dispatch rechecks policy, grants, credentials and connection. */
  review_state: 'not_approved' | 'expired' | 'current'
}

export interface ExternalAgent {
  id: string
  name: string
  provider: string
  execution_mode: 'external_hosted'
  profile: 'synthetic_pilot'
  protocol?: string
  conversation_mode?: 'single_turn'
  /** App/workspace and reviewed source are not bound to the API key by this adapter. */
  source_identity_evidence: 'unverified'
  source_digest: string
  decoder: OutputDecoder
  approved: boolean
  review_expires_at: number
  capabilities: ExternalCapabilities
  usage?: ExternalAgentUsage
}

/** Client command mapped to SubmitTask by the transport. Never accepted directly by HTTP ingress. */
export interface CreateExternalTask {
  agent_id: string
  requested_version?: string
  requested_channel?: 'stable' | 'canary'
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

/** Read projection of the immutable Task Resolution and the independently observed remote run. */
export interface ExternalTaskEvidence {
  api_version: typeof EXTERNAL_PROVIDER_API
  kind: 'ExternalTaskEvidence'
  task_id: string
  session_id: string
  attempt_id: string | null
  status: ExternalTaskStatus
  provenance?: ExternalTaskProvenance
  selection?: {
    version: string
    source_digest: string
    release_digest?: string
    resolved_from_channel?: string
    channel_revision?: number
    execution_revision?: string
    version_evidence: 'source_snapshot_only' | 'provider_revision_fenced'
    /** Registration provenance, separate from remote execution guarantees. */
    registry?: {
      authority: 'nexus_registry'
      principal: { trust_domain: string; agent_name: string }
      registration_digest: string
      signing_key_id: string
      evidence: 'signed_registration_only'
    }
  }
  execution?: {
    adapter_version?: string
    observability?: 'partial'
    provider_run_id?: string
    provider_response_id?: string
    protocol?: string
    trace_id?: string
    usage?: { source: 'provider_reported'; input_tokens: number; output_tokens: number }
    execution_revision?: string
    version_evidence: 'source_snapshot_only' | 'provider_revision_fenced'
    resume: 'unsupported' | 'query_only'
  }
}

export interface ExternalTask {
  /** Missing on historical tasks; never implies verified identity. */
  source_identity_evidence?: 'unverified'
  /** Monotonic creation order within this session; missing on legacy records. */
  session_sequence?: number
  task_contract_version?: string
  policy_decision?: { status: 'accepted' | 'rejected'; reason_code: string; reason: string; policy_version: string }
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
  provider_refs: { run_id?: string; conversation_id?: string; message_id?: string; task_id?: string; workflow_run_id?: string }
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
  provider_kind?: 'dify' | 'custom_http'
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
  definition_evidence: 'validated_dsl' | 'validated_manifest' | 'digest_only'
}
export interface InspectExternalConnection { endpoint: string; api_key: string; provider_kind?: 'dify' | 'custom_http'; source_definition?: string }
export interface ExternalConnectionInspection { name: string; parameters_digest: string; checked_at: number; source_identity_evidence: 'unverified' }
export interface OnboardExternalAgent extends InspectExternalConnection {
  catalog_governance?: boolean
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

/** Optional paged directory reads: ?paged=1&after=<last scanned binding id>.
 * A page can be empty after authorization/archive filtering and still have a cursor.
 * Cursors only select within the authenticated organization; they grant no access.
 */
export interface ExternalAgentPage { items: ExternalAgent[]; next_cursor: string | null }
export interface ExternalAgentAdminPage { items: ExternalAgentAdmin[]; next_cursor: string | null }
/** GET /external-agents/admin/members-page?q=<name or email>&after=<member id>, 50 items/page. */
export interface ExternalProviderMemberPage { items: ExternalProviderMember[]; next_cursor: string | null }
