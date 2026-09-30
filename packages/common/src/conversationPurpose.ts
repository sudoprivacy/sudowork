export interface IConversationPurposeMetadata {
  purpose?: 'general' | 'ontology';
  ontologyId?: string;
}

/** Business ownership is independent of the ACP/remote runtime type. */
export function isOntologyConversation(conversation: { extra?: unknown } | null | undefined): boolean {
  const extra = conversation?.extra as IConversationPurposeMetadata | undefined;
  return extra?.purpose === 'ontology';
}

export function ontologyConversationPath(conversation: { id: string; extra?: unknown }): string | undefined {
  const extra = conversation.extra as IConversationPurposeMetadata | undefined;
  if (!isOntologyConversation(conversation) || !extra?.ontologyId) return undefined;
  return `/app/ontology/${encodeURIComponent(extra.ontologyId)}/model?sessionId=${encodeURIComponent(conversation.id)}`;
}
