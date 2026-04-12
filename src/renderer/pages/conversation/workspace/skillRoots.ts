/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

export type WorkspaceSkillSource = 'skills' | 'claude-skills';

export function resolveWorkspaceSkillRoot(workspace: string, eventPrefix: 'acp' | 'openclaw-gateway' = 'acp', backend?: string): { path: string; source: WorkspaceSkillSource } {
  const normalizedWorkspace = workspace.replace(/\/$/, '');
  if (eventPrefix === 'openclaw-gateway') {
    return {
      path: `${normalizedWorkspace}/skills`,
      source: 'skills',
    };
  }

  if (backend === 'claude') {
    return {
      path: `${normalizedWorkspace}/.claude/skills`,
      source: 'claude-skills',
    };
  }

  return {
    path: `${normalizedWorkspace}/skills`,
    source: 'skills',
  };
}
