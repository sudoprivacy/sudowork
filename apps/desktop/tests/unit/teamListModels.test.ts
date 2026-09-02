import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Team, TeamMail, TeamMember, TeamTask } from '@process/services/team/TeamStore';

const h = vi.hoisted(() => {
  return {
    getInstalledAssistants: vi.fn(() => []),
    getAssistantMeta: vi.fn((): unknown => null),
    getDetectedAgents: vi.fn(() => []),
    getScodeProxyModelInfoSync: vi.fn((): unknown => null),
    responseStreamOn: vi.fn(() => vi.fn()),
    emitListChanged: vi.fn(),
    emitSessionChanged: vi.fn(),
    emitAgentStatusChanged: vi.fn(),
    emitMemberSpawned: vi.fn(),
    emitMemberRemoved: vi.fn(),
    emitMcpStatus: vi.fn(),
    emitRunAccepted: vi.fn(),
    emitRunUpdated: vi.fn(),
    emitRunStarted: vi.fn(),
    emitRunCompleted: vi.fn(),
    emitRunCancelled: vi.fn(),
    emitRunFailed: vi.fn(),
    emitChildTurnStarted: vi.fn(),
    emitChildTurnCompleted: vi.fn(),
    emitChildTurnCancelled: vi.fn(),
    createConversation: vi.fn(() => Promise.resolve({ success: true, conversation: null })),
    buildConversation: vi.fn(() => ({ kill: vi.fn().mockResolvedValue(undefined) })),
    notifyWake: vi.fn(),
  };
});

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '', getPath: () => '' } }));
vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: { responseStream: { on: h.responseStreamOn } },
    team: {
      onListChanged: { emit: h.emitListChanged },
      onSessionChanged: { emit: h.emitSessionChanged },
      onAgentStatusChanged: { emit: h.emitAgentStatusChanged },
      onMemberSpawned: { emit: h.emitMemberSpawned },
      onMemberRemoved: { emit: h.emitMemberRemoved },
      onMcpStatus: { emit: h.emitMcpStatus },
      onRunAccepted: { emit: h.emitRunAccepted },
      onRunUpdated: { emit: h.emitRunUpdated },
      onRunStarted: { emit: h.emitRunStarted },
      onRunCompleted: { emit: h.emitRunCompleted },
      onRunCancelled: { emit: h.emitRunCancelled },
      onRunFailed: { emit: h.emitRunFailed },
      onChildTurnStarted: { emit: h.emitChildTurnStarted },
      onChildTurnCompleted: { emit: h.emitChildTurnCompleted },
      onChildTurnCancelled: { emit: h.emitChildTurnCancelled },
    },
  },
}));
vi.mock('@process/database', () => ({
  getDatabase: () => ({
    getConversation: () => ({ success: false, data: null }),
    updateConversation: () => ({ success: false, error: 'not found' }),
  }),
}));
vi.mock('@process/WorkerManage', () => ({ default: { buildConversation: h.buildConversation } }));
vi.mock('@/process/AssistantManager', () => ({
  assistantManager: { getAssistantMeta: h.getAssistantMeta, getInstalledAssistants: h.getInstalledAssistants },
}));
vi.mock('@/agent/acp/AcpDetector', () => ({ acpDetector: { getDetectedAgents: h.getDetectedAgents } }));
vi.mock('@process/services/scode/scodeProxyModels', () => ({ getScodeProxyModelInfoSync: h.getScodeProxyModelInfoSync }));
vi.mock('@process/services/claudeCli/NodeRuntimeService', () => ({ getNodeBinaryPath: () => 'node' }));
vi.mock('@process/utils/assistantResources', () => ({ readAssistantResource: vi.fn(), ruleFilePattern: /.*/ }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/i18n', () => ({ default: { t: (key: string) => key }, i18nReady: Promise.resolve() }));
vi.mock('@process/services/conversationService', () => ({ createConversation: (...args: unknown[]) => h.createConversation(...args) }));
vi.mock('@process/services/conversationReaper', () => ({
  reapConversation: vi.fn(),
  resolveWorkspaceDeletion: vi.fn(() => false),
  isSafeAutoWorkspacePath: vi.fn(() => false),
}));
vi.mock('@process/services/team/EventLoop', () => ({
  EventLoop: vi.fn(function EventLoop() {
    return { start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined), notifyWake: h.notifyWake };
  }),
}));
vi.mock('@process/services/team/TeamStore', () => ({
  teamStore: {
    insertTeam: (team: Team) => team,
    updateTeam: vi.fn(),
    getTeam: () => null,
    listMembersByTeam: (): TeamMember[] => [],
    insertMember: vi.fn(),
    updateMember: vi.fn(),
    markMemberDelegated: vi.fn(),
    getMember: () => null,
    insertMail: (mail: TeamMail) => mail,
    peekUnread: () => [],
    markReadBatch: vi.fn(),
    hasUnread: () => false,
    getLatestUserMail: () => null,
    softDeleteMember: vi.fn(),
    hardDeleteMailboxByMember: vi.fn(),
    softDeleteMembersByTeam: vi.fn(),
    softDeleteTeam: vi.fn(),
    hardDeleteMailboxByTeam: vi.fn(),
    hardDeleteTasksByTeam: vi.fn(),
    insertTask: (task: TeamTask) => task,
    getTask: () => null,
    updateTask: vi.fn(),
    listTasksByTeam: () => [],
  },
}));

const SCODE_MODEL_INFO = {
  source: 'models',
  currentModelId: 'auto',
  currentModelLabel: 'Auto',
  availableModels: [
    { id: 'auto', label: 'Auto' },
    { id: 'glm-5.2', label: 'GLM 5.2' },
  ],
  canSwitch: true,
};

async function importService() {
  const mod = await import('@process/services/team/TeamService');
  const service = mod.teamService as unknown as {
    init: () => Promise<void>;
    toolListModels: (args: Record<string, unknown>) => Promise<{ ok: boolean; data?: any; error?: string }>;
    startTeamHttpServer: () => Promise<{ server: { close: (cb?: () => void) => void }; port: number; token: string }>;
  };
  service.startTeamHttpServer = vi.fn().mockResolvedValue({ server: { close: (cb?: () => void) => cb?.() }, port: 12345, token: 'token' });
  await service.init();
  return service;
}

beforeEach(() => {
  h.getInstalledAssistants.mockReset().mockReturnValue([]);
  h.getAssistantMeta.mockReset().mockReturnValue(null);
  h.getDetectedAgents.mockReset().mockReturnValue([]);
  h.getScodeProxyModelInfoSync.mockReset().mockReturnValue(SCODE_MODEL_INFO);
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('toolListModels data source (scode SSOT / claude semantics / legacy fallback)', () => {
  it('scode preset assistant with meta hit but no modelConfigs returns SSOT models + default_model', async () => {
    h.getInstalledAssistants.mockReturnValue([{ isBuiltin: false, isHubInstalled: false, enabled: true, name: 'seo', meta: { id: 'seo-assistant', nameI18n: { 'zh-CN': 'SEO' }, presetAgentType: 'scode' } }] as never);
    h.getAssistantMeta.mockReturnValue({ presetAgentType: 'scode' });
    const service = await importService();

    const result = await service.toolListModels({ assistant_id: 'seo-assistant' });

    expect(result).toEqual({ ok: true, data: { assistant_id: 'seo-assistant', models: ['auto', 'glm-5.2'], default_model: 'auto' } });
  });

  it('scode preset assistant with meta miss (id differs from directory name) still returns SSOT models', async () => {
    h.getInstalledAssistants.mockReturnValue([{ isBuiltin: false, isHubInstalled: true, enabled: true, name: 'sales', meta: { id: '90ea1b17', nameI18n: { 'zh-CN': 'Sales' }, presetAgentType: 'scode' } }] as never);
    h.getAssistantMeta.mockReturnValue(null);
    const service = await importService();

    const result = await service.toolListModels({ assistant_id: '90ea1b17' });

    expect(result).toEqual({ ok: true, data: { assistant_id: '90ea1b17', models: ['auto', 'glm-5.2'], default_model: 'auto' } });
  });

  it("bare 'scode' agent entry returns SSOT models instead of unknown assistant", async () => {
    h.getDetectedAgents.mockReturnValue([{ backend: 'scode', name: 'Sudo Code', presetAgentType: 'scode' }] as never);
    h.getAssistantMeta.mockReturnValue(null);
    const service = await importService();

    const result = await service.toolListModels({ assistant_id: 'scode' });

    expect(result).toEqual({ ok: true, data: { assistant_id: 'scode', models: ['auto', 'glm-5.2'], default_model: 'auto' } });
  });

  it("bare 'claude' agent entry returns ok empty list with null default instead of unknown assistant", async () => {
    h.getDetectedAgents.mockReturnValue([{ backend: 'claude', name: 'Claude Code', presetAgentType: 'claude' }] as never);
    h.getAssistantMeta.mockReturnValue(null);
    const service = await importService();

    const result = await service.toolListModels({ assistant_id: 'claude' });

    expect(result).toEqual({ ok: true, data: { assistant_id: 'claude', models: [], default_model: null } });
  });

  it('claude preset assistant with meta miss returns ok empty list with null default', async () => {
    h.getInstalledAssistants.mockReturnValue([{ isBuiltin: false, isHubInstalled: false, enabled: true, name: 'writer', meta: { id: 'claude-assistant', nameI18n: { 'zh-CN': 'Writer' }, presetAgentType: 'claude' } }] as never);
    h.getAssistantMeta.mockReturnValue(null);
    const service = await importService();

    const result = await service.toolListModels({ assistant_id: 'claude-assistant' });

    expect(result).toEqual({ ok: true, data: { assistant_id: 'claude-assistant', models: [], default_model: null } });
  });

  it('meta with modelConfigs returns its keys first (legacy behavior preserved)', async () => {
    h.getAssistantMeta.mockReturnValue({ presetAgentType: 'scode', modelConfigs: { m1: {}, m2: {} } });
    const service = await importService();

    const result = await service.toolListModels({ assistant_id: 'configured-assistant' });

    expect(result).toEqual({ ok: true, data: { assistant_id: 'configured-assistant', models: ['m1', 'm2'] } });
  });

  it('candidate hit on a non-scode/claude backend with meta miss keeps legacy unknown assistant error', async () => {
    h.getDetectedAgents.mockReturnValue([{ backend: 'codex', name: 'Codex' }] as never);
    h.getAssistantMeta.mockReturnValue(null);
    const service = await importService();

    const result = await service.toolListModels({ assistant_id: 'codex' });

    expect(result).toEqual({ ok: false, error: 'unknown assistant: codex' });
  });

  it('invalid id (no candidate, no meta) keeps legacy unknown assistant error', async () => {
    const service = await importService();

    const result = await service.toolListModels({ assistant_id: 'no-such-id' });

    expect(result).toEqual({ ok: false, error: 'unknown assistant: no-such-id' });
  });

  it('scode SSOT unavailable degrades to ok empty list with null default', async () => {
    h.getDetectedAgents.mockReturnValue([{ backend: 'scode', name: 'Sudo Code', presetAgentType: 'scode' }] as never);
    h.getAssistantMeta.mockReturnValue(null);
    h.getScodeProxyModelInfoSync.mockReturnValue(null);
    const service = await importService();

    const result = await service.toolListModels({ assistant_id: 'scode' });

    expect(result).toEqual({ ok: true, data: { assistant_id: 'scode', models: [], default_model: null } });
  });

  it('non-string assistant_id keeps legacy ok empty result', async () => {
    const service = await importService();

    const result = await service.toolListModels({});

    expect(result).toEqual({ ok: true, data: { models: [] } });
  });
});
