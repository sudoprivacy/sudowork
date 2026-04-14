/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import type { TChatConversation } from '@/common/storage';
import fs from 'fs/promises';
import { getDatabase } from '@process/database';
import { cronService } from '@process/services/cron/CronService';
import { mainError, mainLog, mainWarn } from '@process/utils/mainLogger';
import { ipcBridge } from '../../common';
import { uuid } from '../../common/utils';
import { shouldSyncWorkspaceSkills } from '../../common/utils/workspaceSkillSync';
import { getGatewayPort, SUDOCLAW_DEFAULT_PORT } from '../../agent/openclaw/openclawConfig';
import { getSkillsDir, ProcessChat } from '../initStorage';
import { ConversationService } from '../services/conversationService';
import { SUDOCLAW_DIR } from '../services/sudoclaw/SudoclawInstallService';
import { checkSudoclawHealth } from '../services/sudoclaw/sudoclawHealth';
import type AcpAgent from '../task/AcpAgent';
import type OpenClawAgent from '../task/OpenClawAgent';
import { prepareFirstMessage, prepareOpenClawFirstMessage, injectSkillsDirectoryHint } from '../task/agentUtils';
import { resolveOpenClawConnectionStatus } from '../utils/connectionStatus';
import { listWorkspaceSkillTargets, resolveConversationEnabledSkillNames } from '../utils/workspaceSkillTargets';
import { areSkillSelectionsEqual, resolveLatestConversationEnabledSkills } from '../utils/conversationAssistantSkills';
import { copyFilesToDirectory, readDirectoryRecursive } from '../utils';
import { computeOpenClawIdentityHash } from '../utils/openclawUtils';
import { resolveWorkspaceSkillsDir } from '../utils/workspaceSkillsDir';
import WorkerManage from '../WorkerManage';
import { migrateConversationToDatabase } from './migrationUtils';

const workspaceSkillSyncTasks = new Map<string, Promise<void>>();

async function syncConversationWorkspaceSkills(conversation: TChatConversation | undefined, requestedSkillNames?: string[]): Promise<void> {
  if (!shouldSyncWorkspaceSkills(conversation, requestedSkillNames)) return;
  const workspace = conversation.extra.workspace;
  const startedAt = Date.now();
  const latestEnabledSkills = await resolveLatestConversationEnabledSkills(conversation);

  if (conversation?.id && !areSkillSelectionsEqual(conversation.extra?.enabledSkills, latestEnabledSkills)) {
    const db = getDatabase();
    const updateResult = db.updateConversation(conversation.id, {
      extra: {
        ...conversation.extra,
        enabledSkills: latestEnabledSkills,
      },
    } as Partial<TChatConversation>);

    if (!updateResult.success) {
      mainWarn('ConversationSkillSync', `Failed to refresh enabled skills cache for conversation ${conversation.id}: ${updateResult.error}`);
    } else {
      conversation = {
        ...conversation,
        extra: {
          ...conversation.extra,
          enabledSkills: latestEnabledSkills,
        },
      } as TChatConversation;
    }
  }

  const workspaceSkillsDir = resolveWorkspaceSkillsDir(conversation);
  if (!workspaceSkillsDir) return;
  await fs.mkdir(workspaceSkillsDir, { recursive: true });

  const expectedTargets = await listWorkspaceSkillTargets(getSkillsDir(), resolveConversationEnabledSkillNames(conversation, requestedSkillNames));
  const existingEntries = await fs.readdir(workspaceSkillsDir, { withFileTypes: true }).catch((): import('fs').Dirent[] => []);
  const existingNames = new Set(existingEntries.map((entry) => entry.name));
  let removedCount = 0;
  let recreatedCount = 0;
  let createdCount = 0;

  for (const entry of existingEntries) {
    const entryPath = path.join(workspaceSkillsDir, entry.name);
    const expectedTarget = expectedTargets.get(entry.name);

    if (!expectedTarget) {
      await fs.rm(entryPath, { recursive: true, force: true });
      removedCount++;
      continue;
    }

    try {
      const stat = await fs.lstat(entryPath);
      if (!stat.isSymbolicLink()) {
        await fs.rm(entryPath, { recursive: true, force: true });
        existingNames.delete(entry.name);
        recreatedCount++;
        continue;
      }

      const linkedTarget = await fs.readlink(entryPath);
      const resolvedLinkedTarget = path.resolve(path.dirname(entryPath), linkedTarget);
      if (resolvedLinkedTarget !== path.resolve(expectedTarget)) {
        await fs.rm(entryPath, { recursive: true, force: true });
        existingNames.delete(entry.name);
        recreatedCount++;
      }
    } catch {
      await fs.rm(entryPath, { recursive: true, force: true });
      existingNames.delete(entry.name);
      recreatedCount++;
    }
  }

  for (const [skillName, targetDir] of expectedTargets) {
    if (existingNames.has(skillName)) continue;
    const linkPath = path.join(workspaceSkillsDir, skillName);
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    await fs.symlink(targetDir, linkPath, linkType);
    createdCount++;
  }

  mainLog('ConversationSkillSync', 'syncConversationWorkspaceSkills completed', {
    conversationId: conversation?.id,
    workspace,
    expectedCount: expectedTargets.size,
    existingCount: existingEntries.length,
    removedCount,
    recreatedCount,
    createdCount,
    durationMs: Date.now() - startedAt,
  });
}

function scheduleConversationWorkspaceSkillSync(conversation: TChatConversation | undefined): void {
  if (!shouldSyncWorkspaceSkills(conversation)) return;
  const workspace = conversation.extra.workspace;

  const existingTask = workspaceSkillSyncTasks.get(workspace);
  if (existingTask) {
    mainLog('ConversationSkillSync', 'scheduleConversationWorkspaceSkillSync skipped: task already running', {
      conversationId: conversation?.id,
      workspace,
    });
    return;
  }

  mainLog('ConversationSkillSync', 'scheduleConversationWorkspaceSkillSync queued', {
    conversationId: conversation?.id,
    workspace,
  });

  const task = Promise.resolve()
    .then(async () => {
      await syncConversationWorkspaceSkills(conversation);
    })
    .catch((error) => {
      mainWarn('ConversationSkillSync', 'Failed to sync workspace skills', error);
    })
    .finally(() => {
      workspaceSkillSyncTasks.delete(workspace);
      mainLog('ConversationSkillSync', 'scheduleConversationWorkspaceSkillSync finished', {
        conversationId: conversation?.id,
        workspace,
      });
    });

  workspaceSkillSyncTasks.set(workspace, task);
}

export function initConversationBridge(): void {
  ipcBridge.openclawConversation.getRuntime.provider(async ({ conversation_id }) => {
    try {
      const db = getDatabase();
      const convResult = db.getConversation(conversation_id);
      if (!convResult.success || !convResult.data || convResult.data.type !== 'openclaw-gateway') {
        return { success: false, msg: 'Sudoclaw conversation not found' };
      }
      const conversation = convResult.data;
      const task = (await WorkerManage.getTaskByIdRollbackBuild(conversation_id)) as OpenClawAgent | undefined;
      if (!task || task.type !== 'openclaw-gateway') {
        return { success: false, msg: 'Sudoclaw runtime not available' };
      }

      // Await bootstrap to ensure the agent is fully connected before returning runtime info.
      // Without this, getRuntime may return isConnected=false while the agent is still connecting.
      await task.bootstrap.catch(() => {});

      const diagnostics = task.getDiagnostics();
      const identityHash = await computeOpenClawIdentityHash(diagnostics.workspace || conversation.extra?.workspace);
      const conversationModel = (conversation as { model?: { useModel?: string } }).model;
      const resolvedModel = diagnostics.model || conversation.extra?.openclawModelId || conversation.extra?.runtimeValidation?.expectedModel || conversationModel?.useModel;

      return {
        success: true,
        data: {
          conversationId: conversation_id,
          runtime: {
            workspace: diagnostics.workspace || conversation.extra?.workspace,
            backend: diagnostics.backend || conversation.extra?.backend,
            agentName: diagnostics.agentName || conversation.extra?.agentName,
            model: resolvedModel,
            sessionKey: diagnostics.sessionKey,
            isConnected: diagnostics.isConnected,
            hasActiveSession: diagnostics.hasActiveSession,
            identityHash,
          },
          expected: (conversation.extra as { runtimeValidation?: unknown } | undefined)?.runtimeValidation,
        },
      };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Get global OpenClaw Gateway status (independent of any conversation)
  ipcBridge.openclawConversation.getGatewayStatus.provider(async () => {
    try {
      const gatewayHost = '127.0.0.1';
      const gatewayPort = getGatewayPort(SUDOCLAW_DIR);
      const gatewayRunning = await checkSudoclawHealth(gatewayHost, gatewayPort, 1000);

      const baseData = {
        gatewayRunning,
        gatewayPort,
        gatewayHost,
        gatewayUrl: `ws://${gatewayHost}:${gatewayPort}`,
        isConnected: gatewayRunning,
        hasActiveSession: false,
        sessionKey: null as string | null,
      };

      const db = getDatabase();
      const allConvs = db.getUserConversations(undefined, 0, 1000);
      const openclawConvs = (allConvs.data || []).filter((c) => c.type === 'openclaw-gateway');

      for (const conv of openclawConvs) {
        const convAny = conv as unknown as { model?: { useModel?: string; name?: string }; extra?: { gateway?: { host?: string; port?: number }; workspace?: string; agentName?: string; model?: string } };
        const convModel = convAny.model;
        const model = convModel?.useModel || convModel?.name || convAny.extra?.model;
        const extra = convAny.extra;
        const task = WorkerManage.getTaskById(conv.id) as OpenClawAgent | undefined;

        if (task && task.type === 'openclaw-gateway') {
          const diagnostics = task.getDiagnostics();

          return {
            success: true,
            data: {
              ...baseData,
              workspace: diagnostics.workspace || extra?.workspace,
              agentName: diagnostics.agentName || extra?.agentName,
              model,
            },
          };
        }

        return {
          success: true,
          data: {
            ...baseData,
            workspace: extra?.workspace,
            agentName: extra?.agentName,
            model,
          },
        };
      }

      return {
        success: true,
        data: baseData,
      };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
        data: {
          gatewayRunning: false,
          gatewayPort: SUDOCLAW_DEFAULT_PORT,
          gatewayHost: '127.0.0.1',
          gatewayUrl: `ws://127.0.0.1:${SUDOCLAW_DEFAULT_PORT}`,
          isConnected: false,
          hasActiveSession: false,
          sessionKey: null,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });

  // Get OpenClaw info via CLI (local execution)
  ipcBridge.openclawConversation.getCliInfo.provider(async () => {
    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);

      // Try to get OpenClaw version
      let version: string | undefined;
      try {
        const { stdout } = await execAsync('openclaw --version');
        version = stdout.trim();
      } catch {
        // Version not available
      }

      // Try to get gateway status
      let gatewayPort = 17863;
      let gatewayHost = 'localhost';
      let workspace: string | undefined;
      let agentName: string | undefined;
      let model: string | undefined;

      // Read OpenClaw config file
      try {
        const { readFile } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const { homedir } = await import('node:os');
        const configPath = join(homedir(), '.nexus', 'sudoclaw', 'sudoclaw.json');
        const configContent = await readFile(configPath, 'utf-8');
        const config = JSON.parse(configContent);

        // Extract gateway config
        if (config.gateway?.port) {
          gatewayPort = config.gateway.port;
        }
        if (config.gateway?.host) {
          gatewayHost = config.gateway.host;
        }

        // Extract workspace from agents.defaults
        if (config.agents?.defaults?.workspace) {
          workspace = config.agents.defaults.workspace;
        }

        // Extract model from agents.defaults
        if (config.agents?.defaults?.model?.primary) {
          model = config.agents.defaults.model.primary;
          // Extract just the model name (e.g., 'bailian/qwen3.5-plus' -> 'qwen3.5-plus')
          if (model.includes('/')) {
            model = model.split('/').pop();
          }
        }

        // Extract agent name
        agentName = config.agents?.defaults?.agentName || '小宇';
      } catch {
        // Config not available
      }

      // Check if gateway is running by probing the port
      const net = await import('node:net');
      const isGatewayRunning = await new Promise<boolean>((resolve) => {
        const socket = net.createConnection({ host: gatewayHost, port: gatewayPort });
        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => resolve(false));
        socket.setTimeout(500);
      });

      return {
        success: true,
        data: {
          version,
          workspace,
          gatewayPort,
          gatewayHost,
          agentName,
          model,
          isConnected: isGatewayRunning,
        },
      };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
        data: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });

  ipcBridge.openclawConversation.setSessionModel.provider(async ({ conversation_id, modelId }) => {
    try {
      const task = (await WorkerManage.getTaskByIdRollbackBuild(conversation_id)) as OpenClawAgent | undefined;
      if (!task || task.type !== 'openclaw-gateway') {
        return { success: false, msg: 'Sudoclaw conversation not found' };
      }

      const result = await task.setSessionModel(modelId);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcBridge.conversation.create.provider(async (params): Promise<TChatConversation> => {
    // 使用 ConversationService 创建会话 / Use ConversationService to create conversation
    const result = await ConversationService.createConversation({
      ...params,
      source: 'aionui', // AionUI 创建的会话标记为 aionui / Mark conversations created by AionUI as aionui
    });

    if (!result.success || !result.conversation) {
      throw new Error(result.error || 'Failed to create conversation');
    }

    scheduleConversationWorkspaceSkillSync(result.conversation);

    return result.conversation;
  });

  // Reload context is not supported for ACP or OpenClaw agents
  ipcBridge.conversation.reloadContext.provider(async () => {
    return { success: false, msg: 'reload context not supported' };
  });

  ipcBridge.conversation.getAssociateConversation.provider(async ({ conversation_id }) => {
    try {
      const db = getDatabase();

      // Try to get current conversation from database
      let currentConversation: TChatConversation | undefined;
      const currentResult = db.getConversation(conversation_id);

      if (currentResult.success && currentResult.data) {
        currentConversation = currentResult.data;
      } else {
        // Not in database, try file storage
        const history = await ProcessChat.get('chat.history');
        currentConversation = (history || []).find((item) => item.id === conversation_id);

        // Lazy migrate in background
        if (currentConversation) {
          void migrateConversationToDatabase(currentConversation);
        }
      }

      if (!currentConversation || !currentConversation.extra?.workspace) {
        return [];
      }

      // Get all conversations from database (get first page with large limit to get all)
      const allResult = db.getUserConversations(undefined, 0, 10000);
      let allConversations: TChatConversation[] = allResult.data || [];

      // If database is empty or doesn't have enough conversations, merge with file storage
      const history = await ProcessChat.get('chat.history');
      if (allConversations.length < (history?.length || 0)) {
        // Database doesn't have all conversations yet, use file storage
        allConversations = history || [];

        // Lazy migrate all conversations in background
        void Promise.all(allConversations.map((conv) => migrateConversationToDatabase(conv)));
      }

      // Filter by workspace
      return allConversations.filter((item) => item.extra?.workspace === currentConversation.extra.workspace);
    } catch (error) {
      mainError('conversationBridge', 'Failed to get associate conversations:', error);
      return [];
    }
  });

  ipcBridge.conversation.createWithConversation.provider(({ conversation, sourceConversationId }) => {
    try {
      conversation.createTime = Date.now();
      conversation.modifyTime = Date.now();
      WorkerManage.buildConversation(conversation);

      // Save to database only
      const db = getDatabase();
      const result = db.createConversation(conversation);
      if (!result.success) {
        mainError('conversationBridge', 'Failed to create conversation in database:', result.error);
      }

      // Migrate messages if sourceConversationId is provided / 如果提供了源会话ID，则迁移消息
      if (sourceConversationId && result.success) {
        try {
          // Fetch all messages from source conversation / 获取源会话的所有消息
          const pageSize = 10000;
          let page = 0;
          let hasMore = true;

          while (hasMore) {
            const messagesResult = db.getConversationMessages(sourceConversationId, page, pageSize);
            const messages = messagesResult.data;

            for (const msg of messages) {
              const newMessage = {
                ...msg,
                id: uuid(),
                conversation_id: conversation.id,
                createdAt: msg.createdAt || Date.now(),
              };
              db.insertMessage(newMessage);
            }

            hasMore = messagesResult.hasMore;
            page++;
          }

          // Verify integrity and remove source conversation
          const sourceMessages = db.getConversationMessages(sourceConversationId, 0, 1);
          const newMessages = db.getConversationMessages(conversation.id, 0, 1);

          if (sourceMessages.total === newMessages.total) {
            const deleteResult = db.deleteConversation(sourceConversationId);
            if (deleteResult.success) {
              mainLog('conversationBridge', `Successfully migrated and deleted source conversation ${sourceConversationId}`);
            } else {
              mainError('conversationBridge', `Failed to delete source conversation ${sourceConversationId}: ${deleteResult.error}`);
            }
          } else {
            mainError('conversationBridge', 'Migration integrity check failed: Message counts do not match.', {
              source: sourceMessages.total,
              new: newMessages.total,
            });
          }
        } catch (msgError) {
          mainError('conversationBridge', 'Failed to copy messages during migration:', msgError);
        }
      }

      scheduleConversationWorkspaceSkillSync(conversation);

      return Promise.resolve(conversation);
    } catch (error) {
      mainError('conversationBridge', 'Failed to create conversation with conversation:', error);
      return Promise.resolve(conversation);
    }
  });

  ipcBridge.conversation.syncWorkspaceSkills.provider(async ({ conversation_id }) => {
    try {
      const db = getDatabase();
      const result = db.getConversation(conversation_id);
      if (!result.success || !result.data) {
        return { success: false, msg: 'Conversation not found' };
      }

      scheduleConversationWorkspaceSkillSync(result.data);
      return { success: true };
    } catch (error) {
      mainError('conversationBridge', 'Failed to sync workspace skills:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.conversation.remove.provider(async ({ id }) => {
    try {
      const db = getDatabase();

      // Get conversation to check source before deletion
      const convResult = db.getConversation(id);
      const conversation = convResult.data;
      const source = conversation?.source;

      // Kill the running task if exists
      WorkerManage.kill(id);

      // Delete associated cron jobs
      try {
        const jobs = await cronService.listJobsByConversation(id);
        for (const job of jobs) {
          await cronService.removeJob(job.id);
          ipcBridge.cron.onJobRemoved.emit({ jobId: job.id });
        }
      } catch (cronError) {
        mainWarn('conversationBridge', 'Failed to cleanup cron jobs:', cronError);
      }

      // If source is not 'aionui' (e.g., telegram), cleanup channel resources
      if (source && source !== 'aionui') {
        try {
          const { getChannelManager } = await import('@/channels/core/ChannelManager');
          const channelManager = getChannelManager();
          if (channelManager.isInitialized()) {
            await channelManager.cleanupConversation(id);
            mainLog('conversationBridge', `Cleaned up channel resources for ${source} conversation ${id}`);
          }
        } catch (cleanupError) {
          mainWarn('conversationBridge', 'Failed to cleanup channel resources:', cleanupError);
        }
      }

      // Delete conversation from database (will cascade delete messages due to foreign key)
      const result = db.deleteConversation(id);
      if (!result.success) {
        mainError('conversationBridge', 'Failed to delete conversation from database:', result.error);
        return false;
      }

      return true;
    } catch (error) {
      mainError('conversationBridge', 'Failed to remove conversation:', error);
      return false;
    }
  });

  ipcBridge.conversation.update.provider(async ({ id, updates, mergeExtra }: { id: string; updates: Partial<TChatConversation>; mergeExtra?: boolean }) => {
    try {
      const db = getDatabase();
      const existing = db.getConversation(id);
      const prevModel = existing.success && existing.data && 'model' in existing.data ? existing.data.model : undefined;
      const nextModel = 'model' in updates ? updates.model : undefined;
      const modelChanged = !!nextModel && JSON.stringify(prevModel) !== JSON.stringify(nextModel);

      let finalUpdates = updates;
      if (mergeExtra && updates.extra && existing.success && existing.data) {
        finalUpdates = {
          ...updates,
          extra: {
            ...existing.data.extra,
            ...updates.extra,
          },
        } as Partial<TChatConversation>;
      }

      const result = await Promise.resolve(db.updateConversation(id, finalUpdates));

      // If model changed, kill running task to force rebuild with new model on next send
      if (result.success && modelChanged) {
        try {
          WorkerManage.kill(id);
        } catch (killErr) {
          // ignore kill error, will lazily rebuild later
        }
      }

      return result.success;
    } catch (error) {
      mainError('conversationBridge', 'Failed to update conversation:', error);
      return false;
    }
  });

  ipcBridge.conversation.reset.provider(({ id }) => {
    if (id) {
      WorkerManage.kill(id);
    } else {
      WorkerManage.clear();
    }
    return Promise.resolve();
  });

  ipcBridge.conversation.get.provider(async ({ id }) => {
    try {
      const db = getDatabase();

      const result = db.getConversation(id);
      if (result.success && result.data) {
        const conversation = result.data;
        const task = WorkerManage.getTaskById(id);
        const taskStatus = task?.status === 'idle' ? 'finished' : task?.status;
        conversation.status = taskStatus || 'finished';
        return conversation;
      }

      const history = await ProcessChat.get('chat.history');
      const conversation = (history || []).find((item) => item.id === id);
      if (conversation) {
        const task = WorkerManage.getTaskById(id);
        const taskStatus = task?.status === 'idle' ? 'finished' : task?.status;
        conversation.status = taskStatus || 'finished';
        void migrateConversationToDatabase(conversation);
        return conversation;
      }

      return undefined;
    } catch (error) {
      mainError('conversationBridge', 'Failed to get conversation:', error);
      return undefined;
    }
  });

  // Get the last emitted connection status for any agent type (openclaw or acp)
  // Uses cache-only lookup (getTaskById) — no side effects, no bootstrapping
  ipcBridge.conversation.getConnectionStatus.provider(async ({ conversation_id }) => {
    try {
      const task = WorkerManage.getTaskById(conversation_id) as OpenClawAgent | AcpAgent | undefined;
      if (!task || typeof (task as any).lastConnectionStatus === 'undefined') {
        return { success: true, data: { status: null } };
      }
      if (task.type === 'openclaw-gateway') {
        const openclawTask = task as OpenClawAgent;
        const diagnostics = openclawTask.getDiagnostics();
        return {
          success: true,
          data: {
            status: resolveOpenClawConnectionStatus({
              lastStatus: openclawTask.lastConnectionStatus,
              isConnected: diagnostics.isConnected,
              hasActiveSession: diagnostics.hasActiveSession,
            }),
          },
        };
      }
      return { success: true, data: { status: (task as any).lastConnectionStatus as string | null } };
    } catch {
      return { success: true, data: { status: null } };
    }
  });

  // Abort controller for workspace reads: each new request aborts the previous one
  // to avoid stale results when the user navigates quickly.
  let lastGetWorkspaceAbortController: AbortController | undefined;

  ipcBridge.conversation.getWorkspace.provider(async ({ workspace, search, path }) => {
    // Abort any in-flight workspace read
    lastGetWorkspaceAbortController?.abort();
    lastGetWorkspaceAbortController = new AbortController();

    // Simple file filter that skips common non-essential directories
    const fileService = { shouldIgnoreFile: (p: string) => p.includes('node_modules') || p.includes('.git') };
    try {
      return await readDirectoryRecursive(path, {
        root: workspace,
        fileService,
        abortController: lastGetWorkspaceAbortController,
        maxDepth: 10,
        search: {
          text: search,
          onProcess(result) {
            void ipcBridge.conversation.responseSearchWorkSpace.invoke(result);
          },
        },
      }).then((res) => (res ? [res] : []));
    } catch (error) {
      // Always return [] on error — throwing from a bridge provider
      // leaves the renderer invoke() promise hanging forever because
      // the bridge subscribe handler has no .catch() on the provider call.
      if (error instanceof Error && !error.message.includes('aborted')) {
        mainWarn('conversationBridge', 'getWorkspace failed:', error.message);
      }
      return [];
    }
  });

  ipcBridge.conversation.stop.provider(async ({ conversation_id }) => {
    const task = WorkerManage.getTaskById(conversation_id);
    if (!task) return { success: true, msg: 'conversation not found' };
    if (task.type !== 'acp' && task.type !== 'openclaw-gateway') {
      return { success: false, msg: 'not support' };
    }
    await task.stop();
    return { success: true };
  });

  ipcBridge.conversation.getSlashCommands.provider(async ({ conversation_id }) => {
    try {
      const db = getDatabase();
      const convResult = db.getConversation(conversation_id);
      if (!convResult.success || !convResult.data) {
        return { success: true, data: { commands: [] } };
      }

      const imageCommand: import('@/common/slash/types').SlashCommandItem = { name: 'image', description: 'Generate an image', hint: 'generate an image', kind: 'template', source: 'builtin' };

      const conversation = convResult.data;
      if (conversation.type === 'openclaw-gateway') {
        return { success: true, data: { commands: [imageCommand] } };
      }

      if (conversation.type !== 'acp') {
        return { success: true, data: { commands: [] } };
      }

      const task = WorkerManage.getTaskById(conversation_id) as AcpAgent | undefined;
      if (!task || task.type !== 'acp') {
        return { success: true, data: { commands: [imageCommand] } };
      }

      const commands = await task.loadAcpSlashCommands();
      return { success: true, data: { commands: [imageCommand, ...commands] } };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // 通用 sendMessage 实现 - 自动根据 conversation 类型分发
  ipcBridge.conversation.sendMessage.provider(async ({ conversation_id, files, ...other }) => {
    mainLog('conversationBridge', `sendMessage called: conversation_id=${conversation_id}, msg_id=${other.msg_id}`);

    let task: AcpAgent | OpenClawAgent | undefined;
    try {
      task = (await WorkerManage.getTaskByIdRollbackBuild(conversation_id)) as AcpAgent | OpenClawAgent | undefined;
    } catch (err) {
      mainLog('conversationBridge', `sendMessage: failed to get/build task: ${conversation_id}`, err);
      return { success: false, msg: err instanceof Error ? err.message : 'conversation not found' };
    }

    if (!task) {
      mainLog('conversationBridge', `sendMessage: conversation not found: ${conversation_id}`);
      return { success: false, msg: 'conversation not found' };
    }
    mainLog('conversationBridge', `sendMessage: found task type=${task.type}, status=${task.status}`);

    // 复制文件到工作空间（所有 agents 统一处理）
    let filesToProcess = files ?? [];
    const openclawTask = task as OpenClawAgent;
    if (task.type === 'openclaw-gateway' && filesToProcess.length === 0 && openclawTask.workspace) {
      filesToProcess = [openclawTask.workspace];
      mainLog('conversationBridge', `OpenClaw: no files from frontend, using workspace: ${openclawTask.workspace}`);
    }

    // Download bdpan:// files to workspace before copying
    const workspace = task.workspace ?? '';
    const resolvedFiles: string[] = [];
    for (const f of filesToProcess) {
      if (f.startsWith('bdpan://')) {
        // Parse bdpan:///<path>?root=<root>
        const raw = decodeURIComponent(f.slice('bdpan://'.length));
        const qIdx = raw.indexOf('?');
        const remoteFull = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
        const rootParam = qIdx >= 0 ? (new URLSearchParams(raw.slice(qIdx + 1)).get('root') ?? '') : '';
        // Strip root prefix to get relative path: /apps/bdpan/abc/haha.jpg -> abc/haha.jpg
        const rootPrefix = rootParam.endsWith('/') ? rootParam : rootParam + '/';
        const remoteArg = remoteFull.startsWith(rootPrefix) ? remoteFull.slice(rootPrefix.length) : remoteFull.replace(/^\/+/, '');
        const filename = remoteFull.split('/').filter(Boolean).pop() ?? 'bdpan_file';
        const destDir = workspace || os.tmpdir();
        const localPath = path.join(destDir, filename);
        mainLog('ConversationBridge', `Downloading bdpan file: ${remoteArg} → ${localPath}`);
        try {
          const localBin = `${os.homedir()}/.local/bin`;
          if (!process.env.PATH?.includes(localBin)) {
            process.env.PATH = `${localBin}:${process.env.PATH ?? ''}`;
          }
          await new Promise<void>((resolve) => {
            const args = ['download', remoteArg, localPath, '--json'];
            mainLog('ConversationBridge', `bdpan spawn: bdpan ${args.join(' ')}`);
            const child = spawn('bdpan', args, {
              env: { ...process.env, HOME: os.homedir() },
            });
            let stdout = '';
            let stderr = '';
            child.stdout?.on('data', (d: Buffer) => {
              stdout += d.toString();
            });
            child.stderr?.on('data', (d: Buffer) => {
              stderr += d.toString();
            });
            child.on('close', (code) => {
              mainLog('ConversationBridge', `bdpan exit code=${code} stdout=${stdout.trim()} stderr=${stderr.trim()}`);
              let jsonCode: number | undefined;
              let jsonError: string | undefined;
              try {
                const json = JSON.parse(stdout.trim()) as { code?: number; error?: string };
                jsonCode = json.code;
                jsonError = json.error || undefined;
              } catch (_err) {
                // Ignore non-JSON output and fall back to stderr/stdout text.
              }
              if (jsonCode === 0) {
                mainLog('ConversationBridge', `Downloaded ${remoteArg} → ${localPath}`);
                resolvedFiles.push(localPath);
                ipcBridge.bdpan.downloadResult.emit({ success: true });
              } else {
                const dlErr = jsonError || stderr || stdout || 'bdpan download failed';
                mainError('ConversationBridge', `bdpan download failed: ${dlErr}`);
                ipcBridge.bdpan.downloadResult.emit({ success: false, error: dlErr });
              }
              resolve();
            });
            child.on('error', (err) => {
              mainError('ConversationBridge', `bdpan spawn error: ${err.message}`);
              ipcBridge.bdpan.downloadResult.emit({ success: false, error: err.message });
              resolve();
            });
          });
        } catch (err) {
          mainError('ConversationBridge', `bdpan download exception: ${err}`);
        }
      } else {
        resolvedFiles.push(f);
      }
    }
    filesToProcess = resolvedFiles;

    const workspaceFiles = await copyFilesToDirectory(workspace, filesToProcess, false);

    // Get conversation to access presetContext and enabledSkills for preset assistants
    // 获取 conversation 以访问预设助手的 presetContext 和 enabledSkills
    let presetContext: string | undefined;
    let enabledSkills: string[] | undefined;
    let conversation: TChatConversation | undefined;
    try {
      const db = getDatabase();
      const convResult = db.getConversation(conversation_id);
      if (convResult.success && convResult.data) {
        conversation = convResult.data;
        presetContext = conversation.extra?.presetContext;
        enabledSkills = await resolveLatestConversationEnabledSkills(conversation);
      }
    } catch {
      // ignore
    }

    // Ensure workspace skills symlinks exist before dispatching to the gateway.
    // syncConversationWorkspaceSkills is idempotent — it skips symlinks that are already correct.
    await syncConversationWorkspaceSkills(conversation, other.skills);

    try {
      // Build the unified payload for both ACP and OpenClaw agents
      const payload: { content: string; agentContent?: string; files: string[]; msg_id: string; skills?: string[] } = {
        content: other.input,
        files: workspaceFiles,
        msg_id: other.msg_id,
        skills: other.skills || [],
      };

      // OpenClaw-specific: inject preset rules, skills content and workspace hints into agentContent
      if (task.type === 'openclaw-gateway') {
        let agentContent = other.input;

        const skillsToInject = other.skills?.length ? other.skills : enabledSkills;
        // Use prepareOpenClawFirstMessage — openclaw agents have a file read tool and must
        // read SKILL.md directly. prepareFirstMessageWithSkillsIndex injects [LOAD_SKILL:]
        // which is a Gemini-only protocol that openclaw doesn't support.
        agentContent = await prepareOpenClawFirstMessage(agentContent, {
          presetContext,
          enabledSkills: skillsToInject,
        });
        const skillsDir = resolveWorkspaceSkillsDir(conversation);
        if (skillsDir) {
          // Read the actual symlinked skill names from disk — the directory is the
          // source of truth for what the agent can use (may include more skills than
          // the stored enabledSkills list when no filter is applied).
          const linkedSkillNames = await fs
            .readdir(skillsDir, { withFileTypes: true })
            .then((entries) =>
              entries
                .filter((e) => e.isSymbolicLink() || e.isDirectory())
                .map((e) => e.name)
                .sort()
            )
            .catch(() => skillsToInject ?? []);
          agentContent = await injectSkillsDirectoryHint(agentContent, skillsDir, linkedSkillNames);
        }

        if (workspaceFiles.length > 0 && (task as OpenClawAgent).workspace) {
          const hint = `[Context: 用户工作区为 ${(task as OpenClawAgent).workspace}。下方 @ 引用的文件来自该工作区。当用户询问「这个文件夹」「这里有什么文件」时，请基于这些附加文件回答，而非你的默认工作区。]\n\n`;
          agentContent = hint + agentContent;
        }
        payload.agentContent = agentContent;
      }

      mainLog('conversationBridge', `sendMessage: about to call task.sendMessage for ${conversation_id}`);
      await task.sendMessage(payload);
      mainLog('conversationBridge', `sendMessage: task.sendMessage completed for ${conversation_id}`);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  // 通用 confirmMessage 实现
  ipcBridge.conversation.confirmation.confirm.provider(async ({ conversation_id, msg_id, data, callId }) => {
    const task = WorkerManage.getTaskById(conversation_id);
    if (!task) return { success: false, msg: 'conversation not found' };
    task.confirm(msg_id, callId, data);
    return { success: true };
  });
  ipcBridge.conversation.confirmation.list.provider(async ({ conversation_id }) => {
    const task = WorkerManage.getTaskById(conversation_id);
    if (!task) return [];
    return task.getConfirmations();
  });

  // Session-level approval memory — now only relevant for ACP agents
  ipcBridge.conversation.approval.check.provider(async ({ conversation_id, action, commandType }) => {
    // Approval checking is handled by ACP agents internally now
    return false;
  });
}
