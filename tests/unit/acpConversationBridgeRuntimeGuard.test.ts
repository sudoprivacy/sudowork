import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const providers = new Map<string, (params: any) => any>();
  const provider = (name: string) => ({
    provider: vi.fn((callback: (params: any) => any) => providers.set(name, callback)),
  });

  return {
    providers,
    acpConnection: vi.fn(),
    codexConnection: vi.fn(),
    ipcBridge: {
      acpConversation: {
        checkEnv: provider('checkEnv'),
        detectCliPath: provider('detectCliPath'),
        getAvailableAgents: provider('getAvailableAgents'),
        refreshCustomAgents: provider('refreshCustomAgents'),
        rescanAgents: provider('rescanAgents'),
        checkAgentHealth: provider('checkAgentHealth'),
        getMode: provider('getMode'),
        getModelInfo: provider('getModelInfo'),
        probeModelInfo: provider('probeModelInfo'),
        setModel: provider('setModel'),
        setMode: provider('setMode'),
        getConfigOptions: provider('getConfigOptions'),
        setConfigOption: provider('setConfigOption'),
        answerQuestion: provider('answerQuestion'),
      },
    },
  };
});

vi.mock('@/common', () => ({ ipcBridge: h.ipcBridge }));
vi.mock('@/agent/acp/AcpDetector', () => ({
  acpDetector: {
    getDetectedAgents: vi.fn(() => []),
    refreshCustomAgents: vi.fn(),
    rescanCliAgents: vi.fn(),
  },
}));
vi.mock('@/agent/acp/AcpConnection', () => ({
  AcpConnection: vi.fn(function AcpConnection() {
    h.acpConnection();
    return {};
  }),
}));
vi.mock('@/agent/acp/modelInfo', () => ({
  buildAcpModelInfo: vi.fn(),
  summarizeAcpModelInfo: vi.fn(),
}));
vi.mock('@/agent/codex/connection/CodexConnection', () => ({
  CodexConnection: vi.fn(function CodexConnection() {
    h.codexConnection();
    return {};
  }),
}));
vi.mock('@process/database', () => ({
  getDatabase: () => ({ getConversation: vi.fn(() => ({ success: false, data: null })) }),
}));
vi.mock('@process/services/scode/scodeProxyModels', () => ({ getScodeProxyModelInfoSync: vi.fn() }));
vi.mock('@process/services/team/TeamService', () => ({ teamService: {} }));
vi.mock('@/process/WorkerManage', () => ({ default: { getTaskById: vi.fn() } }));
vi.mock('@/process/task/AcpAgent', () => ({ default: class AcpAgent {} }));
vi.mock('@/process/task/RemoteAgent', () => ({ default: class RemoteAgent {} }));
vi.mock('@/process/services/mcpServices/McpService', () => ({
  mcpService: { getSupportedTransportsForAgent: vi.fn(() => []) },
}));
vi.mock('@/process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn() }));
vi.mock('@/common/enterpriseDebugConfig', () => ({
  isEnterpriseMode: vi.fn(() => false),
  getCachedSessionMode: vi.fn(() => 'local'),
}));
vi.mock('@/process/providers', () => ({ getConversationProvider: vi.fn() }));
vi.mock('@/process/providers/RemoteConversationProvider', () => ({ default: class RemoteConversationProvider {} }));

describe('ACP conversation bridge runtime backend guard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    h.providers.clear();
    const { initAcpConversationBridge } = await import('@process/bridge/acpConversationBridge');
    initAcpConversationBridge();
  });

  it('rejects Codex health checks before constructing a connection', async () => {
    const onCheckAgentHealth = h.providers.get('checkAgentHealth');

    await expect(onCheckAgentHealth?.({ backend: 'codex' })).resolves.toEqual({
      success: false,
      msg: 'ACP backend codex is disabled',
      data: { available: false, error: 'Backend disabled' },
    });

    expect(h.codexConnection).not.toHaveBeenCalled();
    expect(h.acpConnection).not.toHaveBeenCalled();
  });

  it('rejects Codex model probes before constructing a connection', async () => {
    const onProbeModelInfo = h.providers.get('probeModelInfo');

    await expect(onProbeModelInfo?.({ backend: 'codex' })).resolves.toEqual({
      success: false,
      msg: 'ACP backend codex is disabled',
    });

    expect(h.codexConnection).not.toHaveBeenCalled();
    expect(h.acpConnection).not.toHaveBeenCalled();
  });
});
