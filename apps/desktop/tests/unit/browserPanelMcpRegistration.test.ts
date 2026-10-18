import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMcpServer } from '@sudowork/common/storage';

const config = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
const log = vi.hoisted(() => ({ mainLog: vi.fn(), mainError: vi.fn() }));
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/mock/app' } }));
vi.mock('@process/initStorage', () => ({ ProcessConfig: config }));
vi.mock('@process/utils/mainLogger', () => log);
import { ensureBrowserPanelMcpRegistered } from '@process/services/mcpServices/SudoworkBuiltinMcpRegistration';

function legacy(overrides: Partial<IMcpServer> = {}): IMcpServer {
  return { id: 'mcp_builtin_browser-panel_1000', name: 'browser-panel', description: '', enabled: true, transport: { type: 'stdio', command: '/old/node', args: ['/old/resources/browser-panel-mcp/index.js'] }, createdAt: 1000, updatedAt: 1000, originalJson: '', ...overrides };
}

describe('shared browser MCP migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.get.mockResolvedValue([]);
    config.set.mockResolvedValue(undefined);
  });

  it('starts without creating a global browser process configuration', async () => {
    await ensureBrowserPanelMcpRegistered();
    expect(config.set).not.toHaveBeenCalled();
  });

  it.each([true, false])('retires the owned webview entry and preserves other servers (enabled=%s)', async (enabled) => {
    const custom = legacy({ id: 'user-authored', name: 'my-browser' });
    config.get.mockResolvedValue([legacy({ enabled }), custom]);
    await ensureBrowserPanelMcpRegistered();
    expect(config.set).toHaveBeenCalledWith('mcp.config', [custom]);
  });

  it('preserves a user-authored server with the same name and customized owned transports', async () => {
    const entries = [legacy({ id: 'custom-browser' }), legacy({ transport: { type: 'stdio', command: '/custom/node', args: ['/custom/browser.js'] } })];
    config.get.mockResolvedValue(entries);
    await ensureBrowserPanelMcpRegistered();
    expect(config.set).not.toHaveBeenCalled();
  });

  it('keeps startup available and preserves configuration when storage is unavailable', async () => {
    config.get.mockRejectedValue(new Error('Storage unavailable'));
    await expect(ensureBrowserPanelMcpRegistered()).resolves.toBeUndefined();
    expect(config.set).not.toHaveBeenCalled();
    expect(log.mainError).toHaveBeenCalled();
  });

  it('reports a failed migration without claiming it succeeded', async () => {
    config.get.mockResolvedValue([legacy()]);
    config.set.mockRejectedValue(new Error('Storage write failed'));
    await ensureBrowserPanelMcpRegistered();
    expect(log.mainError).toHaveBeenCalled();
    expect(log.mainLog).not.toHaveBeenCalled();
  });
});
