/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizeSkillVersion } from '@/renderer/utils/skillDisplay';
import type { IInstalledSkillInfo } from '@/common/ipcBridge';

export const normalizeAssistantVersion = (version?: string | null) => normalizeSkillVersion(version).replace(/^v(?=\d)/i, '');

export function isAutoInjectedBuiltinSkill(skill: IInstalledSkillInfo): boolean {
  return skill.isAutoInjectedBuiltin === true;
}

export function getSelectableAssistantSkills(installedSkills: IInstalledSkillInfo[]): IInstalledSkillInfo[] {
  return installedSkills.filter((skill) => !isAutoInjectedBuiltinSkill(skill) && (skill.isBuiltin || skill.enabled !== false));
}

export function getAssistantSkillId(skill: IInstalledSkillInfo): string {
  return skill.meta?.id || skill.name;
}

export function getAssistantSkillAliases(skill: IInstalledSkillInfo): string[] {
  return Array.from(new Set([getAssistantSkillId(skill), skill.name].filter(Boolean)));
}

export function isAssistantSkillSelected(selectedSkills: string[], skill: IInstalledSkillInfo): boolean {
  return selectedSkills.includes(getAssistantSkillId(skill));
}

export function toggleAssistantSkillSelection(selectedSkills: string[], skill: IInstalledSkillInfo): string[] {
  const aliases = getAssistantSkillAliases(skill);
  if (aliases.some((alias) => selectedSkills.includes(alias))) {
    return selectedSkills.filter((selected) => !aliases.includes(selected));
  }
  return [...selectedSkills, getAssistantSkillId(skill)];
}

export function sanitizeAssistantEnabledSkills(enabledSkills: string[] | undefined, installedSkills: IInstalledSkillInfo[]): string[] {
  const canonicalByAlias = new Map<string, string | null>();
  getSelectableAssistantSkills(installedSkills).forEach((skill) => {
    const skillId = getAssistantSkillId(skill);
    getAssistantSkillAliases(skill).forEach((alias) => {
      const existing = canonicalByAlias.get(alias);
      if (existing && existing !== skillId) {
        canonicalByAlias.set(alias, null);
        return;
      }
      canonicalByAlias.set(alias, skillId);
    });
  });
  const sanitized = (enabledSkills || []).map((skillId) => canonicalByAlias.get(skillId)).filter((skillId): skillId is string => typeof skillId === 'string');
  return Array.from(new Set(sanitized));
}
