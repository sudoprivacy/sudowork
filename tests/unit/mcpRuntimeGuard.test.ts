import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMcpServer } from '@/common/storage';

const h = vi.hoisted(() => ({
  detectCodex: vi.fn(),
  installCodex: vi.fn(),
  removeCodex: vi.fn(),
}));

function protocol(overrides: Record<string, unknown> = {}) {
  return {
    detectMcpServers: vi.fn(async () => []),
    installMcpServers: vi.fn(async () => ({ success: true })),
    removeMcpServer: vi.fn(async () => ({ success: true })),
    testMcpConnection: vi.fn(async () => ({ success: true })),
    getSupportedTransports: vi.fn(() => ['stdio']),
    ...overrides,
  };
}

vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn() }));
vi.mock('@process/services/mcpServices/agents/ScodeMcpAgent', () => ({
  ScodeMcpAgent: vi.fn(function ScodeMcpAgent() {
    return protocol();
  }),
}));
vi.mock('@process/services/mcpServices/agents/CodebuddyMcpAgent', () => ({
  CodebuddyMcpAgent: vi.fn(function CodebuddyMcpAgent() {
    return protocol();
  }),
}));
vi.mock('@process/services/mcpServices/agents/QwenMcpAgent', () => ({
  QwenMcpAgent: vi.fn(function QwenMcpAgent() {
    return protocol();
  }),
}));
vi.mock('@process/services/mcpServices/agents/IflowMcpAgent', () => ({
  IflowMcpAgent: vi.fn(function IflowMcpAgent() {
    return protocol();
  }),
}));
vi.mock('@process/services/mcpServices/agents/CodexMcpAgent', () => ({
  CodexMcpAgent: vi.fn(function CodexMcpAgent() {
    return protocol({
      detectMcpServers: h.detectCodex,
      installMcpServers: h.installCodex,
      removeMcpServer: h.removeCodex,
    });
  }),
}));

const server: IMcpServer = {
  id: 'mcp-1',
  name: 'server',
  enabled: true,
  transport: { type: 'stdio', command: 'server', args: [] },
  createdAt: 1,
  updatedAt: 1,
  originalJson: '{}',
};

describe('McpService runtime backend guard', () => {
  beforeEach(() => {
    h.detectCodex.mockReset();
    h.installCodex.mockReset();
    h.removeCodex.mockReset();
  });

  it('rejects Codex config detection before calling the Codex MCP agent', async () => {
    const { McpService } = await import('@process/services/mcpServices/McpService');
    const service = new McpService();

    await expect(service.getAgentMcpConfigs([{ backend: 'codex', name: 'Codex' }])).rejects.toThrow('ACP backend codex is disabled');
    expect(h.detectCodex).not.toHaveBeenCalled();
  });

  it('returns explicit failures for Codex sync and removal', async () => {
    const { McpService } = await import('@process/services/mcpServices/McpService');
    const service = new McpService();

    await expect(service.syncMcpToAgents([server], [{ backend: 'codex', name: 'Codex' }])).resolves.toEqual({
      success: false,
      results: [{ agent: 'Codex', success: false, error: 'ACP backend codex is disabled' }],
    });
    await expect(service.removeMcpFromAgents('server', [{ backend: 'codex', name: 'Codex' }])).resolves.toEqual({
      success: false,
      results: [{ agent: 'codex:Codex', success: false, error: 'ACP backend codex is disabled' }],
    });
    expect(h.installCodex).not.toHaveBeenCalled();
    expect(h.removeCodex).not.toHaveBeenCalled();
  });
});
