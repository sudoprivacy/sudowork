/** Resolve a stable identity first; accept an old display name only when unambiguous. */
export function resolveAssistantReference<T extends IAssistantReference>(assistants: T[], reference: string): T | undefined {
  const exact = assistants.find((assistant) => assistant.id === reference);
  if (exact) return exact;
  const matches = assistants.filter((assistant) => assistant.name === reference);
  return matches.length === 1 ? matches[0] : undefined;
}

interface IAssistantReference {
  id: string;
  name: string;
}
