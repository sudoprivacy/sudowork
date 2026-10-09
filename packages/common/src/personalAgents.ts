export interface IMyAgent {
  ref: string;
  displayName: string;
  kind: "default" | "own" | "template";
}

export interface IUserAgent {
  id: string;
  displayName: string;
  createdAt: number;
}

/** Reserved personal identities must never be resolved as template names. */
export function isPersonalAgentRef(reference?: string): boolean {
  return Boolean(reference && /^moss-agent:(?:user|own):/.test(reference));
}
