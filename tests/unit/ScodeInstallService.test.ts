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
  });
});
