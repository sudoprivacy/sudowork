/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mainLog, mainError } from '@process/utils/mainLogger';
import { getValidToken } from '@process/bridge/eeclawBridge';
import { ProcessConfig } from '@process/initStorage';

/**
 * Moss Cron Job response type
 */
export interface MossCronJob {
  id: string;
  orgId: string;
  /** Owner (creator) of the job. The list endpoint only returns jobs the caller owns or co-owns. */
  userId: string;
  /** Owner display name, resolved server-side */
  userName?: string;
  /** Co-owners have flat management parity with the owner (view/edit/delete/trigger) */
  coOwnerIds?: string[];
  coOwnerNames?: string[];
  /** Identity scheduled runs execute as; defaults to the owner */
  executorUserId?: string | null;
  executorName?: string;
  name: string;
  enabled: boolean;
  schedule: {
    kind: 'at' | 'every' | 'cron';
    value: string;
    tz?: string;
    description?: string;
  };
  payloadMessage: string;
  conversationMode: 'new' | 'reuse';
  boundSessionId: string | null;
  lastSessionId: string | null;
  assistantId: string | null;
  assistantName: string | null;
  workspace: string | null;
  runtimeJson: string | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  runCount: number;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Moss Cron Job Run response type
 */
export interface MossCronJobRun {
  id: string;
  jobId: string;
  orgId: string;
  userId: string;
  sessionId: string | null;
  status: 'queued' | 'running' | 'ok' | 'error' | 'skipped' | 'missed';
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  summary: string | null;
  createdAt: number;
}

/**
 * Moss Server Cron API client
 *
 * 企业模式下定时任务管理通过 Moss Server API 实现
 */
export class MossCronApi {
  private serverUrl: string;
  private accessToken: string | null = null;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  /**
   * Set access token directly (JWT from eeclaw auth storage)
   */
  setAccessToken(accessToken: string): void {
    this.accessToken = accessToken;
  }

  /**
   * Ensure access token is valid, refreshing if necessary
   */
  async ensureAuthenticated(): Promise<string> {
    if (this.accessToken) {
      const authStorage = ProcessConfig.getSync('eeclaw.authStorage');
      if (authStorage?.expires_at && authStorage.expires_at > Date.now() + 5 * 60 * 1000) {
        return this.accessToken;
      }
    }

    const token = await getValidToken();
    this.accessToken = token;
    return token;
  }

  /**
   * Force refresh the access token
   */
  async forceRefreshToken(): Promise<string> {
    mainLog('MossCronApi', 'Force refreshing token due to 401');
    this.accessToken = null;
    const token = await getValidToken(true);
    this.accessToken = token;
    return token;
  }

  /**
   * Fetch with automatic 401 retry
   */
  private async fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
    const token = await this.ensureAuthenticated();
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Content-Type', 'application/json');

    let response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
      mainLog('MossCronApi', `Request to ${url} returned 401, attempting token refresh and retry`);
      try {
        const newToken = await this.forceRefreshToken();
        const retryHeaders = new Headers(options.headers);
        retryHeaders.set('Authorization', `Bearer ${newToken}`);
        retryHeaders.set('Content-Type', 'application/json');
        response = await fetch(url, { ...options, headers: retryHeaders });
      } catch (refreshError) {
        mainError('MossCronApi', 'Token refresh on 401 failed:', refreshError);
      }
    }

    return response;
  }

  /**
   * List all cron jobs
   * GET /api/v1/cron/jobs
   */
  async listJobs(): Promise<MossCronJob[]> {
    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/cron/jobs`, {
      method: 'GET',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to list cron jobs: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { success: boolean; data?: MossCronJob[]; message?: string };
    if (!data.success) {
      throw new Error(data.message || 'Failed to list cron jobs');
    }
    return data.data || [];
  }

  /**
   * Get a single cron job
   * GET /api/v1/cron/jobs/:id
   */
  async getJob(jobId: string): Promise<MossCronJob> {
    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/cron/jobs/${jobId}`, {
      method: 'GET',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get cron job: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { success: boolean; data?: MossCronJob; message?: string };
    if (!data.success) {
      throw new Error(data.message || 'Failed to get cron job');
    }
    return data.data!;
  }

  /**
   * Create a new cron job
   * POST /api/v1/cron/jobs
   */
  async createJob(params: {
    name: string;
    schedule: {
      kind: 'at' | 'every' | 'cron';
      value: string;
      tz?: string;
      description?: string;
    };
    payloadMessage: string;
    conversationMode: 'new' | 'reuse';
    boundSessionId?: string;
    assistantId?: string;
    assistantName?: string;
    workspace?: string;
    runtimeJson?: string;
    maxRetries?: number;
  }): Promise<MossCronJob> {
    mainLog('MossCronApi', `Creating cron job: ${params.name}`);

    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/cron/jobs`, {
      method: 'POST',
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to create cron job: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { success: boolean; data?: MossCronJob; message?: string };
    if (!data.success) {
      throw new Error(data.message || 'Failed to create cron job');
    }
    mainLog('MossCronApi', `Cron job created: ${data.data!.id}`);
    return data.data!;
  }

  /**
   * Update a cron job
   * PATCH /api/v1/cron/jobs/:id
   */
  async updateJob(
    jobId: string,
    updates: Partial<{
      name: string;
      enabled: boolean;
      schedule: {
        kind: 'at' | 'every' | 'cron';
        value: string;
        tz?: string;
        description?: string;
      };
      payloadMessage: string;
      conversationMode: 'new' | 'reuse';
      boundSessionId: string | null;
      assistantId: string;
      assistantName: string;
      workspace: string;
      runtimeJson: string;
      maxRetries: number;
    }>
  ): Promise<MossCronJob> {
    mainLog('MossCronApi', `Updating cron job: ${jobId}`);

    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/cron/jobs/${jobId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to update cron job: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { success: boolean; data?: MossCronJob; message?: string };
    if (!data.success) {
      throw new Error(data.message || 'Failed to update cron job');
    }
    return data.data!;
  }

  /**
   * Delete a cron job (soft delete)
   * DELETE /api/v1/cron/jobs/:id
   */
  async deleteJob(jobId: string): Promise<void> {
    mainLog('MossCronApi', `Deleting cron job: ${jobId}`);

    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/cron/jobs/${jobId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to delete cron job: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { success: boolean; message?: string };
    if (!data.success) {
      throw new Error(data.message || 'Failed to delete cron job');
    }
  }

  /**
   * Trigger a job immediately
   * POST /api/v1/cron/jobs/:id/trigger
   */
  async triggerJob(jobId: string): Promise<MossCronJobRun> {
    mainLog('MossCronApi', `Triggering cron job: ${jobId}`);

    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/cron/jobs/${jobId}/trigger`, {
      method: 'POST',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to trigger cron job: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { success: boolean; data?: MossCronJobRun; message?: string };
    if (!data.success) {
      throw new Error(data.message || 'Failed to trigger cron job');
    }
    return data.data!;
  }

  /**
   * List runs for a job
   * GET /api/v1/cron/jobs/:id/runs
   */
  async listRuns(jobId: string, limit?: number): Promise<MossCronJobRun[]> {
    const url = `${this.serverUrl}/api/v1/cron/jobs/${jobId}/runs${limit ? `?limit=${limit}` : ''}`;
    const response = await this.fetchWithRetry(url, {
      method: 'GET',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to list cron runs: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { success: boolean; data?: MossCronJobRun[]; message?: string };
    if (!data.success) {
      throw new Error(data.message || 'Failed to list cron runs');
    }
    return data.data || [];
  }
}
