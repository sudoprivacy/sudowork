import type { TChatConversation } from '@/common/storage';

/**
 * Workspace skill linking is temporarily supported only for Sudoclaw/OpenClaw conversations.
 */
export function shouldSyncWorkspaceSkills(conversation?: TChatConversation): boolean {
  return conversation?.type === 'openclaw-gateway' && Boolean(conversation.extra?.workspace);
}
