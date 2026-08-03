import { beforeEach, describe, expect, it, vi } from 'vitest';

const discoverBuiltinSkills = vi.fn(async () => {});
const discoverSkills = vi.fn(async () => {});
const getBuiltinSkillsIndex = vi.fn(() => [{ name: 'cron', description: 'Builtin cron skill' }]);
const getSkillsIndex = vi.fn(() => []);

vi.mock('../../src/process/task/AcpSkillManager', () => ({
  AcpSkillManager: {
    getInstance: vi.fn(() => ({
      discoverBuiltinSkills,
      discoverSkills,
      getBuiltinSkillsIndex,
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

vi.mock('electron', () => ({
  app: { getPath: (_key: string) => '/tmp/.nexus-test' },
}));

const isCronSkillAllowed = vi.fn(async () => true);
vi.mock('@process/services/cron/cronPolicy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@process/services/cron/cronPolicy')>();
  return {
    ...actual,
    isCronSkillAllowed: () => isCronSkillAllowed(),
  };
});

describe('prepareFirstMessageWithSkillsIndex', () => {
  beforeEach(() => {
    discoverBuiltinSkills.mockClear();
    discoverSkills.mockClear();
    getBuiltinSkillsIndex.mockClear();
    getSkillsIndex.mockClear();
    getBuiltinSkillsIndex.mockReturnValue([{ name: 'cron', description: 'Builtin cron skill' }]);
    isCronSkillAllowed.mockReset();
    isCronSkillAllowed.mockResolvedValue(true);
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
    expect(result).not.toContain('/pptx/SKILL.md');
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

  it('omits the cron skill when org policy disallows it (#854)', async () => {
    isCronSkillAllowed.mockResolvedValue(false);
    getBuiltinSkillsIndex.mockReturnValue([
      { name: 'cron', description: 'Builtin cron skill' },
      { name: 'browser', description: 'Builtin browser skill' },
    ]);

    const { prepareFirstMessageWithSkillsIndex } = await import('../../src/process/task/agentUtils');
    const result = await prepareFirstMessageWithSkillsIndex('do something', {
      presetContext: 'rules',
      workspace: '/tmp/workspace',
      presetAgentType: 'claude',
    });

    // The cron skill index entry / file path is omitted...
    expect(result).not.toContain('cron/SKILL.md');
    expect(result).not.toContain('- cron:');
    // ...but an explicit creation ban is injected so the agent can't
    // hallucinate success; listing/deleting existing tasks stays allowed.
    expect(result).toContain('[Scheduled Tasks — CREATION DISABLED BY ORGANIZATION]');
    expect(result).toContain('NEVER claim a scheduled task was created');
    expect(result).toContain('[CRON_LIST]');
    expect(result).toContain('browser');
  });

  it('includes the cron skill when org policy allows it', async () => {
    isCronSkillAllowed.mockResolvedValue(true);
    getBuiltinSkillsIndex.mockReturnValue([
      { name: 'cron', description: 'Builtin cron skill' },
      { name: 'browser', description: 'Builtin browser skill' },
    ]);

    const { prepareFirstMessageWithSkillsIndex } = await import('../../src/process/task/agentUtils');
    const result = await prepareFirstMessageWithSkillsIndex('do something', {
      presetContext: 'rules',
      workspace: '/tmp/workspace',
      presetAgentType: 'claude',
    });

    expect(result).toContain('cron/SKILL.md');
    expect(result).toContain('browser');
    expect(result).not.toContain('[Scheduled Tasks — CREATION DISABLED BY ORGANIZATION]');
  });

  it('injects workspace skills directory hint before user request', async () => {
    const { injectSkillsDirectoryHint } = await import('../../src/process/task/agentUtils');

    const result = await injectSkillsDirectoryHint('[Assistant Rules - You MUST follow these instructions]\n\n[User Request]\ndo something', '/tmp/workspace/skills');

    expect(result).toContain('[Skills Directory]');
    expect(result).toContain('/tmp/workspace/skills');
    expect(result.indexOf('[Skills Directory]')).toBeLessThan(result.indexOf('[User Request]'));
  });
});
