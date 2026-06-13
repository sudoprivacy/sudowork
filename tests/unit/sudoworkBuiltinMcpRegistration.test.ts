import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempPath = { app: '/mock/app', userData: '/mock/userData', resources: '/mock/resources' };

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => tempPath.app,
    getPath: (_key: string) => tempPath.userData,
  },
}));

const safeExecMock = vi.fn();
vi.mock('@process/utils/safeExec', () => ({
  safeExec: (...args: unknown[]) => safeExecMock(...args),
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: () => ({}),
}));

vi.mock('@process/services/claudeCli/NodeRuntimeService', () => ({
  getNodeBinaryPath: () => '/mock/node/bin/node',
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

// Make the bundled-script existence check succeed deterministically.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: () => true,
  };
});

import { ensureSudoworkBuiltinMcpInstalled } from '@/process/services/mcpServices/SudoworkBuiltinMcpRegistration';

describe('ensureSudoworkBuiltinMcpInstalled', () => {
  beforeEach(() => {
    safeExecMock.mockReset();
  });

  afterEach(() => {
    safeExecMock.mockReset();
  });

  it('adds the entry when claude mcp list shows no entry', async () => {
    safeExecMock.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith('claude mcp list')) return { stdout: 'No MCP servers configured', stderr: '' };
      return { stdout: '', stderr: '' };
    });
    await ensureSudoworkBuiltinMcpInstalled();
    const cmds = safeExecMock.mock.calls.map((c) => c[0] as string);
    expect(cmds.some((c) => c.startsWith('claude mcp list'))).toBe(true);
    expect(cmds.some((c) => c.startsWith('claude mcp add'))).toBe(true);
    // No remove since the entry wasn't there
    expect(cmds.some((c) => c.startsWith('claude mcp remove'))).toBe(false);
  });

  it('skips when the existing entry already points at the right script path', async () => {
    safeExecMock.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith('claude mcp list')) {
        return {
          stdout: 'browser-panel: /mock/node/bin/node /mock/app/resources/browser-panel-mcp/index.js - ✓ Connected\n',
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });
    await ensureSudoworkBuiltinMcpInstalled();
    const cmds = safeExecMock.mock.calls.map((c) => c[0] as string);
    expect(cmds.some((c) => c.startsWith('claude mcp list'))).toBe(true);
    expect(cmds.some((c) => c.startsWith('claude mcp add'))).toBe(false);
    expect(cmds.some((c) => c.startsWith('claude mcp remove'))).toBe(false);
  });

  it('removes + re-adds when the existing entry is stale (different path)', async () => {
    safeExecMock.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith('claude mcp list')) {
        return {
          stdout: 'browser-panel: /old/node /old/path/index.js - ✓ Connected\n',
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });
    await ensureSudoworkBuiltinMcpInstalled();
    const cmds = safeExecMock.mock.calls.map((c) => c[0] as string);
    expect(cmds.some((c) => c.startsWith('claude mcp remove'))).toBe(true);
    expect(cmds.some((c) => c.startsWith('claude mcp add'))).toBe(true);
  });

  it('does not throw if claude mcp list fails', async () => {
    safeExecMock.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith('claude mcp list')) {
        throw new Error('claude not installed');
      }
      // Subsequent add call still happens because the missing-entry path triggers add.
      return { stdout: '', stderr: '' };
    });
    await expect(ensureSudoworkBuiltinMcpInstalled()).resolves.toBeUndefined();
  });

  it('does not throw if claude mcp add fails', async () => {
    safeExecMock.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith('claude mcp list')) return { stdout: 'No MCP servers configured', stderr: '' };
      if (cmd.startsWith('claude mcp add')) throw new Error('add failed');
      return { stdout: '', stderr: '' };
    });
    await expect(ensureSudoworkBuiltinMcpInstalled()).resolves.toBeUndefined();
  });
});
