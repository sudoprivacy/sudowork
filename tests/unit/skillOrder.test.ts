import { describe, expect, it } from 'vitest';
import { defaultAgentSkillOrder, prioritizeSkills } from '@/renderer/pages/guid/utils/skillOrder';

describe('prioritizeSkills', () => {
  const skills = [{ name: 'browser' }, { name: 'procurement-assistant' }, { name: 'cron' }, { name: 'gov-procurement-analyst' }];

  it('reads the default agent skill order from brand config', () => {
    expect(defaultAgentSkillOrder).toEqual(['gov-procurement-analyst', 'procurement-assistant']);
  });

  it('places configured skills first in configured order', () => {
    expect(prioritizeSkills(skills, ['gov-procurement-analyst', 'procurement-assistant']).map(({ name }) => name)).toEqual(['gov-procurement-analyst', 'procurement-assistant', 'browser', 'cron']);
  });

  it('keeps the original order when no priorities are configured', () => {
    expect(prioritizeSkills(skills)).toBe(skills);
  });
});
