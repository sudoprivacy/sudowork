/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { getSelectableAssistantSkills, isAssistantSkillSelected, isAutoInjectedBuiltinSkill, sanitizeAssistantEnabledSkills, toggleAssistantSkillSelection } from '@renderer/pages/agents/utils';

describe('assistantSkillSelection', () => {
  const installedSkills = [
    { name: 'cron', isBuiltin: true, isAutoInjectedBuiltin: true, enabled: true, meta: { is_builtin: true } },
    { name: 'browser', isBuiltin: true, isAutoInjectedBuiltin: true, enabled: true, meta: { is_builtin: true } },
    { name: 'system-tool', isBuiltin: true, isAutoInjectedBuiltin: false, enabled: true, meta: { is_builtin: true } },
    { name: 'pptx', isBuiltin: false, enabled: true },
    { name: 'xlsx', isBuiltin: false, enabled: false },
    { name: 'custom-tool', isBuiltin: false, enabled: true },
  ] as any;

  it('detects auto-injected builtin skills from _builtin metadata', () => {
    expect(isAutoInjectedBuiltinSkill(installedSkills[0])).toBe(true);
    expect(isAutoInjectedBuiltinSkill(installedSkills[2])).toBe(false);
  });

  it('excludes only _builtin auto-injected skills from assistant-selectable skills', () => {
    expect(getSelectableAssistantSkills(installedSkills).map((skill) => skill.name)).toEqual(['system-tool', 'pptx', 'custom-tool']);
  });

  it('strips only _builtin selections from persisted enabledSkills', () => {
    expect(sanitizeAssistantEnabledSkills(['cron', 'pptx', 'browser', 'system-tool', 'missing'], installedSkills)).toEqual(['pptx', 'system-tool']);
  });

  it('matches imported assistant skills stored by name when installed skills have IDs', () => {
    const skill = {
      name: 'jiangzhao-s1-requirement',
      isBuiltin: false,
      enabled: true,
      meta: { id: 'bea928a7-75d7-4d4e-b651-61509170de85' },
    } as any;

    const sanitized = sanitizeAssistantEnabledSkills(['jiangzhao-s1-requirement'], [skill]);
    expect(sanitized).toEqual(['bea928a7-75d7-4d4e-b651-61509170de85']);
    expect(isAssistantSkillSelected(sanitized, skill)).toBe(true);
    expect(toggleAssistantSkillSelection(['jiangzhao-s1-requirement'], skill)).toEqual([]);
  });

  it('does not map skill names when duplicate installed skills share the same name', () => {
    const duplicateSkills = [
      {
        name: 'jiangzhao-s1-requirement',
        isBuiltin: false,
        enabled: true,
        meta: { id: 'bea928a7-75d7-4d4e-b651-61509170de85' },
      },
      {
        name: 'jiangzhao-s1-requirement',
        isBuiltin: false,
        enabled: true,
        meta: { id: '11111111-2222-3333-4444-555555555555' },
      },
    ] as any;

    expect(sanitizeAssistantEnabledSkills(['jiangzhao-s1-requirement'], duplicateSkills)).toEqual([]);
    expect(sanitizeAssistantEnabledSkills(['11111111-2222-3333-4444-555555555555'], duplicateSkills)).toEqual(['11111111-2222-3333-4444-555555555555']);
  });
});
