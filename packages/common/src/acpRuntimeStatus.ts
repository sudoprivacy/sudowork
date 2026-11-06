/** A read of the selected engine on one owned ACP connection. */
export interface IAcpRuntimeStatus {
  foreground: { state: 'idle' | 'running'; waiting_for?: never } | { state: 'awaiting_input'; waiting_for: 'permission' | 'question' };
  background: {
    terminals: number;
    agents: number;
    execution_unconfirmed: number;
    tool_operations: number;
  };
}

/** Instance IDs identify transport incarnations, not durable Agents or SIDs. */
export interface IAcpRuntimeObservation {
  scope: 'owned-acp-connection';
  instanceId?: string;
  sessionId?: string;
  observedAt: number;
  expiresAt: number;
  availability: 'available' | 'unsupported' | 'unreachable' | 'unattached' | 'changed' | 'invalid';
  snapshot?: IAcpRuntimeStatus;
}
