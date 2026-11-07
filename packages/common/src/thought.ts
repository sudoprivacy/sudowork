import type { IResponseMessage } from './chatTypes.js';

/** Agent-authored reasoning. Wire deltas are explicit; stored messages are snapshots. */
export interface ThoughtContent {
  subject: string;
  description: string;
  descriptionMode?: 'delta' | 'snapshot';
}

/** Preserve engine-provided reasoning identically in live streams and restored history. */
export function thinkingBlockToResponse(block: { thinking?: string; text?: string }, messageId: string, blockIndex: number, conversationId: string): IResponseMessage | undefined {
  const description = (typeof block.thinking === 'string' && block.thinking) || (typeof block.text === 'string' && block.text) || '';
  if (!description) return undefined;
  return {
    type: 'thought',
    msg_id: `${messageId}-thought${blockIndex ? `-${blockIndex}` : ''}`,
    conversation_id: conversationId,
    data: { subject: 'Thinking', description },
  };
}

/** Shared by persistence, live rendering and the throttled activity preview. */
export function mergeThoughtContent(previous: ThoughtContent | undefined, incoming: ThoughtContent): ThoughtContent {
  return {
    subject: incoming.subject,
    description: incoming.descriptionMode === 'delta' ? (previous?.description || '') + incoming.description : incoming.description,
  };
}
