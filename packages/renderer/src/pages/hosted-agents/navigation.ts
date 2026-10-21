import type { HostedSession } from '@sudowork/contracts/task';
import type { ExternalConversationView } from '../external-agents/navigation';

export const HOSTED_CONVERSATION_PREFIX = 'hosted:';
export const hostedConversationPath = (sessionId: string) => `/conversation/${encodeURIComponent(`${HOSTED_CONVERSATION_PREFIX}${sessionId}`)}`;
export const newHostedConversationPath = (agentId: string) => `${hostedConversationPath('new')}?agent=${encodeURIComponent(agentId)}`;
export const isHostedConversationId = (id?: string) => Boolean(id?.startsWith(HOSTED_CONVERSATION_PREFIX));
export function hostedSessionView(session: HostedSession): ExternalConversationView {
  return { type: 'hosted-artifact', id: `${HOSTED_CONVERSATION_PREFIX}${session.id}`, sessionId: session.id, name: session.title, createTime: session.updated_at, modifyTime: session.updated_at, isRunning: ['accepted', 'dispatching', 'running'].includes(session.status) };
}
