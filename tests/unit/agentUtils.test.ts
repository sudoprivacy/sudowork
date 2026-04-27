import { beforeEach, describe, expect, it, vi } from 'vitest';

const discoverBuiltinSkills = vi.fn(async () => {});
const getBuiltinSkillsIndex = vi.fn(() => [{ name: 'cron', description: 'Builtin cron skill' }]);
const discoverSkills = vi.fn(async () => {});
const getSkillsIndex = vi.fn(() => [{ name: 'cron', description: 'Builtin cron skill' }]);

vi.mock('../../src/process/task/AcpSkillManager', () => ({
  AcpSkillManager: {
    getInstance: vi.fn(() => ({
      discoverBuiltinSkills,
      getBuiltinSkillsIndex,
      discoverSkills,
      getSkillsIndex,
    })),
  },
  buildSkillsIndexText: vi.fn((skills: Array<{ name: string; description: string }>) => {
    return ['[Available Skills]', ...skills.map((skill) => `- ${skill.name}: ${skill.description}`)].join('\n');
  }),
}));

vi.mock('../../src/process/initStorage', () => ({
  getSkillsDir: vi.fn(() => '/tmp/.nexus/skills'),
  getBuiltinSkillsDir: vi.fn(() => '/tmp/.nexus/skills/_system/_builtin'),
  loadSkillsContent: vi.fn(async () => ''),
}));

describe('prepareFirstMessageWithSkillsIndex', () => {
  beforeEach(() => {
    discoverBuiltinSkills.mockClear();
    getBuiltinSkillsIndex.mockClear();
    discoverSkills.mockClear();
    getSkillsIndex.mockClear();
  });

  it('injects only builtin skill paths for ACP/OpenClaw agents', async () => {
    const { prepareFirstMessageWithSkillsIndex } = await import('../../src/process/task/agentUtils');

    const result = await prepareFirstMessageWithSkillsIndex('do something', {
      presetContext: 'rules',
      enabledSkills: ['pptx', 'custom-tool'],
      workspace: '/tmp/workspace',
      presetAgentType: 'codex',
    });

    expect(discoverBuiltinSkills).toHaveBeenCalledOnce();
    expect(result).toContain('/tmp/.nexus/skills/_system/_builtin/{skill-name}/SKILL.md');
    expect(result).not.toContain('/_hub/');
    expect(result).not.toContain('/_my-custom-skill/');
    expect(result).not.toContain('pptx');
    expect(result).toContain('cron');
  });

  it('also injects builtin skills for claude', async () => {
    const { prepareFirstMessageWithSkillsIndex } = await import('../../src/process/task/agentUtils');

    const result = await prepareFirstMessageWithSkillsIndex('do something', {
      presetContext: 'rules',
      workspace: '/tmp/workspace',
      presetAgentType: 'claude',
    });

    expect(discoverBuiltinSkills).toHaveBeenCalledOnce();
    expect(result).toContain('/tmp/.nexus/skills/_system/_builtin/{skill-name}/SKILL.md');
    expect(result).toContain('cron');
  });

  it('injects workspace skills directory hint before user request', async () => {
    const { injectSkillsDirectoryHint } = await import('../../src/process/task/agentUtils');

    const result = await injectSkillsDirectoryHint('[Assistant Rules - You MUST follow these instructions]\n\n[User Request]\ndo something', '/tmp/workspace/skills');

    expect(result).toContain('[Skills Directory]');
    expect(result).toContain('/tmp/workspace/skills');
    expect(result.indexOf('[Skills Directory]')).toBeLessThan(result.indexOf('[User Request]'));
  });

  it('folds workspaceSkillsHint into a single-pass envelope (no post-hoc splice)', async () => {
    const { prepareFirstMessageWithSkillsIndex } = await import('../../src/process/task/agentUtils');

    const result = await prepareFirstMessageWithSkillsIndex('do something', {
      presetContext: 'rules',
      workspace: '/tmp/workspace',
      presetAgentType: 'claude',
      workspaceSkillsHint: { skillsDir: '/tmp/workspace/skills' },
    });

    expect(result).toContain('[Assistant Rules');
    expect(result).toContain('[Skills Directory]');
    expect(result).toContain('/tmp/workspace/skills');
    expect(result).toContain('[User Request]');
    // Order: Assistant Rules → Skills Directory → User Request, all from one wrap.
    expect(result.indexOf('[Assistant Rules')).toBeLessThan(result.indexOf('[Skills Directory]'));
    expect(result.indexOf('[Skills Directory]')).toBeLessThan(result.indexOf('[User Request]'));
  });
});
