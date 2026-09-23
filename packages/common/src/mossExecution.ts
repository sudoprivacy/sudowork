export interface IMossExecutionCapabilities {
  isLocalAllowed: boolean;
  isRemoteAllowed: boolean;
  defaultTarget: "local" | "remote";
}

export interface TMossLocalRuntimeStatus {
  userId: string;
  organizationId: string;
  status:
    | "ready"
    | "policy_denied"
    | "credential_pending"
    | "provider_unavailable"
    | "models_unavailable";
  protocol?: "openai-completions" | "openai-responses" | "anthropic-messages";
}

export interface TMossLocalRuntime {
  execution: IMossExecutionCapabilities;
  localRuntime: TMossLocalRuntimeStatus;
  sudorouter_key?: string;
  model_service_url?: string;
  models: string[];
  scode_auto_model?: string;
}

/** Read the persisted execution location, independently of the homepage selection. */
export function resolveConversationExecutionTarget(conversation: {
  type?: string;
  extra?: { executionTarget?: unknown; backend?: unknown };
}): "local" | "remote" {
  if (
    conversation.extra?.executionTarget === "local" ||
    conversation.extra?.executionTarget === "remote"
  )
    return conversation.extra.executionTarget;
  return conversation.type === "remote-agent" ||
    conversation.extra?.backend === "remote-agent"
    ? "remote"
    : "local";
}

export interface IMossConversationExecution {
  executionTarget?: "local" | "remote";
  mossAccountScope?: string;
  mossResources?: Array<{
    id: string;
    kind: "agents" | "skills";
    digest: string;
    path: string;
  }>;
}
