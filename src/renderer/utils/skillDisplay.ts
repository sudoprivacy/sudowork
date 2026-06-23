/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IInstalledSkillInfo } from '@/common/ipcBridge';
import defaultSkillIcon from '@/renderer/assets/icon-catalogue.svg';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { COS_HUB_BASE, COS_LEGACY_HUB_BASE } from '@/shared/cos';
import uploadSkillDefaultIcon from '../../../resources/upload_skill_default.svg';

/** COS base URL for Hub skill icons (role-based hub bucket; primary). */
const HUB_SKILL_ICON_COS_BASE = `${COS_HUB_BASE}/`;
/** Legacy hub bucket, kept live as a fallback during deprecation. */
const HUB_SKILL_ICON_LEGACY_BASE = `${COS_LEGACY_HUB_BASE}/`;

/**
 * Given a rendered hub-icon src on the primary bucket, return its legacy-bucket
 * equivalent — used as an <img> onError fallback so icons still resolve while the
 * marketplace upload side is migrated. Returns undefined when no swap applies.
 */
export function hubIconLegacyFallback(src: string | null | undefined): string | undefined {
  if (src && src.startsWith(HUB_SKILL_ICON_COS_BASE)) {
    return `${HUB_SKILL_ICON_LEGACY_BASE}${src.slice(HUB_SKILL_ICON_COS_BASE.length)}`;
  }
  return undefined;
}

/** <img onError> handler: swap a primary hub-bucket icon to the legacy bucket once. */
export function handleSkillIconError(e: { currentTarget: HTMLImageElement }): void {
  const img = e.currentTarget;
  const fallback = hubIconLegacyFallback(img.src);
  if (fallback && img.src !== fallback) {
    img.src = fallback;
  }
}

export function buildSkillDisplayName(skillName: string): string {
  return skillName
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Check if a URL is a relative path (not absolute URL or protocol URL)
 */
function isRelativePath(url: string): boolean {
  if (!url) return false;
  return !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:') && !url.startsWith('/') && !url.startsWith('aion-asset://') && !url.startsWith('file://') && !url.startsWith('./');
}

/**
 * Resolve Hub skill icon URL.
 * Hub skills may have relative icon paths that need COS URL prefix.
 */
function resolveHubSkillIcon(icon: string | undefined): string | undefined {
  const normalized = (icon || '').trim();
  if (!normalized) return undefined;

  // If it's a relative path, prepend COS URL
  if (isRelativePath(normalized)) {
    return `${HUB_SKILL_ICON_COS_BASE}${normalized}`;
  }

  return normalized;
}

export function resolveSkillIcon(icon?: string | null, fallbackToDefault = true): string {
  const normalized = (icon || '').trim();
  if (normalized === 'upload_skill_default.svg') {
    return uploadSkillDefaultIcon;
  }

  // First try to resolve as extension asset (aion-asset://, file:// protocols)
  const extensionResolved = resolveExtensionAssetUrl(icon || undefined);
  if (extensionResolved) {
    return extensionResolved;
  }

  // If the original icon is a relative path, treat it as a Hub skill icon
  // and prepend the COS URL
  if (normalized && isRelativePath(normalized)) {
    return `${HUB_SKILL_ICON_COS_BASE}${normalized}`;
  }

  // Return original value or fallback
  return normalized || (fallbackToDefault ? defaultSkillIcon : '');
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
  const isHubSkill = skill.meta?.source_type === 'hub' || (skill.meta?.source_type === undefined && skill.meta?.icon && isRelativePath(skill.meta.icon));

  let resolvedIcon: string;
  if (isHubSkill) {
    // Hub skills: resolve relative icon paths to COS URL
    resolvedIcon = resolveHubSkillIcon(skill.meta?.icon) || '';
  } else if (isUploadSkill) {
    // Upload skills: use upload default icon if no icon specified
    resolvedIcon = skill.meta?.icon ? resolveSkillIcon(skill.meta.icon, false) : uploadSkillDefaultIcon;
  } else {
    // Preserve emoji-only skills while still giving icon-less skills a
    // consistent default image fallback.
    resolvedIcon = skill.meta?.icon ? resolveSkillIcon(skill.meta.icon, false) : skill.meta?.emoji ? '' : resolveSkillIcon(undefined);
  }

  return {
    displayName: skill.meta?.display_name || buildSkillDisplayName(skill.name),
    description: skill.meta?.description,
    icon: resolvedIcon,
    emoji: skill.meta?.emoji,
  };
}
