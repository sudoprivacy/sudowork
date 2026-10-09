import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CronJob } from '@process/services/cron/CronStore';
import { frequencyToSchedule } from '@renderer/pages/cron/utils';

const mocks = vi.hoisted(() => ({ jobs: new Map<string, CronJob>(), timer: vi.fn(), updated: vi.fn() }));
vi.mock('electron', () => ({ app: {}, powerSaveBlocker: { start: vi.fn(), stop: vi.fn() } }));
vi.mock('croner', () => ({
  Cron: class {
    constructor(...args: unknown[]) {
      mocks.timer(...args);
    }
    nextRun() {
      return new Date('2026-10-10T01:00:00Z');
    }
    stop() {}
  },
}));
vi.mock('@/common', () => ({ ipcBridge: { cron: { onJobUpdated: { emit: mocks.updated } } } }));
vi.mock('@process/database', () => ({ getDatabase: () => ({ updateConversation: vi.fn() }) }));
vi.mock('@process/initStorage', () => ({ ProcessConfig: { getSync: vi.fn() } }));
vi.mock('@process/message', () => ({ addMessage: vi.fn() }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/utils/assistantResources', () => ({ readAssistantResource: vi.fn(), ruleFilePattern: '', skillFilePattern: '' }));
vi.mock('@/agent/acp/AcpDetector', () => ({ acpDetector: {} }));
vi.mock('@/process/AssistantManager', () => ({ assistantManager: {} }));
vi.mock('@/channels/agent/ChannelResponseRouter', () => ({ setupChannelResponseRouting: vi.fn() }));
vi.mock('@process/WorkerManage', () => ({ default: {} }));
vi.mock('@process/utils', () => ({ copyFilesToDirectory: vi.fn() }));
vi.mock('@process/services/conversationService', () => ({ createConversation: vi.fn() }));
vi.mock('@process/services/cron/CronBusyGuard', () => ({ cronBusyGuard: {} }));
vi.mock('@process/services/cron/cronPolicy', () => ({ assertClientCronEnabled: vi.fn(), getClientCronEnabled: vi.fn() }));
vi.mock('@process/services/cron/CronStore', () => ({
  cronStore: {
    insert: (job: CronJob) => mocks.jobs.set(job.id, structuredClone(job)),
    getById: (id: string) => mocks.jobs.get(id),
    listEnabled: () => [...mocks.jobs.values()].filter((job) => job.enabled),
    update: (id: string, updates: Partial<CronJob>) => mocks.jobs.set(id, { ...mocks.jobs.get(id)!, ...updates }),
  },
}));
import { cronService } from '@process/services/cron/CronService';
const create = (schedule = frequencyToSchedule('manual')) => cronService.addJob({ name: 'QA', message: 'Return OK', schedule, conversationId: '', agentType: 'scode', createdBy: 'user' });

beforeEach(() => {
  mocks.jobs.clear();
  vi.clearAllMocks();
});
afterEach(() => cronService.cleanup());
describe('local manual scheduling', () => {
  it('does not arm a timer when a manual job is created or resumed', async () => {
    const job = await create();
    expect(job.enabled).toBe(false);
    expect(job.state.nextRunAtMs).toBeUndefined();
    const updated = await cronService.updateJob(job.id, { enabled: true });
    expect(updated.enabled).toBe(false);
    expect(updated.state.nextRunAtMs).toBeUndefined();
    expect(mocks.timer).not.toHaveBeenCalled();
  });
  it('clears next-run state when a daily job is converted to manual', async () => {
    const job = await create(frequencyToSchedule('daily'));
    expect(job.state.nextRunAtMs).toBeDefined();
    const updated = await cronService.updateJob(job.id, { schedule: frequencyToSchedule('manual') });
    expect(updated.enabled).toBe(false);
    expect(updated.state.nextRunAtMs).toBeUndefined();
  });
  it('does not start disabled recurring jobs', async () => {
    await cronService.addJob({ name: 'QA', message: 'OK', schedule: frequencyToSchedule('daily'), enabled: false, conversationId: '', agentType: 'scode', createdBy: 'user' });
    expect(mocks.timer).not.toHaveBeenCalled();
  });
});
