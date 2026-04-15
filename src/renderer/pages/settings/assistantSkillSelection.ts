import type { IInstalledSkillInfo } from '@/common/ipcBridge';

export function isAutoInjectedBuiltinSkill(skill: IInstalledSkillInfo): boolean {
  return skill.isAutoInjectedBuiltin === true;
}

export function getSelectableAssistantSkills(installedSkills: IInstalledSkillInfo[]): IInstalledSkillInfo[] {
  return installedSkills.filter((skill) => !isAutoInjectedBuiltinSkill(skill) && (skill.isBuiltin || skill.enabled !== false));
}

export function sanitizeAssistantEnabledSkills(enabledSkills: string[] | undefined, installedSkills: IInstalledSkillInfo[]): string[] {
  // Build a set of selectable skill IDs (using meta.id if available, fallback to name)
  const selectableIds = new Set(getSelectableAssistantSkills(installedSkills).map((skill) => skill.meta?.id || skill.name));
  return (enabledSkills || []).filter((skillId) => selectableIds.has(skillId));
}
