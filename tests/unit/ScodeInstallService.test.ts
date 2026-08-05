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

  it('routes user memories to native persistent memory instead of workspace AGENTS.md', async () => {
    const { ensureWorkspaceAgentsMdRules } = await import('../../src/process/services/scode/ScodeInstallService');

    ensureWorkspaceAgentsMdRules(tempRoot);

    const agentsMd = await fs.readFile(path.join(tempRoot, '.nexus', 'sudocode', 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('<!-- SUDOCODE_MEMORY_STORAGE -->');
    expect(agentsMd).toContain('Use the native persistent memory system described in the system prompt.');
    expect(agentsMd).toContain('Do NOT store user memories in any AGENTS.md under the current workspace');
    expect(agentsMd).not.toContain('Update the AGENTS.md file that applies to the current workspace.');
  });
});
