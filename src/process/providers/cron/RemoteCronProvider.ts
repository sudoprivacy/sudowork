/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { MossCronApi, type MossCronJob, type MossCronJobRun } from '@process/remote/MossCronApi';
import { getEnterpriseConfig } from '@/common/enterpriseDebugConfig';
import type { CronJob, CronSchedule } from '@process/services/cron/CronStore';
import type { CreateCronJobParams } from '@process/services/cron/CronService';
import { mainError, mainLog } from '@process/utils/mainLogger';
import type { AcpBackendAll } from '@/types/acpTypes';
import { getDatabase } from '@process/database';
import { getConversationProvider } from '@process/providers';
import type { TChatConversation } from '@/common/storage';
import WorkerManage from '@process/WorkerManage';
import type RemoteAgent from '@process/task/RemoteAgent';
import type { ICronProvider } from './types';

const MOSS_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RemoteConversationExtra = {
  mossSessionId?: string;
  mossSessionPending?: boolean;
};

function stripBuiltinAssistantPrefix(assistantId: string): string {
  return assistantId.startsWith('builtin-') ? assistantId.slice('builtin-'.length) : assistantId;
}

function resolveMossAssistantName(presetAssistantId: string | null | undefined, fallbackAgentType: AcpBackendAll): string {
  return presetAssistantId ? stripBuiltinAssistantPrefix(presetAssistantId) : fallbackAgentType;
}

function getLocalConversationIdByMossSessionId(mossSessionId: string | null | undefined): string | undefined {
  if (!mossSessionId) return undefined;

  const db = getDatabase();
  const direct = db.getConversation(mossSessionId);
  if (direct.success && direct.data) {
    return direct.data.id;
  }

  const conversations = db.getUserConversations(undefined, 0, 10000);
  return conversations.data?.find((conversation) => {
    const extra = conversation.extra as RemoteConversationExtra | undefined;
    return extra?.mossSessionId === mossSessionId;
  })?.id;
}

function getLatestLocalCronConversation(jobId: string): TChatConversation | undefined {
  const conversations = getDatabase().getUserConversations(undefined, 0, 10000);
  return conversations.data
    ?.filter((conversation) => {
      const extra = conversation.extra as { cronJobId?: string } | undefined;
      return extra?.cronJobId === jobId;
    })
    .sort((a, b) => {
      const aTime = a.createTime || 0;
      const bTime = b.createTime || 0;
      if (bTime !== aTime) return bTime - aTime;
      return b.id.localeCompare(a.id);
    })[0];
}

function formatCronRunTitle(jobName: string | undefined, timestamp: number): string {
  const name = jobName || 'Cron Session';
  const date = new Date(timestamp || Date.now());
  const runTime = date
    .toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    .replace(/\//g, '-');
  return `${name} ${runTime}`;
}

/**
 * Convert MossCronJob to local CronJob format
 */
function mossJobToLocal(mossJob: MossCronJob): CronJob {
  // Parse schedule from Moss format to local format
  let schedule: CronSchedule;
  switch (mossJob.schedule.kind) {
    case 'at':
      schedule = { kind: 'at', atMs: mossJob.nextRunAt || Date.now(), description: mossJob.schedule.description || '' };
      break;
    case 'every': {
      // Parse 'every' value (e.g., "1h", "30m", "1d")
      const value = mossJob.schedule.value;
      const match = value.match(/^(\d+)([mhd])$/);
      if (match) {
        const num = parseInt(match[1], 10);
        const unit = match[2];
        let ms = 0;
        switch (unit) {
          case 'm':
            ms = num * 60 * 1000;
            break;
          case 'h':
            ms = num * 60 * 60 * 1000;
            break;
          case 'd':
            ms = num * 24 * 60 * 60 * 1000;
            break;
        }
        schedule = { kind: 'every', everyMs: ms, description: mossJob.schedule.description || '' };
      } else {
        // Fallback: treat as hourly
        schedule = { kind: 'every', everyMs: 60 * 60 * 1000, description: mossJob.schedule.description || '' };
      }
      break;
    }
    case 'cron':
      schedule = { kind: 'cron', expr: mossJob.schedule.value, tz: mossJob.schedule.tz, description: mossJob.schedule.description || '' };
      break;
    default:
      schedule = { kind: 'cron', expr: '0 * * * *', description: 'Fallback hourly' };
  }

  const agentType: AcpBackendAll = 'remote-agent';
  const boundConversationId = getLocalConversationIdByMossSessionId(mossJob.boundSessionId) || mossJob.boundSessionId || '';
  const localLastConversationId = getLocalConversationIdByMossSessionId(mossJob.lastSessionId) || mossJob.lastSessionId || undefined;
  const latestLocalCronConversation = mossJob.conversationMode === 'new' ? getLatestLocalCronConversation(mossJob.id) : undefined;
  const lastConversationId = latestLocalCronConversation?.id || localLastConversationId;

  return {
    id: mossJob.id,
    name: mossJob.name,
    enabled: mossJob.enabled,
    schedule,
    target: {
      payload: { kind: 'message', text: mossJob.payloadMessage },
    },
    metadata: {
      conversationId: boundConversationId,
      conversationTitle: undefined,
      agentType,
      createdBy: 'user',
      createdAt: mossJob.createdAt,
      updatedAt: mossJob.updatedAt,
      conversationMode: mossJob.conversationMode,
      workspace: mossJob.workspace,
      presetAssistantId: mossJob.assistantId,
    },
    state: {
      nextRunAtMs: mossJob.nextRunAt,
      lastRunAtMs: mossJob.lastRunAt,
      lastStatus: mossJob.lastStatus as 'ok' | 'error' | 'skipped' | 'missed' | undefined,
      lastError: mossJob.lastError,
      runCount: mossJob.runCount,
      retryCount: mossJob.retryCount,
      maxRetries: mossJob.maxRetries,
      lastConversationId,
    },
  };
}

/**
 * Remote Cron Provider
 * 远程定时任务 Provider
 *
 * Uses Moss Server for cron job management.
 * 使用 Moss Server 进行定时任务管理。
 */
export class RemoteCronProvider implements ICronProvider {
  readonly type = 'remote' as const;
  private mossCronApi: MossCronApi;

  constructor() {
    const serverUrl = getEnterpriseConfig().mossServerUrl;
    this.mossCronApi = new MossCronApi(serverUrl);
  }

  async listJobs(): Promise<CronJob[]> {
    try {
      const mossJobs = await this.mossCronApi.listJobs();
      const normalizedJobs = await Promise.all(mossJobs.map((job) => this.normalizeLegacyBoundSession(job)));
      return normalizedJobs.map(mossJobToLocal);
    } catch (error) {
      mainError('RemoteCronProvider', 'Failed to list jobs:', error);
      throw error;
    }
  }

  async listJobsByConversation(conversationId: string): Promise<CronJob[]> {
    // For remote provider, we filter locally after fetching all jobs
    const jobs = await this.listJobs();
    const matchIds = this.getConversationMatchIds(conversationId);
    return jobs.filter((job) => {
      const boundConversationId = job.metadata.conversationId;
      const lastConversationId = job.state.lastConversationId;
      const matchesBoundConversation = boundConversationId !== undefined && matchIds.has(boundConversationId);
      const matchesLastConversation = lastConversationId !== undefined && matchIds.has(lastConversationId);
      return matchesBoundConversation || matchesLastConversation;
    });
  }

  async listJobsByDigitalEmployee(employeeId: string): Promise<CronJob[]> {
    const jobs = await this.listJobs();
    return jobs.filter((job) => job.metadata.digitalEmployeeId === employeeId);
  }

  async getJob(jobId: string): Promise<CronJob | null> {
    try {
      const mossJob = await this.mossCronApi.getJob(jobId);
      return mossJobToLocal(mossJob);
    } catch (error) {
      mainError('RemoteCronProvider', 'Failed to get job:', error);
      return null;
    }
  }

  async addJob(params: CreateCronJobParams): Promise<CronJob> {
    try {
      if (params.digitalEmployeeId) {
        throw new Error('Digital employee scheduled tasks are only supported by the local client scheduler');
      }

      // Convert local schedule to Moss schedule
      let mossSchedule: { kind: 'at' | 'every' | 'cron'; value: string; tz?: string; description?: string };
      switch (params.schedule.kind) {
        case 'at':
          mossSchedule = { kind: 'at', value: new Date(params.schedule.atMs).toISOString(), description: params.schedule.description };
          break;
        case 'every': {
          // Convert ms to "Nd" format for Moss
          const everyMs = params.schedule.everyMs;
          let everyValue = '';
          if (everyMs >= 24 * 60 * 60 * 1000) {
            everyValue = `${Math.floor(everyMs / (24 * 60 * 60 * 1000))}d`;
          } else if (everyMs >= 60 * 60 * 1000) {
            everyValue = `${Math.floor(everyMs / (60 * 60 * 1000))}h`;
          } else {
            everyValue = `${Math.floor(everyMs / (60 * 1000))}m`;
          }
          mossSchedule = { kind: 'every', value: everyValue, description: params.schedule.description };
          break;
        }
        case 'cron':
          mossSchedule = { kind: 'cron', value: params.schedule.expr, tz: params.schedule.tz, description: params.schedule.description };
          break;
      }

      const conversationMode = params.conversationMode || 'new';
      const mossJob = await this.mossCronApi.createJob({
        name: params.name,
        schedule: mossSchedule,
        payloadMessage: params.message,
        conversationMode,
        boundSessionId: conversationMode === 'reuse' ? this.resolveMossSessionId(params.conversationId) : undefined,
        assistantId: params.presetAssistantId ?? undefined,
        assistantName: resolveMossAssistantName(params.presetAssistantId, params.agentType),
        workspace: params.workspace,
      });

      return mossJobToLocal(mossJob);
    } catch (error) {
      mainError('RemoteCronProvider', 'Failed to add job:', error);
      throw error;
    }
  }

  async updateJob(jobId: string, updates: Partial<CronJob>): Promise<CronJob> {
    try {
      const mossUpdates: Record<string, unknown> = {};

      if (updates.name !== undefined) mossUpdates.name = updates.name;
      if (updates.enabled !== undefined) mossUpdates.enabled = updates.enabled;
      if (updates.schedule !== undefined) {
        switch (updates.schedule.kind) {
          case 'at':
            mossUpdates.schedule = { kind: 'at', value: new Date(updates.schedule.atMs).toISOString(), description: updates.schedule.description };
            break;
          case 'every': {
            const everyMs = updates.schedule.everyMs;
            let everyValue = '';
            if (everyMs >= 24 * 60 * 60 * 1000) {
              everyValue = `${Math.floor(everyMs / (24 * 60 * 60 * 1000))}d`;
            } else if (everyMs >= 60 * 60 * 1000) {
              everyValue = `${Math.floor(everyMs / (60 * 60 * 1000))}h`;
            } else {
              everyValue = `${Math.floor(everyMs / (60 * 1000))}m`;
            }
            mossUpdates.schedule = { kind: 'every', value: everyValue, description: updates.schedule.description };
            break;
          }
          case 'cron':
            mossUpdates.schedule = { kind: 'cron', value: updates.schedule.expr, tz: updates.schedule.tz, description: updates.schedule.description };
            break;
        }
      }
      if (updates.target?.payload?.text !== undefined) mossUpdates.payloadMessage = updates.target.payload.text;
      if (updates.metadata?.conversationMode !== undefined) {
        mossUpdates.conversationMode = updates.metadata.conversationMode;
        if (updates.metadata.conversationMode === 'new') {
          mossUpdates.boundSessionId = null;
        }
      }
      if (updates.metadata?.conversationId !== undefined) {
        mossUpdates.boundSessionId = updates.metadata.conversationMode === 'new' ? null : this.resolveMossSessionId(updates.metadata.conversationId);
      }
      if (updates.metadata?.workspace !== undefined) mossUpdates.workspace = updates.metadata.workspace;
      if (updates.metadata?.agentType !== undefined) {
        mossUpdates.assistantName = updates.metadata.agentType;
      }
      if (updates.metadata && Object.prototype.hasOwnProperty.call(updates.metadata, 'presetAssistantId')) {
        const presetAssistantId = updates.metadata.presetAssistantId as string | null | undefined;
        const fallbackAgentType = updates.metadata.agentType ?? 'remote-agent';
        mossUpdates.assistantId = presetAssistantId ?? null;
        mossUpdates.assistantName = resolveMossAssistantName(presetAssistantId, fallbackAgentType);
      }

      const mossJob = await this.mossCronApi.updateJob(jobId, mossUpdates);
      return mossJobToLocal(mossJob);
    } catch (error) {
      mainError('RemoteCronProvider', 'Failed to update job:', error);
      throw error;
    }
  }

  async removeJob(jobId: string): Promise<void> {
    try {
      await this.mossCronApi.deleteJob(jobId);
    } catch (error) {
      mainError('RemoteCronProvider', 'Failed to remove job:', error);
      throw error;
    }
  }

  async triggerJob(jobId: string): Promise<void> {
    try {
      const run = await this.mossCronApi.triggerJob(jobId);
      await this.syncCronSessionsToLocal();

      const sessionId = await this.resolveTriggeredSessionId(jobId, run);
      if (sessionId) {
        await this.startTriggeredRunObservation(jobId, { ...run, sessionId });
      }

      if (run.status === 'error' && run.error) {
        throw new Error(run.error);
      }
    } catch (error) {
      mainError('RemoteCronProvider', 'Failed to trigger job:', error);
      throw error;
    }
  }

  // Power management not available for remote provider
  getPowerSaveActive(): Promise<boolean> {
    return Promise.resolve(false);
  }

  setPowerSave(_enabled: boolean): Promise<void> {
    // No-op for remote provider - power management is handled by Moss Server
    return Promise.resolve();
  }

  private resolveMossSessionId(conversationId?: string | null): string | undefined {
    if (!conversationId) return undefined;
    if (MOSS_SESSION_ID_PATTERN.test(conversationId)) return conversationId;

    const result = getDatabase().getConversation(conversationId);
    if (!result.success || !result.data) {
      throw new Error(`Selected remote conversation is not available on Moss: ${conversationId}`);
    }

    const extra = result.data.extra as RemoteConversationExtra | undefined;
    if (extra?.mossSessionId && !extra.mossSessionPending) {
      return extra.mossSessionId;
    }

    throw new Error('Selected remote conversation has not been created on Moss yet. Send a message once before binding a remote cron job for reuse.');
  }

  private getConversationMatchIds(conversationId: string): Set<string> {
    const matchIds = new Set<string>([conversationId]);
    try {
      const mossSessionId = this.resolveMossSessionId(conversationId);
      if (mossSessionId) matchIds.add(mossSessionId);
    } catch {
      // Keep local fallback filtering when the remote session cannot be resolved.
    }
    return matchIds;
  }

  private async normalizeLegacyBoundSession(job: MossCronJob): Promise<MossCronJob> {
    if (job.conversationMode !== 'reuse' || !job.boundSessionId || MOSS_SESSION_ID_PATTERN.test(job.boundSessionId)) {
      return job;
    }

    try {
      const resolvedBoundSessionId = this.resolveMossSessionId(job.boundSessionId);
      if (!resolvedBoundSessionId || resolvedBoundSessionId === job.boundSessionId) return job;
      return await this.mossCronApi.updateJob(job.id, { boundSessionId: resolvedBoundSessionId });
    } catch (error) {
      mainError('RemoteCronProvider', `Failed to normalize bound session for job ${job.id}:`, error);
      return job;
    }
  }

  private async syncCronSessionsToLocal(): Promise<void> {
    try {
      const provider = getConversationProvider('remote');
      if (provider.type === 'remote') {
        await provider.listConversations(0, 10000);
      }
    } catch (error) {
      mainError('RemoteCronProvider', 'Failed to sync cron sessions after trigger:', error);
    }
  }

  private async resolveTriggeredSessionId(jobId: string, run: MossCronJobRun): Promise<string | null> {
    if (run.sessionId) return run.sessionId;

    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));

      try {
        const latestJob = await this.mossCronApi.getJob(jobId);
        if (latestJob.lastSessionId) return latestJob.lastSessionId;
      } catch (error) {
        mainLog('RemoteCronProvider', `Failed to poll cron job session for ${jobId}: ${error instanceof Error ? error.message : String(error)}`);
      }

      try {
        const runs = await this.mossCronApi.listRuns(jobId, 5);
        const latestRun = runs.find((item) => item.id === run.id) || runs[0];
        if (latestRun?.sessionId) return latestRun.sessionId;
      } catch (error) {
        mainLog('RemoteCronProvider', `Failed to poll cron run session for ${jobId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return null;
  }

  private async startTriggeredRunObservation(jobId: string, run: MossCronJobRun & { sessionId: string }): Promise<void> {
    if (!run.sessionId) return;

    const localConversation = await this.ensureTriggeredRunConversation(jobId, run.sessionId);
    if (!localConversation) {
      mainLog('RemoteCronProvider', `No local conversation found for triggered run ${run.id}`);
      return;
    }

    const task = (await WorkerManage.getTaskByIdRollbackBuild(localConversation.id)) as RemoteAgent | undefined;
    if (!task || task.type !== 'remote-agent' || typeof (task as RemoteAgent).observeExistingSession !== 'function') {
      mainLog('RemoteCronProvider', `Unable to build remote-agent task for cron run conversation ${localConversation.id}`);
      return;
    }

    const startedAt = run.startedAt ?? run.createdAt ?? Date.now();
    void (task as RemoteAgent).observeExistingSession({ startedAt }).then((result) => {
      if (!result.success) {
        mainLog('RemoteCronProvider', `observeExistingSession failed for run ${run.id}: ${result.msg ?? 'unknown error'}`);
      }
    });
  }

  private async ensureTriggeredRunConversation(jobId: string, mossSessionId: string): Promise<TChatConversation | null> {
    await this.syncCronSessionsToLocal();

    const db = getDatabase();
    const existingId = getLocalConversationIdByMossSessionId(mossSessionId);
    if (existingId) {
      const existing = db.getConversation(existingId);
      if (existing.success && existing.data) {
        return existing.data;
      }
    }

    const job = await this.mossCronApi.getJob(jobId);
    const provider = getConversationProvider('remote');
    if (provider.type !== 'remote') return null;

    await provider.listConversations(0, 10000);

    const syncedId = getLocalConversationIdByMossSessionId(mossSessionId);
    if (syncedId) {
      const synced = db.getConversation(syncedId);
      if (synced.success && synced.data) {
        return synced.data;
      }
    }

    const now = Date.now();
    const createTime = job.lastRunAt || now;
    const conversation: TChatConversation = {
      id: mossSessionId,
      name: formatCronRunTitle(job.name, createTime),
      type: 'remote-agent',
      createTime,
      modifyTime: now,
      status: 'running',
      source: 'sudowork',
      extra: {
        workspace: job.workspace ?? undefined,
        backend: 'remote-agent',
        mossServerUrl: getEnterpriseConfig().mossServerUrl,
        agentName: job.assistantName ?? undefined,
        presetAssistantId: job.assistantId ?? undefined,
        sessionMode: 'remote',
        mossSessionId,
        mossSessionPending: false,
        cronJobId: job.id,
        cronJobName: job.name,
      },
    } as TChatConversation;

    const created = db.createConversation(conversation);
    if (!created.success) {
      mainError('RemoteCronProvider', `Failed to create local conversation for cron run: ${created.error}`);
      return null;
    }

    return conversation;
  }
}
