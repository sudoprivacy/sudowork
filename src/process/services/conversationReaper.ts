/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Conversation Resource Reaper — the SSOT for releasing every resource a
 * conversation owns (DB rows, agent child process, terminals, browser tabs,
 * cron jobs, channel session, Moss remote session, in-memory caches and the
 * auto workspace directory on disk).
 *
 * Every conversation-lifecycle trigger (user delete, preset-assistant
 * uninstall, orphan sweep) routes through {@link reapConversation} so there is
 * a single, ordered, DRY cleanup path — whatever a caller forgets can no longer
 * leak.
 *
 * Step order: process → in-memory → DB/external → filesystem → renderer. The
 * filesystem removal runs LAST (after the process is dead and the row is gone)
 * so a crash mid-rm leaves a boot-sweepable orphan dir, never a dangling row.
 * Each step runs in its own try/catch and records failures into `errors[]`; one
 * failing step never aborts the rest.
 */

import fs from 'fs/promises';
import path from 'path';
import { getDatabase } from '@process/database';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/storage';
import WorkerManage from '../WorkerManage';
import { closeTerminalsByConversation } from '../bridge/terminalBridge';
import { closeBrowserTabsByConversation } from '../bridge/browserPanelBridge';
import { disposeConversation } from '../message';
import { stopConversationTracking } from '../telemetry';
import { getConversationProvider } from '../providers';
import { getSystemDir } from '../initStorage';
import { TEMP_WORKSPACE_REGEX } from '../task/draftsCleanup';
import { cronService } from './cron/CronService';

export type ReapReason = 'user-delete' | 'assistant-uninstall' | 'orphan-sweep' | 'healthcheck-cleanup';

export interface ReapOptions {
  reason: ReapReason;
  /**
   * Tri-state workspace disposition:
   * - `true`  → explicit request (checkbox); delete the workspace folder.
   * - `false` → keep the workspace folder.
   * - `undefined` → resolve from `extra.customWorkspace`: auto scratch
   *   (`customWorkspace === false`) is deleted silently, a user-selected folder
   *   (`customWorkspace === true`) is kept.
   */
  deleteWorkspace?: boolean;
  /** Skip the DB + external delete (caller already removed the row). */
  skipDbDelete?: boolean;
  /** Pre-resolved conversation to avoid a redundant DB read. */
  conversation?: TChatConversation;
}

export interface ReapResult {
  id: string;
  dbDeleted: boolean;
  workspaceDeleted: boolean;
  workspacePath?: string;
  errors: Array<{ step: string; error: unknown }>;
}

type ReapExtra = NonNullable<TChatConversation['extra']> & {
  workspace?: string;
  customWorkspace?: boolean;
  cronJobId?: string;
};

/**
 * Decide whether the workspace directory may be removed. A user asset can never
 * be auto-deleted even if `customWorkspace` was mis-set: the auto-resolve branch
 * additionally requires the path to structurally match an auto temp workspace
 * (directly under workDir, `<backend>-temp-<ts>` basename).
 */
function resolveWorkspaceDeletion(workspacePath: string | undefined, customWorkspace: boolean | undefined, deleteWorkspace: boolean | undefined): boolean {
  if (!workspacePath) return false;

  const resolved = path.resolve(workspacePath);
  const workDir = path.resolve(getSystemDir().workDir);

  // Never remove the workDir root itself or a filesystem root.
  if (resolved === workDir || path.dirname(resolved) === resolved) return false;

  if (deleteWorkspace === true) {
    // Explicit user request (checkbox). Honor it for both custom folders and auto scratch.
    return true;
  }
  if (deleteWorkspace === false) return false;

  // undefined → auto-resolve. Only disposable auto scratch dirs, and only if the
  // path really is one (defensive guard against a mis-set customWorkspace flag).
  const isAutoPath = path.dirname(resolved) === workDir && TEMP_WORKSPACE_REGEX.test(path.basename(resolved));
  return customWorkspace === false && isAutoPath;
}

/**
 * Release every resource owned by a conversation. See module docs for step order.
 */
export async function reapConversation(id: string, opts: ReapOptions): Promise<ReapResult> {
  const result: ReapResult = { id, dbDeleted: false, workspaceDeleted: false, errors: [] };
  const runStep = async (step: string, fn: () => void | Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (error) {
      result.errors.push({ step, error });
      mainWarn('ConversationReaper', `[${opts.reason}] step "${step}" failed for ${id}:`, error);
    }
  };

  // 1. Resolve conversation + derive its resource handles.
  let conversation = opts.conversation;
  if (!conversation) {
    try {
      const convResult = getDatabase().getConversation(id);
      conversation = convResult.data ?? undefined;
    } catch (error) {
      result.errors.push({ step: 'resolve', error });
    }
  }

  const extra = conversation?.extra as ReapExtra | undefined;
  const source = conversation?.source;
  const workspacePath = extra?.workspace;
  const isCronExecutionConversation = !!extra?.cronJobId;
  result.workspacePath = workspacePath;

  if (!conversation) {
    mainWarn('ConversationReaper', `[${opts.reason}] conversation ${id} not found; nothing to reap`);
    return result;
  }

  // 2. Kill the running agent task FIRST so it releases dir handles before rm
  //    (Windows EBUSY). Use kill(), NOT clear() — clear() detaches remote-agent
  //    and leaves Moss alive, which is app-exit semantics only.
  await runStep('kill-worker', () => {
    WorkerManage.kill(id);
  });

  // 3. Right-panel terminals.
  await runStep('close-terminals', () => {
    closeTerminalsByConversation(id);
  });

  // 4. Right-panel browser tabs.
  await runStep('close-browser-tabs', () => {
    closeBrowserTabsByConversation(id);
  });

  // 5. Cron jobs owned by this conversation (skip conversations that were
  //    themselves created by a cron run).
  if (!isCronExecutionConversation) {
    await runStep('cron', async () => {
      const jobs = await cronService.listJobsByConversation(id);
      for (const job of jobs) {
        await cronService.removeJob(job.id);
        ipcBridge.cron.onJobRemoved.emit({ jobId: job.id });
      }
    });
  }

  // 6. Channel resources (telegram / lark / dingtalk sessions).
  if (source && source !== 'sudowork') {
    await runStep('channel', async () => {
      const { getChannelManager } = await import('@/channels/core/ChannelManager');
      const channelManager = getChannelManager();
      if (channelManager.isInitialized()) {
        await channelManager.cleanupConversation(id);
        mainLog('ConversationReaper', `Cleaned up channel resources for ${source} conversation ${id}`);
      }
    });
  }

  // 7. In-memory disposers for caches that are otherwise never reaped.
  await runStep('dispose-message-cache', () => {
    disposeConversation(id);
  });
  await runStep('stop-telemetry-tracking', () => {
    stopConversationTracking(id);
  });

  // 8. DB + external delete (cascades messages; remote provider also terminates
  //    the Moss session best-effort and clears cachedModelInfo).
  if (!opts.skipDbDelete) {
    await runStep('db-delete', async () => {
      const provider = getConversationProvider();
      const success = await provider.deleteConversation(id);
      result.dbDeleted = success;
      if (!success) {
        mainError('ConversationReaper', `[${opts.reason}] provider.deleteConversation returned false for ${id}`);
      }
    });
  }

  // 9. Workspace removal LAST (process dead + row gone).
  if (resolveWorkspaceDeletion(workspacePath, extra?.customWorkspace, opts.deleteWorkspace)) {
    await runStep('workspace-rm', async () => {
      await fs.rm(workspacePath as string, { recursive: true, force: true });
      result.workspaceDeleted = true;
      mainLog('ConversationReaper', `[${opts.reason}] deleted workspace folder: ${workspacePath}`);
    });
  }

  // 10. Consolidated broadcast so renderer-side caches drop their entries.
  await runStep('emit-reaped', () => {
    ipcBridge.conversation.reaped.emit({ id });
  });

  return result;
}
