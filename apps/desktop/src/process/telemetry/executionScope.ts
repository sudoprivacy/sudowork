import { resolveConversationExecutionTarget } from '@sudowork/common/mossExecution';
import { getDatabase } from '../database';
import { ProcessChat } from '../initStorage';

function taskIds(context: Record<string, unknown>): string[] {
  return ['session_id', 'conversation_id', 'sessionId', 'conversationId'].flatMap((key) => (typeof context[key] === 'string' && context[key].trim() ? [context[key].trim()] : []));
}

/** Resolve the persisted task, never the currently selected homepage execution mode. */
export function isLocalQualityTask(taskId: string): boolean {
  try {
    const conversation = getDatabase().getConversation(taskId).data;
    if (conversation) return resolveConversationExecutionTarget(conversation) === 'local';
  } catch {
    // Older local tasks may still be waiting for lazy migration from file storage.
  }
  try {
    const conversation = ProcessChat.getSync('chat.history')?.find((item) => item.id === taskId);
    return !!conversation && resolveConversationExecutionTarget(conversation) === 'local';
  } catch {
    return false;
  }
}

/** Context without a task describes the local client itself (startup, install, process crash). */
export function isLocalQualityContext(context?: Record<string, unknown>): boolean {
  return !context || taskIds(context).every(isLocalQualityTask);
}

/** A capture-time snapshot keeps offline events scoped correctly after task deletion. */
export function isLocalQualityEvent(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const event = value as { type?: string; execution_target?: unknown; data?: Record<string, unknown>; context?: Record<string, unknown> };
  if (event.execution_target !== undefined) return event.execution_target === 'local';
  if (['conversation', 'turn', 'step'].includes(event.type ?? '') || (event.type === 'perf' && event.data?.metric === 'first_token')) {
    return !!event.data && taskIds(event.data).length > 0 && isLocalQualityContext(event.data);
  }
  if (event.type === 'install' || event.type === 'perf') return !!event.data && isLocalQualityContext(event.data);
  if (['native_crash', 'renderer_crash', 'js_exception'].includes(event.type ?? '')) return isLocalQualityContext(event.context);
  return false;
}
