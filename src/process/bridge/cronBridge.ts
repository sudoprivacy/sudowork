/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { cronService } from '@process/services/cron/CronService';
import { mainError } from '@process/utils/mainLogger';

/**
 * The @office-ai/platform bridge does not forward provider rejections to the
 * renderer — if a provider throws, `invoke()` hangs forever. So we catch here
 * and return a serializable error envelope. Callers check `.error` on the
 * response; a thrown Error is converted to `{ error: message }` and surfaced
 * back through the Promise so the UI can show a toast instead of hanging.
 */
async function safeAddJob(params: Parameters<typeof cronService.addJob>[0]) {
  try {
    const job = await cronService.addJob(params);
    ipcBridge.cron.onJobCreated.emit(job);
    return job;
  } catch (err) {
    mainError('CronBridge', 'addJob failed:', err);
    // Throwing here would hang the renderer — return an error envelope.
    // The renderer unwraps this and shows a toast.
    return { __error: err instanceof Error ? err.message : String(err) } as never;
  }
}

async function safeUpdateJob({ jobId, updates }: { jobId: string; updates: Parameters<typeof cronService.updateJob>[1] }) {
  try {
    const job = await cronService.updateJob(jobId, updates);
    ipcBridge.cron.onJobUpdated.emit(job);
    return job;
  } catch (err) {
    mainError('CronBridge', 'updateJob failed:', err);
    return { __error: err instanceof Error ? err.message : String(err) } as never;
  }
}

/**
 * Initialize cron IPC bridge handlers
 */
export function initCronBridge(): void {
  // Query handlers
  ipcBridge.cron.listJobs.provider(async () => {
    return cronService.listJobs();
  });

  ipcBridge.cron.listJobsByConversation.provider(async ({ conversationId }) => {
    return cronService.listJobsByConversation(conversationId);
  });

  ipcBridge.cron.getJob.provider(async ({ jobId }) => {
    return cronService.getJob(jobId);
  });

  // CRUD handlers — wrapped so renderer errors surface as rejections, not hangs.
  ipcBridge.cron.addJob.provider(safeAddJob);
  ipcBridge.cron.updateJob.provider(safeUpdateJob);

  ipcBridge.cron.removeJob.provider(async ({ jobId }) => {
    try {
      await cronService.removeJob(jobId);
      ipcBridge.cron.onJobRemoved.emit({ jobId });
    } catch (err) {
      mainError('CronBridge', 'removeJob failed:', err);
    }
  });

  ipcBridge.cron.triggerJob.provider(async ({ jobId }) => {
    try {
      await cronService.triggerJob(jobId);
    } catch (err) {
      mainError('CronBridge', 'triggerJob failed:', err);
    }
  });

  // Power management handlers
  ipcBridge.cron.getPowerSaveActive.provider(async () => {
    return cronService.getPowerSaveActive();
  });

  ipcBridge.cron.setPowerSave.provider(async ({ enabled }) => {
    cronService.setPowerSave(enabled);
  });
}
