/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/process/initStorage', () => ({
  getSkillsDir: vi.fn(() => '/tmp/.nexus/skills'),
  getBuiltinSkillsDir: vi.fn(() => '/tmp/.nexus/skills/_system/_builtin'),
  getHubSkillsDir: vi.fn(() => '/tmp/.nexus/skills/_hub'),
  getCustomSkillsDir: vi.fn(() => '/tmp/.nexus/skills/_custom'),
  isUserSkillEnabled: vi.fn(async () => true),
}));

vi.mock('../../src/extensions', () => ({
  ExtensionRegistry: {
    getInstance: vi.fn(() => ({ getSkills: () => [] })),
  },
}));

import { AcpSkillManager } from '../../src/process/task/AcpSkillManager';

describe('AcpSkillManager.getInstance per-key cache', () => {
  afterEach(() => {
    AcpSkillManager.resetInstance();
  });

  it('returns the same instance for the same enabledSkills key', () => {
    const a = AcpSkillManager.getInstance(['pptx', 'docx']);
    const b = AcpSkillManager.getInstance(['docx', 'pptx']); // order-insensitive
    expect(a).toBe(b);
  });

  it('returns distinct instances for different enabledSkills (concurrent conversations do not stomp)', () => {
    const avatar = AcpSkillManager.getInstance(['desktop-screenshot']);
    const main = AcpSkillManager.getInstance(['pptx', 'docx']);
    const noPreset = AcpSkillManager.getInstance(undefined);
    const emptyPreset = AcpSkillManager.getInstance([]);

    expect(avatar).not.toBe(main);
    expect(avatar).not.toBe(noPreset);
    expect(noPreset).not.toBe(emptyPreset);

    // Calling getInstance again for the original key must still return the
    // original instance — i.e., the second caller did NOT evict the first.
    expect(AcpSkillManager.getInstance(['desktop-screenshot'])).toBe(avatar);
    expect(AcpSkillManager.getInstance(['pptx', 'docx'])).toBe(main);
  });

  it('resetInstance clears all cached instances', () => {
    const before = AcpSkillManager.getInstance(['pptx']);
    AcpSkillManager.resetInstance();
    const after = AcpSkillManager.getInstance(['pptx']);
    expect(after).not.toBe(before);
  });
});
