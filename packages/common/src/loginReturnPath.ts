/** Parse the bounded, credential-free Agent workbench return route. */
export function parseAgentWorkspacePath(value: unknown): { sessionId: string; orgId?: string } | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  const match = /^\/conversation\/([A-Za-z0-9-]{1,128})(?:\?org_id=([A-Za-z0-9-]{1,128}))?$/.exec(value);
  if (!match) return null;
  return { sessionId: match[1]!, ...(match[2] ? { orgId: match[2] } : {}) };
}

/** Preserve an Agent workbench deep link across login without accepting external redirects. */
export function loginReturnPath(state: unknown): string {
  if (state && typeof state === 'object' && 'returnTo' in state && typeof state.returnTo === 'string' && parseAgentWorkspacePath(state.returnTo)) {
    return state.returnTo;
  }
  return '/guid';
}
