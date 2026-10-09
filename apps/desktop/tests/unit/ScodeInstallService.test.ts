import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/mock-app',
  },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

describe('ScodeInstallService', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sudowork-scode-agents-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('writes memory-storage rules to workspace AGENTS.md for scode sessions', async () => {
    const { ensureWorkspaceAgentsMdRules } = await import('../../src/process/services/scode/ScodeInstallService');

    ensureWorkspaceAgentsMdRules(tempRoot);

    const agentsMd = await fs.readFile(path.join(tempRoot, '.nexus', 'sudocode', 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('<!-- SUDOCODE_MEMORY_STORAGE -->');
    expect(agentsMd).toContain('Do NOT use the Config tool for memory operations.');
    expect(agentsMd).toContain('Do NOT write memories or natural-language instructions to `settings.json`');
    expect(agentsMd).toContain("Follow the engine's `# auto memory` instructions");
    expect(agentsMd).toContain('`SUDOCODE_MEMORY_DIR`');
    expect(agentsMd).toContain('do not infer a global directory');
    expect(agentsMd).not.toContain('Prefer `.nexus/sudocode/AGENTS.md`');
  });

  it('replaces old memory rules without losing workspace instructions', async () => {
    const { ensureWorkspaceAgentsMdRules } = await import('../../src/process/services/scode/ScodeInstallService');
    const agentsPath = path.join(tempRoot, '.nexus', 'sudocode', 'AGENTS.md');
    await fs.mkdir(path.dirname(agentsPath), { recursive: true });
    await fs.writeFile(agentsPath, '# Project rules\nKeep the project convention.\n\n<!-- SUDOCODE_MEMORY_STORAGE -->\nUpdate AGENTS.md for every personal preference.\n');

    ensureWorkspaceAgentsMdRules(tempRoot);
    const first = await fs.readFile(agentsPath, 'utf-8');
    expect(first).toContain('Keep the project convention.');
    expect(first).not.toContain('Update AGENTS.md for every personal preference.');
    expect(first).toContain('that isolated directory is the only memory store for this Agent');
    ensureWorkspaceAgentsMdRules(tempRoot);
    const updated = await fs.readFile(agentsPath, 'utf-8');
    expect(updated).toContain('Keep the project convention.');
    expect(updated.match(/<!-- SUDOCODE_MEMORY_STORAGE -->/g)).toHaveLength(1);
  });
});
