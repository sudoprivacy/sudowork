import type { IInstalledSkillInfo } from '@/common/ipcBridge';

export function isAutoInjectedBuiltinSkill(skill: IInstalledSkillInfo): boolean {
  return skill.isAutoInjectedBuiltin === true;
}

export function getSelectableAssistantSkills(installedSkills: IInstalledSkillInfo[]): IInstalledSkillInfo[] {
  return installedSkills.filter((skill) => !isAutoInjectedBuiltinSkill(skill) && (skill.isBuiltin || skill.enabled !== false));
}

export function sanitizeAssistantEnabledSkills(enabledSkills: string[] | undefined, installedSkills: IInstalledSkillInfo[]): string[] {
  const selectableNames = new Set(getSelectableAssistantSkills(installedSkills).map((skill) => skill.name));
  return (enabledSkills || []).filter((skillName) => selectableNames.has(skillName));
}
