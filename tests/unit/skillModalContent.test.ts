/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { getInstalledSkillBadgeCount, getLocalSkillImportDialogOptions } from '@/renderer/components/SettingsModal/contents/SkillModalContent';

describe('getInstalledSkillBadgeCount', () => {
  it('uses the full installed skill list count instead of the hub-only comparison subset', () => {
    const installedList = Array.from({ length: 22 }, (_, index) => ({
      name: `skill-${index + 1}`,
      version: '1.0.0',
      isBuiltin: index < 20,
      isHubInstalled: index < 2,
      enabled: true,
      category: index < 20 ? 'system' : 'hub',
      status: 'enabled',
      meta: index < 20 ? { source_type: 'upload' } : { source_type: 'hub', id: `hub-${index + 1}` },
    }));

    expect(getInstalledSkillBadgeCount(installedList)).toBe(22);
  });
});

describe('local skill import dialog helpers', () => {
  it('builds zip-only dialog options when importing zip archives', () => {
    expect(getLocalSkillImportDialogOptions('zip')).toEqual({
      properties: ['openFile'],
      filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
    });
  });

  it('builds directory-only dialog options when importing folders', () => {
    expect(getLocalSkillImportDialogOptions('directory')).toEqual({
      properties: ['openDirectory'],
    });
  });
});
