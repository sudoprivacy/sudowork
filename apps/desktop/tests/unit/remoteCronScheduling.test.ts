import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MossCronJob } from '@process/remote/MossCronApi';
import type { CreateCronJobParams } from '@process/services/cron/CronService';
import { frequencyToSchedule } from '@renderer/pages/cron/utils';

const api = vi.hoisted(() => ({ createJob: vi.fn(), getJob: vi.fn(), updateJob: vi.fn() }));
vi.mock('@process/remote/MossCronApi', () => ({
  MossCronApi: class {
    constructor() {
      return api;
    }
  },
}));
vi.mock('@/common/enterpriseDebugConfig', () => ({ getEnterpriseConfig: () => ({ mossServerUrl: 'https://moss.test' }) }));
vi.mock('@process/database', () => ({ getDatabase: () => ({ getConversation: () => ({ success: false }), getUserConversations: () => ({ data: [] }) }) }));
vi.mock('@process/providers', () => ({ getConversationProvider: vi.fn() }));
vi.mock('@process/WorkerManage', () => ({ default: {} }));
vi.mock('@process/utils/mainLogger', () => ({ mainError: vi.fn(), mainLog: vi.fn() }));
import { RemoteCronProvider } from '@process/providers/cron/RemoteCronProvider';

const params = (): CreateCronJobParams => ({ name: 'QA', message: 'Return OK', schedule: frequencyToSchedule('daily'), conversationId: '', agentType: 'scode', createdBy: 'user' });
let job: MossCronJob;
beforeEach(() => {
  vi.clearAllMocks();
  job = { id: 'job', enabled: true, name: 'QA', schedule: { kind: 'cron', value: '0 9 * * *' }, conversationMode: 'new', boundSessionId: null, lastSessionId: null, assistantId: null, payloadMessage: 'Return OK', runCount: 0, retryCount: 0, maxRetries: 3 } as MossCronJob;
  api.createJob.mockImplementation(async (body) => ({ ...job, ...body }));
  api.getJob.mockImplementation(async () => job);
  api.updateJob.mockImplementation(async (_id, body) => ({ ...job, ...body }));
});

describe('remote cron scheduling', () => {
  it('leaves the default assistant to Moss instead of sending a local backend ID', async () => {
    await new RemoteCronProvider().addJob(params());
    expect(api.createJob).toHaveBeenCalledWith(expect.objectContaining({ assistantId: undefined, assistantName: undefined }));
  });
  it('creates manual jobs disabled in the initial request and preserves them on reload', async () => {
    const result = await new RemoteCronProvider().addJob({ ...params(), schedule: frequencyToSchedule('manual') });
    expect(api.createJob).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, schedule: expect.objectContaining({ kind: 'at', value: '1970-01-01T00:00:00.000Z' }) }));
    expect(result.schedule).toMatchObject({ kind: 'at', atMs: 0 });
    expect(result.enabled).toBe(false);
    expect(result.state.nextRunAtMs).toBeUndefined();
  });
  it('does not enable automatic scheduling when a manual job is resumed', async () => {
    job.schedule = { kind: 'at', value: '1970-01-01T00:00:00.000Z' };
    const result = await new RemoteCronProvider().updateJob('job', { enabled: true });
    expect(api.updateJob).toHaveBeenCalledWith('job', { enabled: false });
    expect(result.state.nextRunAtMs).toBeUndefined();
  });
  it('atomically disables a daily job converted to manual', async () => {
    await new RemoteCronProvider().updateJob('job', { schedule: frequencyToSchedule('manual') });
    expect(api.updateJob).toHaveBeenCalledWith('job', expect.objectContaining({ enabled: false, schedule: expect.objectContaining({ kind: 'at' }) }));
  });
  it('clears a selected assistant back to the cloud default', async () => {
    await new RemoteCronProvider().updateJob('job', { metadata: { conversationId: '', agentType: 'remote-agent', presetAssistantId: undefined, createdBy: 'user', createdAt: 0, updatedAt: 0 } });
    expect(api.updateJob).toHaveBeenCalledWith('job', expect.objectContaining({ assistantId: null, assistantName: null }));
  });
});
