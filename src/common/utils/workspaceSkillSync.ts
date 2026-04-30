import type { TChatConversation } from '@/common/storage';

/**
 * Workspace skill linking is supported when the conversation has a workspace and
 * either:
 * 1. it's an OpenClaw conversation, or
 * 2. the preset assistant explicitly declares enabled skills, or
 * 3. the current message requests ad-hoc skills.
 */
export function shouldSyncWorkspaceSkills(conversation?: TChatConversation, requestedSkillNames?: string[]): boolean {
  if (!conversation?.extra?.workspace) {
    return false;
  }

  if (conversation.type === 'openclaw-gateway') {
    return true;
  }

  if (conversation.type === 'acp' && conversation.extra?.backend === 'claude') {
    return true;
  }

  if (conversation.type === 'acp' && conversation.extra?.backend === 'scode') {
    return true;
  }

  if (Array.isArray(conversation.extra?.enabledSkills)) {
    return true;
  }

  if (typeof conversation.extra?.presetAssistantId === 'string' && conversation.extra.presetAssistantId.trim()) {
    return true;
  }

  return Array.isArray(requestedSkillNames) && requestedSkillNames.some((skill) => typeof skill === 'string' && skill.trim().length > 0);
}
