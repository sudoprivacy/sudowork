/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cronService } from '@process/services/cron/CronService';
import type { CronJob } from '@process/services/cron/CronStore';
import type { CreateCronJobParams } from '@process/services/cron/CronService';
import type { ICronProvider } from './types';

/**
 * Local Cron Provider
 * 本地定时任务 Provider
 *
 * Wraps the existing local CronService.
 * 包装现有本地 CronService。
 */
export class LocalCronProvider implements ICronProvider {
  readonly type = 'local' as const;

  async listJobs(): Promise<CronJob[]> {
    return cronService.listJobs();
  }

  async listJobsByConversation(conversationId: string): Promise<CronJob[]> {
    return cronService.listJobsByConversation(conversationId);
  }

  async listJobsByDigitalEmployee(employeeId: string): Promise<CronJob[]> {
    return cronService.listJobsByDigitalEmployee(employeeId);
  }

  async getJob(jobId: string): Promise<CronJob | null> {
    return cronService.getJob(jobId);
  }

  async addJob(params: CreateCronJobParams): Promise<CronJob> {
    return cronService.addJob(params);
  }

  async updateJob(jobId: string, updates: Partial<CronJob>): Promise<CronJob> {
    return cronService.updateJob(jobId, updates);
  }

  async removeJob(jobId: string): Promise<void> {
    return cronService.removeJob(jobId);
  }

  async triggerJob(jobId: string): Promise<void> {
    return cronService.triggerJob(jobId);
  }

  async getPowerSaveActive(): Promise<boolean> {
    return cronService.getPowerSaveActive();
  }

  async setPowerSave(enabled: boolean): Promise<void> {
    cronService.setPowerSave(enabled);
  }
}
