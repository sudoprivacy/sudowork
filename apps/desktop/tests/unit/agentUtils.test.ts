import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
    getBuiltinSkillsIndex.mockClear();
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
    // Only the mocked builtin skill (cron) should be injected — no pptx skill entry.
    // (A blanket not-contain 'pptx' would false-fail on the unrelated deliverable-file
    // naming guidance, which legitimately uses a .pptx example filename.)
    expect(result).not.toContain('pptx/SKILL.md');
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

  it('advertises readable skill targets through a real workspace junction', async () => {
    const { injectSkillsDirectoryHint } = await import('../../src/process/task/agentUtils');
    const root = mkdtempSync(path.join(tmpdir(), 'skill-discovery-'));
    const installed = path.join(root, 'installed', 'browser');
    const workspace = path.join(root, 'workspace', 'skills');
    const link = path.join(workspace, 'browser');
    mkdirSync(installed, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    writeFileSync(path.join(installed, 'SKILL.md'), '# Browser');
    symlinkSync(installed, link, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const result = await injectSkillsDirectoryHint('Browse a website', workspace, ['browser', 'installing']);
      expect(result).toContain(`- browser: ${realpathSync(path.join(installed, 'SKILL.md'))}`);
      expect(result).not.toContain(`${workspace}/browser/SKILL.md`);
      expect(result).toContain(`${workspace}/installing/SKILL.md`);
    } finally {
      unlinkSync(link);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
