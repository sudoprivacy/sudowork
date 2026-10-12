/** Preserve an Agent workbench deep link across login without accepting external redirects. */
export function loginReturnPath(state: unknown): string {
  if (
    state &&
    typeof state === "object" &&
    "returnTo" in state &&
    typeof state.returnTo === "string" &&
    /^\/conversation\/[A-Za-z0-9-]+$/.test(state.returnTo)
  ) {
    return state.returnTo;
  }
  return "/guid";
}
