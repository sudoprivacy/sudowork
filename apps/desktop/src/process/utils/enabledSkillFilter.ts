/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import type { MossSessionAvailableSkill } from '@sudowork/host-bridge/ipcBridge';
import { normalizeSkillNames } from './conversationAssistantSkills';

type InstalledSkillLike = {
  name: string;
  enabled: boolean;
  meta?: {
    id?: string;
    name?: string;
    display_name?: string;
  };
};

export type EnabledSkillFilterDeps = {
  getInstalledSkills: () => Promise<InstalledSkillLike[]>;
  isEnterpriseMode: () => boolean | Promise<boolean>;
};

const defaultDeps: EnabledSkillFilterDeps = {
  getInstalledSkills: async () => {
    const { skillManager } = await import('../SkillManager');
    return skillManager.getInstalledSkills();
  },
  isEnterpriseMode: async () => {
    const { isEnterpriseMode } = await import('@/common/enterpriseDebugConfig');
    return isEnterpriseMode();
  },
};

function addSkillKeys(target: Set<string>, skill: InstalledSkillLike): void {
  for (const key of [skill.name, skill.meta?.id, skill.meta?.name, skill.meta?.display_name]) {
    if (typeof key === 'string' && key.trim()) {
      target.add(key.trim());
    }
  }
}

function addPathCandidates(target: string[], skillPath?: string): void {
  const trimmedPath = skillPath?.trim();
  if (!trimmedPath) return;

  target.push(trimmedPath);

  const basename = path.basename(trimmedPath);
  if (basename && basename !== trimmedPath) {
    target.push(basename);
  }

  const parentName = path.basename(path.dirname(trimmedPath));
  if (basename.toLowerCase() === 'skill.md' && parentName) {
    target.push(parentName);
  }
}

async function getDisabledSkillKeys(deps: EnabledSkillFilterDeps = defaultDeps): Promise<Set<string>> {
  const disabledKeys = new Set<string>();
  const installedSkills = await deps.getInstalledSkills();

  for (const skill of installedSkills) {
    if (skill.enabled === false) {
      addSkillKeys(disabledKeys, skill);
    }
  }

  return disabledKeys;
}

export async function filterEnabledSkillNames(skillNames?: readonly string[], deps: EnabledSkillFilterDeps = defaultDeps): Promise<string[] | undefined> {
  if (!Array.isArray(skillNames)) {
    return undefined;
  }

  if (!(await deps.isEnterpriseMode())) {
    return [...skillNames];
  }

  const normalizedSkillNames = normalizeSkillNames(skillNames);
  if (normalizedSkillNames.length === 0) {
    return [];
  }

  const disabledKeys = await getDisabledSkillKeys(deps);
  return normalizedSkillNames.filter((skillName) => !disabledKeys.has(skillName));
}

export async function filterRemoteAvailableSkills(skills: MossSessionAvailableSkill[], deps: EnabledSkillFilterDeps = defaultDeps): Promise<MossSessionAvailableSkill[]> {
  if (!(await deps.isEnterpriseMode())) {
    return skills;
  }

  const disabledKeys = await getDisabledSkillKeys(deps);

  return skills.filter((skill) => {
    const candidates = [skill.name, skill.displayName].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    addPathCandidates(candidates, skill.path);

    if (candidates.length === 0) return true;

    // Keep skills that are not locally installed (server-side or builtin skills),
    // but hide any skill that maps to a locally installed disabled skill.
    return !candidates.some((candidate) => disabledKeys.has(candidate.trim()));
  });
}
