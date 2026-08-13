import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CronJob } from '@process/services/cron/CronStore';

const h = vi.hoisted(() => {
  const jobs = new Map<string, CronJob>();
  return {
    jobs,
    insert: vi.fn((job: CronJob) => jobs.set(job.id, job)),
    update: vi.fn((jobId: string, updates: Partial<CronJob>) => {
      const job = jobs.get(jobId);
      if (!job) return;
      jobs.set(jobId, {
        ...job,
        ...updates,
        metadata: updates.metadata ? { ...job.metadata, ...updates.metadata } : job.metadata,
        state: updates.state ? { ...job.state, ...updates.state } : job.state,
      });
    }),
    createConversation: vi.fn(),
    buildTask: vi.fn(),
    emitJobUpdated: vi.fn(),
  };
});

vi.mock('electron', () => ({
  app: { getLocale: () => 'en-US' },
  powerSaveBlocker: { start: vi.fn(() => 1), stop: vi.fn(), isStarted: vi.fn(() => false) },
}));
vi.mock('croner', () => ({
  Cron: class MockCron {
    nextRun() {
      return new Date(Date.now() + 60_000);
    }

    stop() {}
  },
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    cron: {
      onJobUpdated: { emit: h.emitJobUpdated },
      onJobCreated: { emit: vi.fn() },
      onJobRemoved: { emit: vi.fn() },
    },
  },
}));
vi.mock('@/common/utils', () => ({ uuid: vi.fn(() => 'uuid-1') }));
vi.mock('@process/database', () => ({
  getDatabase: () => ({
    updateConversation: vi.fn(),
    getConversation: vi.fn(() => ({ success: false, data: null })),
  }),
}));
vi.mock('@process/message', () => ({ addMessage: vi.fn() }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/utils/assistantResources', () => ({ readAssistantResource: vi.fn(), ruleFilePattern: /.*/ }));
vi.mock('@/agent/acp/AcpDetector', () => ({ acpDetector: { getDetectedAgents: vi.fn(() => []) } }));
vi.mock('@/process/AssistantManager', () => ({ assistantManager: { getAssistantMeta: vi.fn(() => null) } }));
vi.mock('@/channels/agent/ChannelResponseRouter', () => ({ setupChannelResponseRouting: vi.fn() }));
vi.mock('@process/utils', () => ({ copyFilesToDirectory: vi.fn(async () => []) }));
vi.mock('@process/WorkerManage', () => ({
  default: {
    getTaskById: vi.fn(),
    getTaskByIdRollbackBuild: h.buildTask,
    kill: vi.fn(),
  },
}));
vi.mock('@process/services/conversationService', () => ({ createConversation: h.createConversation }));
vi.mock('@process/services/cron/CronBusyGuard', () => ({ cronBusyGuard: { isProcessing: vi.fn(() => false) } }));
vi.mock('@process/services/cron/CronStore', () => ({
  cronStore: {
    insert: h.insert,
    update: h.update,
    getById: (jobId: string) => h.jobs.get(jobId) ?? null,
    listEnabled: vi.fn(() => []),
    listAll: vi.fn(() => []),
    listByConversation: vi.fn(() => []),
    delete: vi.fn(),
  },
}));
vi.mock('@process/services/cron/cronPolicy', () => ({
  assertClientCronEnabled: vi.fn(async () => undefined),
  getClientCronEnabled: vi.fn(async () => true),
}));

function makeJob(agentType: 'scode' | 'codex'): CronJob {
  return {
    id: `cron-${agentType}`,
    name: 'Job',
    enabled: true,
    schedule: { kind: 'every', everyMs: 60_000, description: 'Every minute' },
    target: { payload: { kind: 'message', text: 'Run' } },
    metadata: {
      conversationId: 'conv-1',
      agentType,
      createdBy: 'user',
      createdAt: 1,
      updatedAt: 1,
      conversationMode: 'new',
    },
    state: { runCount: 0, retryCount: 0, maxRetries: 3 },
  };
}

describe('CronService runtime backend guard', () => {
  beforeEach(() => {
    vi.resetModules();
    h.jobs.clear();
    h.insert.mockClear();
    h.update.mockClear();
    h.createConversation.mockReset();
    h.buildTask.mockReset();
    h.emitJobUpdated.mockClear();
  });

  it('rejects new Codex jobs before persistence', async () => {
    const { cronService } = await import('@process/services/cron/CronService');

    await expect(
      cronService.addJob({
        name: 'Job',
        schedule: { kind: 'every', everyMs: 60_000, description: 'Every minute' },
        message: 'Run',
        conversationId: 'conv-1',
        agentType: 'codex',
        createdBy: 'user',
      })
    ).rejects.toThrow('ACP backend codex is disabled');

    expect(h.insert).not.toHaveBeenCalled();
  });

  it('rejects updates that would make a job executable with Codex', async () => {
    const job = makeJob('scode');
    h.jobs.set(job.id, job);
    const { cronService } = await import('@process/services/cron/CronService');

    await expect(
      cronService.updateJob(job.id, {
        metadata: { ...job.metadata, agentType: 'codex' },
      })
    ).rejects.toThrow('ACP backend codex is disabled');

    expect(h.update).not.toHaveBeenCalled();
  });

  it('records a persisted Codex job as failed without creating a conversation', async () => {
    const job = makeJob('codex');
    h.jobs.set(job.id, job);
    const { cronService } = await import('@process/services/cron/CronService');

    await expect(cronService.triggerJob(job.id)).rejects.toThrow('ACP backend codex is disabled');

    expect(h.createConversation).not.toHaveBeenCalled();
    expect(h.buildTask).not.toHaveBeenCalled();
    expect(h.jobs.get(job.id)?.state).toEqual(expect.objectContaining({ lastStatus: 'error', lastError: 'ACP backend codex is disabled' }));
  });
});
