/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IInstalledSkillInfo } from '@/common/ipcBridge';
import defaultSkillIcon from '@/renderer/assets/icon-catalogue.svg';
import uploadSkillDefaultIcon from '../../../resources/upload_skill_default.svg';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';

export function buildSkillDisplayName(skillName: string): string {
  return skillName
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function resolveSkillIcon(icon?: string | null, fallbackToDefault = true): string {
  const normalized = (icon || '').trim();
  if (normalized === 'upload_skill_default.svg') {
    return uploadSkillDefaultIcon;
  }
  const resolved = resolveExtensionAssetUrl(icon || undefined) || icon || '';
  return resolved || (fallbackToDefault ? defaultSkillIcon : '');
}

export function normalizeSkillVersion(version?: string | null): string {
  const normalized = (version || '').trim();
  if (!normalized) {
    return '';
  }

  const lower = normalized.toLowerCase();
  if (lower === 'unknown' || lower === 'unkown') {
    return '';
  }

  return normalized;
}

export function getInstalledSkillDisplay(skill: Pick<IInstalledSkillInfo, 'name' | 'meta'>): {
  displayName: string;
  description?: string;
  icon: string;
  emoji?: string | null;
} {
  const isUploadSkill = skill.meta?.source_type === 'upload';
  const resolvedIcon = skill.meta?.icon ? resolveSkillIcon(skill.meta.icon, false) : isUploadSkill ? uploadSkillDefaultIcon : '';

  return {
    displayName: skill.meta?.display_name || buildSkillDisplayName(skill.name),
    description: skill.meta?.description,
    icon: resolvedIcon,
    emoji: skill.meta?.emoji,
  };
}
