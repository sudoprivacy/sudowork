import type { TChatConversation } from '@sudowork/common/storage';
import { isPersonalAgentRef } from '@sudowork/common/personalAgents';
import { isOntologyConversation } from '@sudowork/common/conversationPurpose';
import { getActivityTime } from '@renderer/utils/timeline';
import type { IMyAgent } from '@sudowork/common/personalAgents';

/** Resolve identity before display names, including unambiguous legacy templates. */
export function getConversationAgentRef(conversation: TChatConversation, listedReferences: ReadonlySet<string>): string | undefined {
  const extra = conversation.extra;
  if (extra?.agentManagement) return `moss-managed:${extra.agentManagement.ownerId}:${extra.agentManagement.agentName}`;
  for (const reference of [extra?.mossAssistantRef, extra?.presetAssistantId]) {
    if (typeof reference === 'string' && (isPersonalAgentRef(reference) || listedReferences.has(reference))) return reference;
  }
  return typeof extra?.agentName === 'string' && extra.agentName ? extra.agentName : undefined;
}

/** Use one deterministic latest order in the sidebar, cards and session selector. */
export function compareConversationsByLatestActivity(a: TChatConversation, b: TChatConversation): number {
  return getActivityTime(b) - getActivityTime(a) || (b.createTime || 0) - (a.createTime || 0) || b.id.localeCompare(a.id);
}

/** Include pinned history while excluding background runs and temporary checks. */
export function getAgentConversations(conversations: TChatConversation[], reference: string): TChatConversation[] {
  const references = new Set([reference]);
  return conversations.filter((conversation) => !conversation.extra?.cronJobId && conversation.extra?.isHealthCheck !== true && !isOntologyConversation(conversation) && getConversationAgentRef(conversation, references) === reference).sort(compareConversationsByLatestActivity);
}

/** Open the most recently active session for the selected identity. */
export function getLatestAgentConversation(conversations: TChatConversation[], reference: string): TChatConversation | undefined {
  return getAgentConversations(conversations, reference)[0];
}

/** Prefer the current catalog name without presenting an internal personal reference. */
export function getConversationAgentName(conversation: TChatConversation, agents: IMyAgent[], fallback: string): string {
  if (conversation.extra?.agentManagement) return conversation.extra.agentManagement.displayName;
  const reference = getConversationAgentRef(conversation, new Set(agents.map((agent) => agent.ref)));
  const name = agents.find((agent) => agent.ref === reference)?.displayName;
  if (name) return name;
  const savedName = conversation.extra?.agentName;
  return typeof savedName === 'string' && savedName && !isPersonalAgentRef(savedName) ? savedName : fallback;
}

/** Only canonical personal identities or listed templates can start an Agent-scoped session. */
export function getSelectableConversationAgentRef(conversation: TChatConversation, agents: IMyAgent[]): string | undefined {
  const references = new Set(agents.map((agent) => agent.ref));
  const reference = getConversationAgentRef(conversation, references);
  return reference && (isPersonalAgentRef(reference) || references.has(reference)) ? reference : undefined;
}
