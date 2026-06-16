/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks (must be before imports) ──

const mockProcessConfig = {
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/mock/app',
  },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock('@process/services/claudeCli/NodeRuntimeService', () => ({
  getNodeBinaryPath: () => '/mock/node/bin/node',
}));

vi.mock('@process/initStorage', () => ({
  ProcessConfig: {
    get: (...args: unknown[]) => mockProcessConfig.get(...args),
    set: (...args: unknown[]) => mockProcessConfig.set(...args),
  },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

import { existsSync } from 'fs';
import { ensureBrowserPanelMcpRegistered } from '@process/services/mcpServices/SudoworkBuiltinMcpRegistration';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import type { IMcpServer } from '@/common/storage';

// ── Helpers ──

const SCRIPT_PATH = '/mock/app/resources/browser-panel-mcp/index.js';
const NODE_PATH = '/mock/node/bin/node';

function makeEntry(overrides: Partial<IMcpServer> = {}): IMcpServer {
  return {
    id: 'mcp_builtin_browser-panel_1000',
    name: 'browser-panel',
    description: 'Open URLs in the right-side panel visible to the user.',
    enabled: false,
    transport: { type: 'stdio', command: NODE_PATH, args: [SCRIPT_PATH] },
    createdAt: 1000,
    updatedAt: 1000,
    originalJson: '',
    ...overrides,
  };
}

// ── Tests ──

describe('ensureBrowserPanelMcpRegistered', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    mockProcessConfig.get.mockResolvedValue([]);
    mockProcessConfig.set.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Scenario 1: Fresh install — no existing MCP config
  it('registers browser-panel on fresh config', async () => {
    mockProcessConfig.get.mockResolvedValue([]);

    await ensureBrowserPanelMcpRegistered();

    expect(mockProcessConfig.set).toHaveBeenCalledOnce();
    const [key, config] = mockProcessConfig.set.mock.calls[0];
    expect(key).toBe('mcp.config');
    expect(config).toHaveLength(1);

    const entry = config[0] as IMcpServer;
    expect(entry.name).toBe('browser-panel');
    expect(entry.enabled).toBe(false);
    expect(entry.transport).toEqual({
      type: 'stdio',
      command: NODE_PATH,
      args: [SCRIPT_PATH],
    });
    expect(entry.id).toMatch(/^mcp_builtin_browser-panel_\d+$/);
    expect(entry.description).toContain('right-side panel');
  });

  // Scenario 2: Config exists but no browser-panel — adds alongside existing
  it('adds browser-panel alongside existing MCP servers', async () => {
    const otherServer = makeEntry({ name: 'some-other-mcp', id: 'other_1' });
    mockProcessConfig.get.mockResolvedValue([otherServer]);

    await ensureBrowserPanelMcpRegistered();

    expect(mockProcessConfig.set).toHaveBeenCalledOnce();
    const config = mockProcessConfig.set.mock.calls[0][1] as IMcpServer[];
    expect(config).toHaveLength(2);
    expect(config[0].name).toBe('some-other-mcp');
    expect(config[1].name).toBe('browser-panel');
  });

  // Scenario 3: Correct entry already exists — no-op (idempotent)
  it('skips registration when entry is already correct', async () => {
    mockProcessConfig.get.mockResolvedValue([makeEntry()]);

    await ensureBrowserPanelMcpRegistered();

    expect(mockProcessConfig.set).not.toHaveBeenCalled();
    expect(mainLog).toHaveBeenCalledWith('BrowserPanelMcp', 'already registered with correct config');
  });

  // Scenario 4: Stale entry — updates transport, preserves enabled state
  it('updates stale entry while preserving enabled state', async () => {
    const staleEntry = makeEntry({
      enabled: true,
      transport: { type: 'stdio', command: '/old/node', args: ['/old/script.js'] },
    });
    mockProcessConfig.get.mockResolvedValue([staleEntry]);

    await ensureBrowserPanelMcpRegistered();

    expect(mockProcessConfig.set).toHaveBeenCalledOnce();
    const config = mockProcessConfig.set.mock.calls[0][1] as IMcpServer[];
    expect(config).toHaveLength(1);
    expect(config[0].enabled).toBe(true); // preserved
    expect(config[0].transport.command).toBe(NODE_PATH); // updated
  });

  // Scenario 5: Missing MCP script — skips gracefully
  it('skips when MCP script not found', async () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      if (String(p).includes('browser-panel-mcp')) return false;
      return true;
    });

    await ensureBrowserPanelMcpRegistered();

    expect(mockProcessConfig.set).not.toHaveBeenCalled();
    expect(mainWarn).toHaveBeenCalledWith('BrowserPanelMcp', expect.stringContaining('bundled MCP script not found'));
  });

  // Scenario 6: Missing node binary — skips gracefully
  it('skips when node binary not found', async () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      if (String(p).includes('node')) return false;
      return true;
    });

    await ensureBrowserPanelMcpRegistered();

    expect(mockProcessConfig.set).not.toHaveBeenCalled();
    expect(mainWarn).toHaveBeenCalledWith('BrowserPanelMcp', expect.stringContaining('bundled node not found'));
  });

  // Scenario 7: ProcessConfig.get fails — treats as empty config
  it('creates new config when ProcessConfig.get fails', async () => {
    mockProcessConfig.get.mockRejectedValue(new Error('corrupt'));

    await ensureBrowserPanelMcpRegistered();

    expect(mockProcessConfig.set).toHaveBeenCalledOnce();
    const config = mockProcessConfig.set.mock.calls[0][1] as IMcpServer[];
    expect(config).toHaveLength(1);
    expect(config[0].name).toBe('browser-panel');
  });

  // Scenario 8: ProcessConfig.set fails — logs error, does not throw
  it('catches and logs ProcessConfig.set failure', async () => {
    mockProcessConfig.set.mockRejectedValue(new Error('disk full'));

    await ensureBrowserPanelMcpRegistered();

    expect(mainError).toHaveBeenCalledWith('BrowserPanelMcp', expect.stringContaining('disk full'));
  });

  // Scenario 9: Defaults — enabled=false (product decision)
  it('defaults to enabled=false', async () => {
    mockProcessConfig.get.mockResolvedValue([]);

    await ensureBrowserPanelMcpRegistered();

    const config = mockProcessConfig.set.mock.calls[0][1] as IMcpServer[];
    expect(config[0].enabled).toBe(false);
  });
});
