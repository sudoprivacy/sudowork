export type WorkspaceSkillSource = 'skills' | 'claude-skills' | 'scode-skills';

export function resolveWorkspaceSkillRoot(workspace: string, backend?: string): { path: string; source: WorkspaceSkillSource } {
  const normalizedWorkspace = workspace.replace(/\/$/, '');

  if (backend === 'claude') {
    return {
      path: `${normalizedWorkspace}/.claude/skills`,
      source: 'claude-skills',
    };
  }

  if (backend === 'scode') {
    return {
      path: `${normalizedWorkspace}/.nexus/sudocode/skills`,
      source: 'scode-skills',
    };
  }

  return {
    path: `${normalizedWorkspace}/skills`,
    source: 'skills',
  };
}
