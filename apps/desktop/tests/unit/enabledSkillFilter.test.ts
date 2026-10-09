import { describe, expect, it, vi } from 'vitest';

import type { MossSessionAvailableSkill } from '@sudowork/host-bridge/ipcBridge';
import { filterEnabledSkillNames, filterRemoteAvailableSkills, type EnabledSkillFilterDeps } from '@/process/utils/enabledSkillFilter';

function createDeps(skills: Awaited<ReturnType<EnabledSkillFilterDeps['getInstalledSkills']>>): EnabledSkillFilterDeps {
  return {
    getInstalledSkills: vi.fn(async () => skills),
    isEnterpriseMode: vi.fn(() => true),
  };
}

describe('enabledSkillFilter', () => {
  it('returns the original selections in personal mode', async () => {
    const deps: EnabledSkillFilterDeps = {
      getInstalledSkills: vi.fn(async () => {
        throw new Error('should not load installed skills in personal mode');
      }),
      isEnterpriseMode: vi.fn(() => false),
    };
    const skills: MossSessionAvailableSkill[] = [{ name: 'disabled-name', description: 'Personal mode keeps server response unchanged' }];

    await expect(filterEnabledSkillNames([' disabled-name '], deps)).resolves.toEqual([' disabled-name ']);
    await expect(filterRemoteAvailableSkills(skills, deps)).resolves.toBe(skills);
  });

  it('removes locally disabled skill names while keeping enabled and unknown skills', async () => {
    const deps = createDeps([
      {
        name: 'enabled-dir',
        enabled: true,
        meta: { id: 'enabled-id', name: 'enabled-name', display_name: 'Enabled Skill' },
      },
      {
        name: 'disabled-dir',
        enabled: false,
        meta: { id: 'disabled-id', name: 'disabled-name', display_name: 'Disabled Skill' },
      },
    ]);

    await expect(filterEnabledSkillNames([' enabled-dir ', 'disabled-id', 'disabled-name', 'remote-only'], deps)).resolves.toEqual(['enabled-dir', 'remote-only']);
  });

  it('filters remote available skills only when they map to locally disabled skills', async () => {
    const deps = createDeps([
      {
        name: 'disabled-dir',
        enabled: false,
        meta: { id: 'disabled-id', name: 'disabled-name', display_name: 'Disabled Skill' },
      },
    ]);

    const skills: MossSessionAvailableSkill[] = [
      { name: 'remote-only', description: 'Server-side skill' },
      { name: 'disabled-name', description: 'Disabled by local meta name' },
      { name: 'path-only', description: 'Disabled by path', path: '/tmp/skills/disabled-dir/SKILL.md' },
      { name: 'enabled-local', description: 'Not disabled locally' },
    ];

    await expect(filterRemoteAvailableSkills(skills, deps)).resolves.toEqual([
      { name: 'remote-only', description: 'Server-side skill' },
      { name: 'enabled-local', description: 'Not disabled locally' },
    ]);
  });
});
