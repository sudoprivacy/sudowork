import type { IResponseMessage } from '@/common/ipcBridge';

const ACP_FINISH_TIMEOUT_ACTIVITY_TYPES = new Set<IResponseMessage['type']>(['thought', 'start', 'content', 'acp_permission', 'acp_tool_call', 'plan']);

/**
 * Only real turn activity should cancel the pending finish cleanup.
 * Metadata updates such as token usage may arrive after finish and must not
 * keep the UI stuck in a running state.
 */
export function shouldCancelAcpFinishTimeout(messageType: IResponseMessage['type']): boolean {
  return ACP_FINISH_TIMEOUT_ACTIVITY_TYPES.has(messageType);
}
