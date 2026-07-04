/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveSkillIcon, getInstalledSkillDisplay } from '@/renderer/utils/skillDisplay';
import type { ISkillHubSkill, IInstalledSkillInfo, ISkillHubMeta } from '@/common/ipcBridge';
import type { SkillDetailResponse, SkillStoreTab, LocalSkillImportSource, LocalSkillImportDialogOptions } from '../types';

/** Cache expiration time in milliseconds (5 minutes) */
export const VERSION_CACHE_TTL = 5 * 60 * 1000;

// ==================== Helpers ====================

/** Build a synthetic ISkillHubSkill from locally-stored hub metadata */
export function installedInfoToSkill(skillInfo: IInstalledSkillInfo): ISkillHubSkill {
  const { displayName, description, icon, emoji } = getInstalledSkillDisplay(skillInfo);
  const meta = skillInfo.meta as ISkillHubMeta;

  return {
    id: meta.id,
    name: meta.name,
    display_name: displayName,
    description: description || '',
    icon: icon || resolveSkillIcon(meta.icon),
    emoji: emoji || meta.emoji,
    category: meta.category,
    categories: meta.categories,
    applicable_scenarios: meta.applicable_scenarios,
    core_features: meta.core_features,
    homepage: meta.homepage,
    author_id: meta.author_id,
    star_count: 0,
    created_at: meta.installed_at,
    updated_at: meta.installed_at,
  };
}

export function resolveSkillTenantId(tab: SkillStoreTab, enterpriseCode?: string): string | undefined {
  const normalized = enterpriseCode?.trim();
  if (tab !== 'exclusive' || !normalized) {
    return undefined;
  }
  return normalized;
}

export function getLocalSkillImportDialogOptions(source?: LocalSkillImportSource): LocalSkillImportDialogOptions {
  const zipFilter = [{ name: 'Zip Archive', extensions: ['zip'] }];

  if (source === 'zip') {
    return {
      properties: ['openFile'],
      filters: zipFilter,
    };
  }

  if (source === 'directory') {
    return {
      properties: ['openDirectory'],
    };
  }

  return {
    properties: ['openFile', 'openDirectory'],
    filters: zipFilter,
  };
}

export function getInstalledSkillBadgeCount(installedList: IInstalledSkillInfo[]): number {
  return installedList.length;
}

// ==================== API Functions (web fallback) ====================

export async function fetchSkillDetailHttp(skillId: string): Promise<SkillDetailResponse> {
  const response = await fetch(`/api/skill-hub/skills/${skillId}`);
  return response.json();
}

export async function fetchSkillsHttp(params: { cursor?: string; limit?: number; query?: string; category?: string; tenantId?: string }) {
  const searchParams = new URLSearchParams();
  if (params.cursor) searchParams.set('cursor', params.cursor);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.query) searchParams.set('query', params.query);
  if (params.category) searchParams.set('categories', params.category);
  if (params.tenantId) searchParams.set('tenant_id', params.tenantId);
  const response = await fetch(`/api/skill-hub/skills/cursor?${searchParams}`);
  return response.json();
}

export async function fetchCategoriesHttp() {
  const response = await fetch('/api/categories');
  return response.json();
}
