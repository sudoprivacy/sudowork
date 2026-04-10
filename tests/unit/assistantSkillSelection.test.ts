/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { getSelectableAssistantSkills, isAutoInjectedBuiltinSkill, sanitizeAssistantEnabledSkills } from '@/renderer/pages/settings/assistantSkillSelection';

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
});
