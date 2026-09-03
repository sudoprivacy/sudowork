import type { TChatConversation } from '@sudowork/common/storage';

/**
 * Check if a workspace path is a remote container path (Moss/Sudorouter).
 * Remote paths start with /app/ or contain /data/runtime/sessions/.
 * These paths exist only in the remote container, not on the local filesystem.
 */
export function isRemoteContainerPath(workspace?: string): boolean {
  if (!workspace) return false;
  // Moss container paths: /app/data/runtime/sessions/<id>/workspace
  return workspace.startsWith('/app/') || workspace.includes('/data/runtime/sessions/');
}

/**
 * Workspace skill linking is supported when the conversation has a workspace and
 * either:
 * 1. it's an OpenClaw conversation, or
 * 2. the preset assistant explicitly declares enabled skills, or
 * 3. the current message requests ad-hoc skills.
 *
 * NOTE: Remote-agent conversations are ALWAYS excluded because their workspace
 * exists in a remote container, not on the local filesystem. The remote container
 * workDir should be stored in extra.mossWorkDir, not extra.workspace.
 * Remote-agent workspace skills are managed by Moss Server, not locally.
 */
export function shouldSyncWorkspaceSkills(conversation?: TChatConversation, requestedSkillNames?: string[]): boolean {
  if (!conversation?.extra?.workspace) {
    return false;
  }

  // ALWAYS skip remote-agent conversations - their workspace is in a remote container
  // Remote-agent workspace skills are managed by Moss Server, not locally
  if (conversation.type === 'remote-agent') {
    return false;
  }

  // Defense-in-depth: also skip if workspace is a remote container path
  // This guards against accidental pollution of extra.workspace with remote paths
  if (isRemoteContainerPath(conversation.extra.workspace)) {
    return false;
  }

  // Also skip if mossWorkDir is present (indicates remote-agent conversation)
  const extra = conversation.extra as { mossWorkDir?: string };
  if (extra.mossWorkDir) {
    return false;
  }

  // NOTE: legacy 'openclaw-gateway' conversations are migrated to acp + scode
  // (see initStorage / CronService), and the type is no longer part of the
  // TChatConversation union — so a dead `=== 'openclaw-gateway'` branch was removed
  // here. Migrated conversations are covered by the acp + scode case below.

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
