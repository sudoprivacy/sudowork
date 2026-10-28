export interface IMossSessionAgentContext {
  ownerId: string;
  ownerName: string;
  agentName: string;
  displayName: string;
}

interface IMossSessionContextInput {
  userId?: string;
  source?: string | null;
  assistantName?: string | null;
  assistant_name?: string;
  clientMetadata?: Record<string, unknown>;
}

/** Project server-owned Agent presentation after the caller checks Session access. */
export function getMossSessionAgentContext(
  session: IMossSessionContextInput,
): IMossSessionAgentContext | null {
  const metadata = session.clientMetadata;
  const actorId = metadata?.agent_manager_actor_id;
  const reference = session.assistantName ?? session.assistant_name;
  const isOwnMossSession =
    reference?.startsWith("moss-agent:operator:") && actorId === session.userId;
  if (
    !session.userId ||
    typeof actorId !== "string" ||
    !actorId ||
    (session.source !== "agent-manager" && !isOwnMossSession)
  )
    return null;

  const agentName = metadata?.agent_manager_agent_name;
  const displayName = metadata?.agent_manager_display_name;
  const ownerName = metadata?.agent_manager_owner_name;
  if (
    typeof agentName !== "string" ||
    !agentName.trim() ||
    typeof displayName !== "string" ||
    !displayName.trim() ||
    typeof ownerName !== "string" ||
    !ownerName.trim()
  )
    return null;
  return { ownerId: session.userId, ownerName, agentName, displayName };
}
