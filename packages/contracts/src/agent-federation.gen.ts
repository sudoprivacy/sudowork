// Derived from Moss 56bba4747bbce69af1bda6e55ab9c6c31efd94bd:contracts/agent-federation/v1alpha1/contract.ts. DO NOT EDIT.
/** Moss-owned federation boundary. Experimental; ADR-003/004 remain Proposed. */
export const AGENT_FEDERATION_API = 'agent-federation.sudo.dev/v1alpha1' as const
export const STANDARD_HTTP_PROTOCOLS = ['openai-chat-completions/v1', 'mcp/2025-06-18', 'a2a/0.3.0'] as const
export type StandardHttpProtocol = typeof STANDARD_HTTP_PROTOCOLS[number]
export interface ProtocolUsage { source: 'provider_reported'; input_tokens: number; output_tokens: number }

export const AGENT_HTTP_API = 'agent-http.sudo.dev/v1alpha1' as const

export interface ProviderCapabilities {
  supports_streaming: boolean
  supports_cancel: boolean
  supports_resume: boolean
  supports_idempotency: boolean
  supports_tool_events: boolean
  supports_trace_export: boolean
  supports_version_pin: boolean
  supports_human_approval: boolean
}

/** A source declaration, never executable code, credentials or an endpoint policy. */
export interface CustomAgentManifest {
  api_version: typeof AGENT_FEDERATION_API
  kind: 'CustomAgentManifest'
  provider_kind: 'custom_http'
  external_agent_id: string
  name: string
  description?: string
  source_revision: string
  execution_mode: 'external_hosted'
  protocol: typeof AGENT_HTTP_API | 'agent-http.sudo.dev/v1alpha2' | StandardHttpProtocol
  /** Required only for standard HTTP profiles; metadata digest is not runtime attestation. */
  target?: string
  discovery_digest?: string
  conversation_mode?: 'single_turn'
  /** Required for durable HTTP; legacy profiles cannot assert an execution revision. */
  execution_revision?: string
  input_profile: 'query_only_v1'
  output_profile: 'text_v1'
  capabilities: ProviderCapabilities
}

/** Created by authenticated ingress; provider identifiers never populate these fields. */
export interface TaskCorrelation {
  task_id: string
  attempt_id: string
  session_id: string
}

export interface ExternalRunBinding extends TaskCorrelation {
  api_version: typeof AGENT_FEDERATION_API
  kind: 'ExternalRunBinding'
  binding_id: string
  provider_kind: 'dify' | 'custom_http'
  /** Claimed provider identity; missing evidence on legacy rows is not verification. */
  external_agent_id: string
  source_identity_evidence?: 'unverified'
  source_digest: string
  provider_run_id?: string
  provider_response_id?: string
  provider_protocol?: StandardHttpProtocol
  trace_id?: string
  usage?: ProtocolUsage
  provider_session_id?: string
  adapter_version: string
  observability: 'partial'
  replay: 'unsupported'
  resume: 'unsupported' | 'query_only'
  version_evidence: 'source_snapshot_only' | 'provider_revision_fenced'
  execution_revision?: string
  started_at: string
  completed_at?: string
}

export interface ProviderObservation extends TaskCorrelation {
  api_version: typeof AGENT_FEDERATION_API
  kind: 'ProviderObservation'
  sequence: number
  provider_kind: 'dify' | 'custom_http'
  adapter_version: string
  type: 'output_snapshot' | 'result'
  text: string
  status: 'running' | 'succeeded' | 'failed'
  provider_refs: { run_id?: string; session_id?: string; message_id?: string; provider_task_id?: string; provider_workflow_run_id?: string }
  observed_at: string
}

export interface InvokeHttpAgent {
  api_version: typeof AGENT_HTTP_API
  kind: 'InvokeAgent'
  invocation_id: string
  external_agent_id: string
  query: string
  provider_session_id: string | null
  end_user: string
}

export interface HttpAgentResult {
  api_version: typeof AGENT_HTTP_API
  kind: 'AgentResult'
  invocation_id: string
  provider_run_id: string
  provider_session_id?: string
  status: 'succeeded' | 'failed'
  output: { text: string }
}

/** Product publication identity; this registry record is not a Nexus certificate or ReBAC grant. */
export interface AgentExecutionSnapshot {
  provider_kind?: 'dify' | 'custom_http'
  endpoint: string
  app_id: string
  workspace_id: string
  source_digest: string
  sourceManifest?: CustomAgentManifest
  parametersDigest: string | null
  decoder: 'text' | 'reply_actions_v1'
  definitionProfileVersion?: number
}
export interface AgentRegistryEvidence {
  authority: 'nexus_registry'
  principal: { trust_domain: string; agent_name: string }
  registration_digest: string
  signing_key_id: string
  evidence: 'signed_registration_only'
}
export interface AgentVersionManifest {
  api_version: typeof AGENT_FEDERATION_API
  kind: 'AgentVersionManifest'
  principal: { trust_domain: string; agent_name: string }
  version: string
  spec_digest: string
  snapshot: AgentExecutionSnapshot
  registry?: AgentRegistryEvidence
  created_by: string
  created_at: number
}
export interface AgentChannel {
  name: 'stable' | 'canary'
  version: string
  revision: number
  updated_at: number
  enabled: boolean
}
export interface AgentVersionDecision {
  id: string
  decision: 'approved' | 'withdrawn' | 'revoked'
  actor_id: string
  note: string
  expires_at: number
  created_at: number
}
export interface AgentVersionsPage {
  api_version: typeof AGENT_FEDERATION_API
  kind: 'AgentVersionsPage'
  principal: { trust_domain: string; agent_name: string }
  items: (AgentVersionManifest & { decisions: AgentVersionDecision[] })[]
  channels: AgentChannel[]
  next_cursor: string | null
}

/** Authorized user projection; never includes endpoint, prompts, credentials or reviewer notes. */
export interface AgentReleaseOptions {
  api_version: typeof AGENT_FEDERATION_API
  kind: 'AgentReleaseOptions'
  catalog_id: string
  principal: AgentVersionManifest['principal']
  items: {
    version: string
    source_digest: string
    spec_digest: string
    execution_revision?: string
    approval_expires_at: number
    registry?: AgentRegistryEvidence
  }[]
  channels: AgentChannel[]
  next_cursor: string | null
}
