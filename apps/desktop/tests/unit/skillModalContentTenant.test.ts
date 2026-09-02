/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { resolveSkillTenantId } from '@/renderer/pages/skills/utils';

describe('resolveSkillTenantId', () => {
  it('returns enterprise code only for the exclusive tab', () => {
    expect(resolveSkillTenantId('store', 'ent-001')).toBeUndefined();
    expect(resolveSkillTenantId('installed', 'ent-001')).toBeUndefined();
    expect(resolveSkillTenantId('exclusive', 'ent-001')).toBe('ent-001');
  });

  it('trims and ignores empty enterprise codes', () => {
    expect(resolveSkillTenantId('exclusive', '  ent-001  ')).toBe('ent-001');
    expect(resolveSkillTenantId('exclusive', '   ')).toBeUndefined();
    expect(resolveSkillTenantId('exclusive')).toBeUndefined();
  });
});
