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

vi.mock('@process/services/nodeRuntime/NodeRuntimeService', () => ({
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

  /**
   * Scenario: Fresh install → agent can discover browser-panel
   *
   * User problem: New Sudowork install, agent needs to find browser-panel MCP.
   * Workflow: Boot → detect binaries → register in config → agent reads config
   *
   * Data flow: existsSync(script) ✓ → existsSync(node) ✓ → ProcessConfig.get([])
   *   → construct IMcpServer → ProcessConfig.set([entry]) → entry has correct
   *   transport so agent can spawn the process.
   */
  it('fresh install: registers with correct transport so agent can spawn server', async () => {
    // Step 1: Boot with empty config
    mockProcessConfig.get.mockResolvedValue([]);

    // Step 2: Registration runs
    await ensureBrowserPanelMcpRegistered();

    // Step 3: Verify config was written
    expect(mockProcessConfig.set).toHaveBeenCalledOnce();
    const [key, config] = mockProcessConfig.set.mock.calls[0];
    expect(key).toBe('mcp.config');
    expect(config).toHaveLength(1);

    // Step 4: Verify the entry an agent would read to spawn the server
    const entry = config[0] as IMcpServer;
    expect(entry.name).toBe('browser-panel');
    expect(entry.transport).toEqual({
      type: 'stdio',
      command: NODE_PATH,
      args: [SCRIPT_PATH],
    });

    // Step 5: Verify product decision — disabled by default, user opts in
    expect(entry.enabled).toBe(false);

    // Step 6: Verify description guides LLM tool selection
    expect(entry.description).toContain('right-side panel');
    expect(entry.description).toContain('visible');

    // Step 7: Verify ID is deterministic-ish (contains name + timestamp)
    expect(entry.id).toMatch(/^mcp_builtin_browser-panel_\d+$/);
  });

  /**
   * Scenario: Upgrade preserves user's enabled toggle
   *
   * User problem: User enabled browser-panel, then Sudowork updates and
   * node/script paths change. Registration should update paths but NOT
   * reset their enabled=true back to false.
   *
   * Workflow: User enables → app upgrades (paths change) → boot re-registers
   *   → transport updated → enabled preserved
   */
  it('upgrade: updates stale paths without resetting user-enabled toggle', async () => {
    // Step 1: User previously enabled browser-panel (old paths)
    const userEnabledEntry = makeEntry({
      enabled: true,
      transport: { type: 'stdio', command: '/old/node/v20/bin/node', args: ['/old/app/browser-panel-mcp/index.js'] },
    });
    mockProcessConfig.get.mockResolvedValue([userEnabledEntry]);

    // Step 2: App upgrades, new node/script paths detected, re-register
    await ensureBrowserPanelMcpRegistered();

    // Step 3: Config was updated (stale paths → new paths)
    expect(mockProcessConfig.set).toHaveBeenCalledOnce();
    const config = mockProcessConfig.set.mock.calls[0][1] as IMcpServer[];

    // Step 4: Transport points to new binaries
    expect(config[0].transport.command).toBe(NODE_PATH);
    expect((config[0].transport as { args?: string[] }).args?.[0]).toBe(SCRIPT_PATH);

    // Step 5: User's enabled=true choice preserved — this is the critical assertion
    expect(config[0].enabled).toBe(true);

    // Step 6: Only one entry (no duplicate created)
    expect(config).toHaveLength(1);
  });

  /**
   * Scenario: Idempotent — no-op when config is already correct
   *
   * User problem: Every boot calls ensureBrowserPanelMcpRegistered.
   * Must not write to disk unnecessarily (perf + race conditions).
   *
   * Workflow: Boot with correct config → detect match → skip write
   */
  it('idempotent: skips write when config already matches', async () => {
    // Step 1: Config already has correct entry
    mockProcessConfig.get.mockResolvedValue([makeEntry()]);

    // Step 2: Re-registration
    await ensureBrowserPanelMcpRegistered();

    // Step 3: No write occurred
    expect(mockProcessConfig.set).not.toHaveBeenCalled();

    // Step 4: Logged that it's a no-op (confirms detection worked, not a silent failure)
    expect(mainLog).toHaveBeenCalledWith('BrowserPanelMcp', 'already registered with correct config');
  });

  /**
   * Scenario: Config corruption → graceful recovery → fresh registration
   *
   * User problem: Config file is corrupt (disk error, partial write).
   * Boot should not crash; should recover and create fresh entry.
   *
   * Workflow: ProcessConfig.get throws → catch → treat as empty → register fresh
   */
  it('corrupt config: recovers gracefully and registers fresh entry', async () => {
    // Step 1: Config read fails
    mockProcessConfig.get.mockRejectedValue(new Error('SQLITE_CORRUPT'));

    // Step 2: Registration still succeeds (does not throw)
    await ensureBrowserPanelMcpRegistered();

    // Step 3: Fresh entry created despite corruption
    expect(mockProcessConfig.set).toHaveBeenCalledOnce();
    const config = mockProcessConfig.set.mock.calls[0][1] as IMcpServer[];
    expect(config).toHaveLength(1);
    expect(config[0].name).toBe('browser-panel');
    expect(config[0].transport.command).toBe(NODE_PATH);
  });

  /**
   * Scenario: Missing runtime binaries → skip without blocking startup
   *
   * User problem: Node binary or MCP script missing (incomplete install,
   * dev mode without build). Registration must skip silently — blocking
   * startup would make the entire app unusable.
   *
   * Workflow: existsSync(script) false → warn → return (no config write)
   *          existsSync(node) false → warn → return (no config write)
   */
  it('missing script: skips registration without blocking startup', async () => {
    vi.mocked(existsSync).mockImplementation((p) => !String(p).includes('browser-panel-mcp'));

    await ensureBrowserPanelMcpRegistered();

    expect(mockProcessConfig.set).not.toHaveBeenCalled();
    expect(mainWarn).toHaveBeenCalledWith('BrowserPanelMcp', expect.stringContaining('bundled MCP script not found'));
  });

  it('missing node: skips registration without blocking startup', async () => {
    vi.mocked(existsSync).mockImplementation((p) => !String(p).includes('node'));

    await ensureBrowserPanelMcpRegistered();

    expect(mockProcessConfig.set).not.toHaveBeenCalled();
    expect(mainWarn).toHaveBeenCalledWith('BrowserPanelMcp', expect.stringContaining('bundled node not found'));
  });

  /**
   * Scenario: Write failure → logged, not thrown
   *
   * User problem: Disk full, permissions error. Must not crash the app.
   */
  it('write failure: logs error without crashing app', async () => {
    mockProcessConfig.set.mockRejectedValue(new Error('ENOSPC: disk full'));

    await ensureBrowserPanelMcpRegistered();

    expect(mainError).toHaveBeenCalledWith('BrowserPanelMcp', expect.stringContaining('ENOSPC'));
  });

  /**
   * Scenario: Coexists with other MCP servers
   *
   * User problem: User has chrome-devtools and custom MCPs installed.
   * browser-panel must append, not overwrite.
   */
  it('coexistence: appends alongside existing MCP servers', async () => {
    const existing = makeEntry({ name: 'chrome-devtools', id: 'cd_1' });
    mockProcessConfig.get.mockResolvedValue([existing]);

    await ensureBrowserPanelMcpRegistered();

    const config = mockProcessConfig.set.mock.calls[0][1] as IMcpServer[];
    expect(config).toHaveLength(2);
    expect(config[0].name).toBe('chrome-devtools');
    expect(config[1].name).toBe('browser-panel');
  });
});
