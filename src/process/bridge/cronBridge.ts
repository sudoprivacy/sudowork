/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { getCronProvider } from '@process/providers/cron';
import { mainError, mainLog } from '@process/utils/mainLogger';

/**
 * The @office-ai/platform bridge does not forward provider rejections to the
 * renderer — if a provider throws, `invoke()` hangs forever. So we catch here
 * and return a serializable error envelope. Callers check `.error` on the
 * response; a thrown Error is converted to `{ error: message }` and surfaced
 * back through the Promise so the UI can show a toast instead of hanging.
 */

/**
 * Initialize cron IPC bridge handlers
 */
export function initCronBridge(): void {
  // Query handlers - use provider factory for routing
  ipcBridge.cron.listJobs.provider(async () => {
    try {
      const provider = getCronProvider();
      return provider.listJobs();
    } catch (err) {
      mainError('CronBridge', 'listJobs failed:', err);
      return { __error: err instanceof Error ? err.message : String(err) } as never;
    }
  });

  ipcBridge.cron.listJobsByConversation.provider(async ({ conversationId }) => {
    try {
      const provider = getCronProvider();
      return provider.listJobsByConversation(conversationId);
    } catch (err) {
      mainError('CronBridge', 'listJobsByConversation failed:', err);
      return { __error: err instanceof Error ? err.message : String(err) } as never;
    }
  });

  ipcBridge.cron.getJob.provider(async ({ jobId }) => {
    try {
      const provider = getCronProvider();
      return provider.getJob(jobId);
    } catch (err) {
      mainError('CronBridge', 'getJob failed:', err);
      return { __error: err instanceof Error ? err.message : String(err) } as never;
    }
  });

  // CRUD handlers - wrapped so renderer errors surface as rejections, not hangs
  ipcBridge.cron.addJob.provider(async (params) => {
    try {
      const provider = getCronProvider();
      mainLog('CronBridge', `Adding job via ${provider.type} provider`);
      const job = await provider.addJob(params);
      ipcBridge.cron.onJobCreated.emit(job);
      return job;
    } catch (err) {
      mainError('CronBridge', 'addJob failed:', err);
      return { __error: err instanceof Error ? err.message : String(err) } as never;
    }
  });

  ipcBridge.cron.updateJob.provider(async ({ jobId, updates }) => {
    try {
      const provider = getCronProvider();
      mainLog('CronBridge', `Updating job ${jobId} via ${provider.type} provider`);
      const job = await provider.updateJob(jobId, updates);
      ipcBridge.cron.onJobUpdated.emit(job);
      return job;
    } catch (err) {
      mainError('CronBridge', 'updateJob failed:', err);
      return { __error: err instanceof Error ? err.message : String(err) } as never;
    }
  });

  ipcBridge.cron.removeJob.provider(async ({ jobId }) => {
    try {
      const provider = getCronProvider();
      mainLog('CronBridge', `Removing job ${jobId} via ${provider.type} provider`);
      await provider.removeJob(jobId);
      ipcBridge.cron.onJobRemoved.emit({ jobId });
    } catch (err) {
      mainError('CronBridge', 'removeJob failed:', err);
      return { __error: err instanceof Error ? err.message : String(err) } as never;
    }
  });

  ipcBridge.cron.triggerJob.provider(async ({ jobId }) => {
    try {
      const provider = getCronProvider();
      mainLog('CronBridge', `Triggering job ${jobId} via ${provider.type} provider`);
      await provider.triggerJob(jobId);
    } catch (err) {
      mainError('CronBridge', 'triggerJob failed:', err);
      return { __error: err instanceof Error ? err.message : String(err) } as never;
    }
  });

  // Power management handlers - only available in local provider
  ipcBridge.cron.getPowerSaveActive.provider(async () => {
    try {
      const provider = getCronProvider();
      if (provider.getPowerSaveActive) {
        return provider.getPowerSaveActive();
      }
      // Remote provider doesn't support power save
      return false;
    } catch (err) {
      mainError('CronBridge', 'getPowerSaveActive failed:', err);
      return false;
    }
  });

  ipcBridge.cron.setPowerSave.provider(async ({ enabled }) => {
    try {
      const provider = getCronProvider();
      if (provider.setPowerSave) {
        await provider.setPowerSave(enabled);
      }
      // Remote provider doesn't support power save - no-op
    } catch (err) {
      mainError('CronBridge', 'setPowerSave failed:', err);
    }
  });
}
