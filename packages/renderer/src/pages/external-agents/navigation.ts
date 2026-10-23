import type { ExternalSession } from '@sudowork/contracts/external-provider';

export const EXTERNAL_CONVERSATION_PREFIX = 'external:';
export const externalConversationId = (sessionId: string) => `${EXTERNAL_CONVERSATION_PREFIX}${sessionId}`;
export const externalConversationPath = (sessionId: string) => `/conversation/${encodeURIComponent(externalConversationId(sessionId))}`;
export const newExternalConversationPath = (agentId: string) => `${externalConversationPath('new')}?agent=${encodeURIComponent(agentId)}`;
export const isExternalConversationId = (id: string | undefined) => Boolean(id?.startsWith(EXTERNAL_CONVERSATION_PREFIX));

/** A read-only UI projection, never persisted as a native runtime conversation. */
export type ExternalConversationView = ({ type: 'external-provider' } | { type: 'hosted-artifact' }) & {
  id: string;
  sessionId: string;
  name: string;
  createTime: number;
  modifyTime: number;
  isRunning: boolean;
};

export function externalSessionView(session: ExternalSession): ExternalConversationView {
  return { type: 'external-provider', id: externalConversationId(session.id), sessionId: session.id, name: session.title, createTime: session.created_at, modifyTime: session.updated_at, isRunning: Boolean(session.active_task_id) };
}
