import brand from '@brand';

const brandSkillConfig = brand as typeof brand & { defaultAgentId?: string; defaultAgentSkills?: string[] };

export const defaultAgentSkillOrder = brandSkillConfig.defaultAgentId ? brandSkillConfig.defaultAgentSkills : undefined;
export const brandDefaultAgentId = brandSkillConfig.defaultAgentId;

export function prioritizeSkills<T extends { name: string }>(skills: T[], prioritizedNames?: string[]): T[] {
  if (!prioritizedNames?.length) return skills;

  const priorities = new Map(prioritizedNames.map((name, index) => [name, index]));
  return skills
    .map((skill, index) => ({ skill, index, priority: priorities.get(skill.name) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ skill }) => skill);
}
