export type AgentExecutionType = 'server' | 'local';

export const DEFAULT_AGENT_EXECUTION_TYPE: AgentExecutionType = 'server';

export interface IMyAgent {
  ref: string;
  displayName: string;
  /** Origin of this user's Agent; template denotes a user's instantiated Agent. */
  kind: 'default' | 'own' | 'template';
  /** Execution type for this Agent. Legacy Agents default to server execution. */
  executionType?: AgentExecutionType;
}

export interface IUserAgent {
  id: string;
  displayName: string;
  createdAt: number;
  executionType?: AgentExecutionType;
}

/** Desktop-only metadata; older local records have no default marker. */
export interface ILocalPersonalAgent extends IUserAgent {
  isDefault?: boolean;
}

/** Reserved personal identities must never be resolved as template names. */
export function isPersonalAgentRef(reference?: string): boolean {
  return isLocalPersonalAgentRef(reference) || Boolean(reference && /^moss-agent:(?:user|own):/.test(reference));
}

/** Local identities belong to this Sudowork installation and must never be sent to Moss. */
export function isLocalPersonalAgentRef(reference?: string): boolean {
  return Boolean(reference?.startsWith('sudowork-agent:local:'));
}

export function getAgentExecutionType(agent: Pick<IMyAgent, 'executionType'>): AgentExecutionType {
  return agent.executionType ?? DEFAULT_AGENT_EXECUTION_TYPE;
}
