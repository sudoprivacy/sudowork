/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import type { IDirOrFile, MossSessionAvailableSkill, MossWorkspaceNode } from '@sudowork/host-bridge/ipcBridge';
import type { TChatConversation } from '@sudowork/common/storage';
import { shouldSyncWorkspaceSkills } from '@sudowork/common/utils/workspaceSkillSync';
import { getDatabase } from '@process/database';
import { mainError, mainLog, mainWarn } from '@process/utils/mainLogger';
import { setupChannelResponseRouting } from '@/channels/agent/ChannelResponseRouter';
import { getSudoworkAcpSlashCommands } from '@/common/slash/sudoworkCommands';
import { isEnterpriseMode } from '@/common/enterpriseDebugConfig';
import { uuid } from '@common/utils';
import { ipcBridge } from '../../common';
import { getSkillsDir, ProcessChat, ProcessConfig } from '../initStorage';
import type AcpAgent from '../task/AcpAgent';
import type RemoteAgent from '../task/RemoteAgent';
import { listWorkspaceSkillTargets, resolveConversationEnabledSkillNames } from '../utils/workspaceSkillTargets';
import { areSkillSelectionsEqual, resolveLatestConversationEnabledSkills } from '../utils/conversationAssistantSkills';
import { filterEnabledSkillNames, filterRemoteAvailableSkills } from '../utils/enabledSkillFilter';
import { copyFilesToDirectory, readDirectoryRecursive } from '../utils';
import { resolveWorkspaceSkillsDir } from '../utils/workspaceSkillsDir';
import { INTERMEDIATE_DIR_SEGMENTS } from '../task/FileIntentClassifier';
import WorkerManage from '../WorkerManage';
import { skillManager } from '../SkillManager';
import { ConversationManageWithDB } from '../message';
import { getConversationProvider, isRemoteProvider } from '../providers';
import { getMossApi, getMossApiServerUrl, initMossApi } from '../remote/MossSessionApi';
import { turnInputCoordinator } from '../task/turnInputCoordinator';
import { reapConversation } from '../services/conversationReaper';
import { closeBrowserTabsByConversation } from './browserPanelBridge';
import { closeTerminalsByConversation } from './terminalBridge';
import { migrateConversationToDatabase } from './migrationUtils';

const workspaceSkillSyncTasks = new Map<string, Promise<void>>();

// Emit the current input-queue snapshot to the renderer. The process (turnInputCoordinator)
// is the SSOT; the renderer only reflects this for the queue chips.
const emitInputQueue = (conversation_id: string) => (queue: Array<{ id: string; content: string }>) => {
  ipcBridge.conversation.inputQueueUpdate.emit({
    conversation_id,
    queue: queue.map((q) => ({ id: q.id, preview: (q.content || '').slice(0, 120) })),
  });
};

type RemoteConversationExtra = NonNullable<TChatConversation['extra']> & {
  mossSessionId?: string;
  mossSessionPending?: boolean;
  mossServerUrl?: string;
  authToken?: string;
};

function convertMossWorkspaceNode(node: MossWorkspaceNode): IDirOrFile {
  return {
    name: node.name,
    fullPath: node.fullPath,
    relativePath: node.relativePath,
    isDir: node.isDir,
    isFile: node.isFile,
    children: node.children?.map(convertMossWorkspaceNode),
  };
}

function getRemoteConversationSession(conversationId: string): { conversation: TChatConversation; extra: RemoteConversationExtra; mossSessionId?: string; pending: boolean } {
  const db = getDatabase();
  const result = db.getConversation(conversationId);
  if (!result.success || !result.data) {
    throw new Error('conversation not found');
  }

  const conversation = result.data;
  if (conversation.type !== 'remote-agent') {
    throw new Error('conversation is not remote-agent');
  }

  const extra = (conversation.extra ?? {}) as RemoteConversationExtra;
  const mossSessionId = extra.mossSessionId;
  return {
    conversation,
    extra,
    mossSessionId,
    pending: Boolean(extra.mossSessionPending || !mossSessionId),
  };
}

function getRemoteConversationMossApi(extra: RemoteConversationExtra) {
  const serverUrl = extra.mossServerUrl;
  if (!serverUrl) {
    throw new Error('Moss Server URL not configured');
  }

  const currentApi = getMossApi();
  const api = currentApi && getMossApiServerUrl() === serverUrl ? currentApi : initMossApi(serverUrl);
  // Seed only non-JWT credentials (API keys). A JWT pinned in the conversation
  // record may be expired or revoked (issue #849); without an explicit token
  // the API sources the current one via getValidToken.
  if (extra.authToken && !extra.authToken.startsWith('eyJ')) {
    api.setAccessToken(extra.authToken);
  }
  return api;
}

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

  // Convert skill IDs (UUID) to skill names for workspace skill matching
  // enabledSkills stores UUIDs, but listWorkspaceSkillTargets expects skill directory names
  const rawAllowedSkillIds = resolveConversationEnabledSkillNames(conversation, requestedSkillNames);
  let allowedSkillNames: Set<string> | undefined = undefined;

  if (rawAllowedSkillIds && rawAllowedSkillIds.size > 0) {
    // Build ID → name mapping from installed skills
    const installedSkills = await skillManager.getInstalledSkills();
    const idToNameMap = new Map<string, string>();
    const shouldFilterDisabledSkills = isEnterpriseMode();
    for (const skill of installedSkills) {
      if (shouldFilterDisabledSkills && skill.enabled === false) continue;
      // Map by skill ID (UUID)
      if (skill.meta?.id) {
        idToNameMap.set(skill.meta.id, skill.name);
      }
      // Also support direct name matching (for legacy data or builtin skills without ID)
      idToNameMap.set(skill.name, skill.name);
    }

    // Convert UUIDs to names
    allowedSkillNames = new Set<string>();
    for (const skillId of rawAllowedSkillIds) {
      const skillName = idToNameMap.get(skillId);
      if (skillName) {
        allowedSkillNames.add(skillName);
      } else {
        // Skill not found locally - may not be installed yet
        mainWarn('ConversationSkillSync', `Skill "${skillId}" not found in installed skills, skipping`);
      }
    }
  }

  const expectedTargets = await listWorkspaceSkillTargets(getSkillsDir(), allowedSkillNames);
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

  let failedCount = 0;
  for (const [skillName, targetDir] of expectedTargets) {
    if (existingNames.has(skillName)) continue;
    const linkPath = path.join(workspaceSkillsDir, skillName);
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    try {
      await fs.symlink(targetDir, linkPath, linkType);
      createdCount++;
    } catch (error) {
      // Isolate per-skill failures: a single failed link (e.g. EPERM creating a
      // Windows junction on a restricted/OneDrive-synced home dir) must not abort
      // the whole loop and leave the workspace with zero linked skills — which is
      // what makes builtins like `browser` silently invisible to the agent.
      failedCount++;
      mainWarn('ConversationSkillSync', `Failed to link skill "${skillName}" (${linkType}) into workspace`, error);
    }
  }

  mainLog('ConversationSkillSync', 'syncConversationWorkspaceSkills completed', {
    conversationId: conversation?.id,
    workspace,
    expectedCount: expectedTargets.size,
    existingCount: existingEntries.length,
    removedCount,
    recreatedCount,
    createdCount,
    failedCount,
    durationMs: Date.now() - startedAt,
  });
}

export function queueConversationWorkspaceSkillSync(conversation: TChatConversation | undefined, requestedSkillNames?: string[]): Promise<void> {
  if (!shouldSyncWorkspaceSkills(conversation, requestedSkillNames)) {
    return Promise.resolve();
  }

  const workspace = conversation.extra.workspace;
  const previousTask = workspaceSkillSyncTasks.get(workspace) ?? Promise.resolve();
  const task = previousTask.then(
    async () => {
      await syncConversationWorkspaceSkills(conversation, requestedSkillNames);
    },
    async () => {
      await syncConversationWorkspaceSkills(conversation, requestedSkillNames);
    }
  );

  workspaceSkillSyncTasks.set(workspace, task);

  return task.finally(() => {
    if (workspaceSkillSyncTasks.get(workspace) === task) {
      workspaceSkillSyncTasks.delete(workspace);
    }
  });
}

function ensureConversationWorkspaceSkillSync(conversation: TChatConversation | undefined): Promise<void> {
  if (!shouldSyncWorkspaceSkills(conversation)) {
    return Promise.resolve();
  }

  const existingTask = workspaceSkillSyncTasks.get(conversation.extra.workspace);
  if (existingTask) {
    return existingTask;
  }

  return queueConversationWorkspaceSkillSync(conversation);
}

function scheduleConversationWorkspaceSkillSync(conversation: TChatConversation | undefined): void {
  if (!shouldSyncWorkspaceSkills(conversation)) return;
  const workspace = conversation.extra.workspace;

  mainLog('ConversationSkillSync', 'scheduleConversationWorkspaceSkillSync queued', {
    conversationId: conversation?.id,
    workspace,
    hasPendingTask: workspaceSkillSyncTasks.has(workspace),
  });

  void ensureConversationWorkspaceSkillSync(conversation)
    .catch((error) => {
      mainWarn('ConversationSkillSync', 'Failed to sync workspace skills', error);
    })
    .finally(() => {
      mainLog('ConversationSkillSync', 'scheduleConversationWorkspaceSkillSync finished', {
        conversationId: conversation?.id,
        workspace,
      });
    });
}

export function initConversationBridge(): void {
  ipcBridge.conversation.create.provider(async (params): Promise<TChatConversation> => {
    // Use Provider abstraction layer for conversation creation
    // 使用 Provider 抽象层创建会话
    mainLog('conversationBridge', `Creating conversation: type=${params.type}, name=${params.name}`);

    // Read sessionMode from extra.sessionModeParam (rendered process passes it explicitly)
    // 从 extra.sessionModeParam 读取 sessionMode（渲染进程显式传递）
    const sessionMode = params.extra?.sessionModeParam as 'remote' | 'local' | undefined;

    // Enterprise mode Remote session: force remote-agent type for all conversations
    // 企业模式 Remote 会话：强制使用 remote-agent 类型
    // Local session in enterprise mode should NOT be forced to remote-agent
    // 企业模式 Local 会话不应强制为 remote-agent
    let finalParams = params;
    if (isRemoteProvider(sessionMode) && params.type !== 'remote-agent') {
      mainLog('conversationBridge', `Enterprise remote mode: forcing remote-agent type`);
      finalParams = { ...params, type: 'remote-agent' };
    }

    const provider = getConversationProvider(sessionMode);
    const conversation = await provider.createConversation(finalParams);

    mainLog('conversationBridge', `Conversation created successfully: id=${conversation.id}`);

    scheduleConversationWorkspaceSkillSync(conversation);

    return conversation;
  });

  // Reload context is not supported for ACP agents
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

      await ensureConversationWorkspaceSkillSync(result.data);
      return { success: true };
    } catch (error) {
      mainError('conversationBridge', 'Failed to sync workspace skills:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.conversation.remove.provider(async ({ id, deleteWorkspace }) => {
    try {
      // Route all cleanup through the reaper SSOT so every resource this
      // conversation owns is released in one ordered, DRY path.
      const res = await reapConversation(id, { reason: 'user-delete', deleteWorkspace });
      return res.dbDeleted;
    } catch (error) {
      mainError('conversationBridge', 'Failed to remove conversation:', error);
      return false;
    }
  });

  ipcBridge.conversation.update.provider(async ({ id, updates, mergeExtra }: { id: string; updates: Partial<TChatConversation>; mergeExtra?: boolean }) => {
    try {
      // Check for model change (local mode only) / 检查模型变更（仅本地模式）
      const db = getDatabase();
      const existing = db.getConversation(id);
      const prevModel = existing.success && existing.data && 'model' in existing.data ? existing.data.model : undefined;
      const nextModel = 'model' in updates ? updates.model : undefined;
      const modelChanged = !!nextModel && JSON.stringify(prevModel) !== JSON.stringify(nextModel);

      // Use Provider abstraction layer / 使用 Provider 抽象层
      const provider = getConversationProvider();
      const success = await provider.updateConversation(id, updates, mergeExtra);

      // If model changed, kill running task to force rebuild with new model on next send
      // 如果模型变更，终止运行中的任务以在下次发送时强制重建
      if (success && modelChanged) {
        try {
          WorkerManage.kill(id);
        } catch {
          // ignore kill error, will lazily rebuild later / 忽略终止错误，稍后延迟重建
        }
      }

      return success;
    } catch (error) {
      mainError('conversationBridge', 'Failed to update conversation:', error);
      return false;
    }
  });

  ipcBridge.conversation.reset.provider(({ id }) => {
    if (id) {
      WorkerManage.kill(id);
    } else {
      void WorkerManage.clear();
    }
    return Promise.resolve();
  });

  ipcBridge.conversation.get.provider(async ({ id }): Promise<TChatConversation | undefined> => {
    try {
      // Use Provider abstraction layer / 使用 Provider 抽象层
      const provider = getConversationProvider();
      const conversation = await provider.getConversation(id);

      if (conversation) {
        // Update status from running task / 从运行中的任务更新状态
        const task = WorkerManage.getTaskById(id);
        const taskStatus = task?.status === 'idle' ? 'finished' : task?.status;
        conversation.status = taskStatus || 'finished';
        // Update processingStartTime from running task / 从运行中的任务更新处理开始时间
        conversation.processingStartTime = task?.processingStartTime;
      }

      return conversation;
    } catch (error) {
      mainError('conversationBridge', 'Failed to get conversation:', error);
      return undefined;
    }
  });

  // Get the last emitted connection status for an agent
  // Uses cache-only lookup (getTaskById) — no side effects, no bootstrapping
  ipcBridge.conversation.getConnectionStatus.provider(async ({ conversation_id }) => {
    try {
      const task = WorkerManage.getTaskById(conversation_id) as AcpAgent | undefined;
      if (!task || typeof (task as any).lastConnectionStatus === 'undefined') {
        return { success: true, data: { status: null } };
      }
      return { success: true, data: { status: (task as any).lastConnectionStatus as string | null } };
    } catch {
      return { success: true, data: { status: null } };
    }
  });

  // Restart the underlying agent/ACP connection and reconnect
  // Disconnects current connection, clears bootstrap, then re-initializes
  ipcBridge.conversation.restartAndConnect.provider(async ({ conversation_id }) => {
    try {
      const task = WorkerManage.getTaskById(conversation_id);
      if (!task) return { success: false, msg: 'conversation not found' };

      // Both ACP (local) and remote-agent (enterprise/Moss) tasks expose
      // restartAndConnect to recover a dead connection (e.g. socket hang up
      // after the laptop wakes from sleep).
      if (task.type === 'acp' || task.type === 'remote-agent') {
        await (task as AcpAgent | RemoteAgent).restartAndConnect();
        return { success: true };
      }

      return { success: false, msg: 'unsupported conversation type' };
    } catch (error) {
      mainWarn('[conversationBridge]', 'restartAndConnect failed:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Abort controller for workspace reads: each new request aborts the previous one
  // to avoid stale results when the user navigates quickly.
  let lastGetWorkspaceAbortController: AbortController | undefined;

  // Intermediate-directory ignore: paths whose path contains any segment in
  // INTERMEDIATE_DIR_SEGMENTS (e.g. ppt_outputs/, _tmp/) are hidden from the
  // workspace tree. Matches whole path segments only — `my_ppt_outputs.md`
  // won't be hidden, but `ppt_outputs/p1.jpg` will.
  const intermediateSegmentRe = new RegExp(`(^|[/\\\\])(${[...INTERMEDIATE_DIR_SEGMENTS].join('|')})([/\\\\]|$)`);

  ipcBridge.conversation.getWorkspace.provider(async ({ workspace, search, path }) => {
    // Abort any in-flight workspace read
    lastGetWorkspaceAbortController?.abort();
    lastGetWorkspaceAbortController = new AbortController();

    // Simple file filter that skips common non-essential directories
    const fileService = { shouldIgnoreFile: (p: string) => p.includes('node_modules') || p.includes('.git') || intermediateSegmentRe.test(p) };
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

  ipcBridge.conversation.getRemoteWorkspace.provider(async ({ conversation_id, search, path: relativePath }) => {
    try {
      const { extra, mossSessionId, pending } = getRemoteConversationSession(conversation_id);
      if (pending || !mossSessionId) {
        return { success: true, data: { files: [], pending: true } };
      }

      const api = getRemoteConversationMossApi(extra);
      const root = await api.getSessionWorkspaceTree(mossSessionId, {
        path: relativePath,
        search: search || undefined,
      });
      return { success: true, data: { files: [convertMossWorkspaceNode(root)], pending: false } };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      mainWarn('conversationBridge', 'getRemoteWorkspace failed:', msg);
      return { success: false, msg, data: { files: [], pending: false } };
    }
  });

  ipcBridge.conversation.previewRemoteWorkspaceFile.provider(async ({ conversation_id, path: relativePath }) => {
    try {
      const { extra, mossSessionId, pending } = getRemoteConversationSession(conversation_id);
      if (pending || !mossSessionId) {
        return { success: false, msg: 'Moss session is pending' };
      }

      const api = getRemoteConversationMossApi(extra);
      const preview = await api.getSessionWorkspaceFile(mossSessionId, { path: relativePath });
      return { success: true, data: preview };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      mainWarn('conversationBridge', 'previewRemoteWorkspaceFile failed:', msg);
      return { success: false, msg };
    }
  });

  // Remote counterpart of fs.copyFilesToWorkspace: reads local source files and
  // uploads their bytes into the Moss session's server-side workspace. Returns
  // the same { copiedFiles, failedFiles } shape so the renderer paste/drag/add
  // flows can branch on dataSource without other changes.
  ipcBridge.conversation.copyFilesToRemoteWorkspace.provider(async ({ conversation_id, filePaths, targetDir, sourceRoot }) => {
    try {
      const { extra, mossSessionId, pending } = getRemoteConversationSession(conversation_id);
      if (pending || !mossSessionId) {
        return { success: false, msg: 'Moss session is pending' };
      }
      const api = getRemoteConversationMossApi(extra);

      const copiedFiles: string[] = [];
      const failedFiles: Array<{ path: string; error: string }> = [];

      // Fetch the current upload limit fresh (per upload batch) so an admin
      // change on the Moss server is picked up immediately; fall back to 20MB
      // if it can't be read. The server enforces the same limit regardless.
      let uploadLimitBytes = 20 * 1024 * 1024;
      try {
        const fetched = await api.getWorkspaceUploadLimitBytes();
        if (typeof fetched === 'number' && fetched > 0) {
          uploadLimitBytes = fetched;
        }
      } catch (error) {
        mainWarn('conversationBridge', 'Failed to fetch upload limit, using default:', error);
      }
      const limitMb = Math.round(uploadLimitBytes / (1024 * 1024));

      const normalizeRelative = (p: string) => p.split(path.sep).join('/').replace(/^\/+/, '');
      const prefix = targetDir ? normalizeRelative(targetDir).replace(/\/+$/, '') : '';

      for (const filePath of filePaths) {
        try {
          // Pre-check size against the fresh limit so the user gets a specific
          // message without a wasted upload.
          const stat = await fs.stat(filePath);
          if (stat.size > uploadLimitBytes) {
            failedFiles.push({ path: filePath, error: `Uploaded file exceeds size limit (${limitMb}MB)` });
            continue;
          }
          const relInsideRoot = sourceRoot ? path.relative(sourceRoot, filePath) : path.basename(filePath);
          const rel = normalizeRelative(prefix ? path.posix.join(prefix, normalizeRelative(relInsideRoot)) : relInsideRoot);
          const buffer = await fs.readFile(filePath);
          const result = await api.uploadSessionWorkspaceFile(mossSessionId, {
            path: rel,
            contentBase64: buffer.toString('base64'),
          });
          copiedFiles.push(result.relativePath || rel);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          mainError('conversationBridge', `Failed to upload file ${filePath} to remote workspace:`, message);
          failedFiles.push({ path: filePath, error: message });
        }
      }

      const success = failedFiles.length === 0;
      return { success, data: { copiedFiles, failedFiles }, msg: success ? undefined : 'Some files failed to upload' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      mainError('conversationBridge', 'copyFilesToRemoteWorkspace failed:', msg);
      return { success: false, msg };
    }
  });

  ipcBridge.conversation.getRemoteAvailableSkills.provider(async ({ conversation_id }) => {
    try {
      const { extra, mossSessionId, pending } = getRemoteConversationSession(conversation_id);
      if (pending || !mossSessionId) {
        return { success: true, data: { skills: [], pending: true } };
      }

      const api = getRemoteConversationMossApi(extra);
      const skills: MossSessionAvailableSkill[] = await api.getSessionAvailableSkills(mossSessionId);
      const filteredSkills = await filterRemoteAvailableSkills(skills);
      return { success: true, data: { skills: filteredSkills, pending: false } };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      mainWarn('conversationBridge', 'getRemoteAvailableSkills failed:', msg);
      return { success: false, msg, data: { skills: [], pending: false } };
    }
  });

  ipcBridge.conversation.stop.provider(async ({ conversation_id }) => {
    const task = WorkerManage.getTaskById(conversation_id);
    if (!task) return { success: true, msg: 'conversation not found' };
    if (task.type !== 'acp' && task.type !== 'remote-agent') {
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

      const conversation = convResult.data;
      if (conversation.type === 'remote-agent') {
        return { success: true, data: { commands: getSudoworkAcpSlashCommands() } };
      }

      if (conversation.type !== 'acp') {
        return { success: true, data: { commands: [] } };
      }

      const task = WorkerManage.getTaskById(conversation_id) as AcpAgent | undefined;
      if (!task || task.type !== 'acp') {
        return { success: true, data: { commands: getSudoworkAcpSlashCommands() } };
      }

      const commands = await task.loadAcpSlashCommands();
      return { success: true, data: { commands: [...getSudoworkAcpSlashCommands(), ...commands] } };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // 通用 sendMessage 实现 - 自动根据 conversation 类型分发
  ipcBridge.conversation.sendMessage.provider(async ({ conversation_id, files, ...other }) => {
    mainLog('conversationBridge', `sendMessage called: conversation_id=${conversation_id}, msg_id=${other.msg_id}`);

    // A7 guard: team member conversations must go through the team API, not the single-chat API.
    const teamGuardConv = getDatabase().getConversation(conversation_id);
    const teamGuardData = teamGuardConv.success ? teamGuardConv.data : undefined;
    if (teamGuardData && teamGuardData.type === 'acp' && teamGuardData.extra?.isTeamMember) {
      return { success: false, msg: 'Team member conversations must use the team API' };
    }

    let task: AcpAgent | import('../task/RemoteAgent').default | undefined;
    try {
      task = (await WorkerManage.getTaskByIdRollbackBuild(conversation_id)) as AcpAgent | import('../task/RemoteAgent').default | undefined;
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

    // Download bdpan:// files to workspace before copying
    const workspace = (task as any).workspace ?? '';
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
              } catch {
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

    // Remote-agent (enterprise/moss) sessions have no usable local workspace —
    // `workspace` is empty, so copyFilesToDirectory would resolve to the
    // packaged app's read-only cwd and fail (EROFS), dropping the attachment.
    // Pass the original local paths straight through; RemoteAgent.sendMessage
    // uploads them into the moss session's server-side workspace and rewrites
    // them to workspace-relative `@` refs. Local agents keep the copy-to-cwd path.
    const workspaceFiles = task.type === 'remote-agent' ? filesToProcess : await copyFilesToDirectory(workspace, filesToProcess, false);

    let conversation: TChatConversation | undefined;
    try {
      const db = getDatabase();
      const convResult = db.getConversation(conversation_id);
      if (convResult.success && convResult.data) {
        conversation = convResult.data;
      }
    } catch {
      // ignore
    }

    const requestedSkills = await filterEnabledSkillNames(other.skills);

    // Ensure workspace skills symlinks exist before dispatching to the gateway.
    // syncConversationWorkspaceSkills is idempotent — it skips symlinks that are already correct.
    await queueConversationWorkspaceSkillSync(conversation, requestedSkills);

    try {
      const payload: { content: string; agentContent?: string; files: string[]; msg_id: string; skills?: string[] } = {
        content: other.input,
        files: workspaceFiles,
        msg_id: other.msg_id,
        skills: requestedSkills || [],
      };

      mainLog('conversationBridge', `sendMessage: about to call task.sendMessage for ${conversation_id}`);

      // Set up channel response routing if conversation source is a channel type
      if (conversation) {
        setupChannelResponseRouting(conversation);
      }

      // Local (ACP) interactive path routes through the turn-input coordinator so a new
      // message can interrupt or queue against an in-flight turn (settings-gated). The
      // coordinator returns at accept/queue time (not turn end) — safe because the
      // renderer drives turn lifecycle + errors via the response stream, not this result.
      // See docs/plans/2026-07-01-conversation-interrupt-and-queue.html.
      if (task.type === 'acp') {
        const autoInterrupt = (await ProcessConfig.get('agent.autoInterrupt').catch(() => false)) === true;
        const messageQueue = (await ProcessConfig.get('agent.messageQueue').catch(() => true)) !== false;
        const status = turnInputCoordinator.submit(
          conversation_id,
          {
            id: payload.msg_id,
            content: payload.content,
            // Batched flush (§3.2): when the coordinator flushes N queued items at turn-end,
            // it hands the tail (N-1 items) to this head. We merge their text into the head's
            // user message so exactly ONE session/prompt goes out for the whole batch. Only
            // text is merged — tail items are text-only in practice (queued sends without
            // attachments); their `files`/`skills` slots are not exposed to the coordinator.
            run: (tail) => {
              if (!tail || tail.length === 0) return task.sendMessage(payload);
              const combined = [payload.content, ...tail.map((t) => t.content)].join('\n\n');
              return task.sendMessage({ ...payload, content: combined });
            },
          },
          () => task.stop(),
          { autoInterrupt, messageQueue },
          emitInputQueue(conversation_id)
        );
        mainLog('conversationBridge', `sendMessage: coordinator status=${status} for ${conversation_id}`);
        return status === 'busy' ? { success: false, msg: 'busy' } : { success: true };
      }

      try {
        await task.sendMessage(payload);
        mainLog('conversationBridge', `sendMessage: task.sendMessage completed for ${conversation_id}`);
      } finally {
        // Listener will self-cleanup on 'finish' event
      }
      return { success: true };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      mainError('conversationBridge', `sendMessage failed for ${conversation_id}: ${errorMessage}`, err);
      return { success: false, msg: errorMessage };
    }
  });

  // Pull the last (or a specific) queued input back out — Up-arrow in the sendbox.
  // Removes it from the coordinator (SSOT) and returns its content for the editor.
  ipcBridge.conversation.dequeueInput.provider(async ({ conversation_id, id }) => {
    const removed = turnInputCoordinator.dequeue(conversation_id, id, emitInputQueue(conversation_id));
    if (!removed) return { success: true, data: null };
    return { success: true, data: { content: removed.content } };
  });

  // 通用 confirmMessage 实现
  ipcBridge.conversation.confirmation.confirm.provider(async ({ conversation_id, msg_id, data, callId }) => {
    // A7 guard: team member conversations must go through the team API, not the single-chat API.
    const confirmGuardConv = getDatabase().getConversation(conversation_id);
    const confirmGuardData = confirmGuardConv.success ? confirmGuardConv.data : undefined;
    if (confirmGuardData && confirmGuardData.type === 'acp' && confirmGuardData.extra?.isTeamMember) {
      return { success: false, msg: 'Team member conversations must use the team API' };
    }
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
    console.log(conversation_id, action, commandType);
    return false;
  });

  // Flush all pending messages to database immediately
  ipcBridge.conversation.flushPendingMessages.provider(async ({ conversation_id }) => {
    try {
      await ConversationManageWithDB.get(conversation_id).flushNow();
      return Promise.resolve();
    } catch (error) {
      mainError('conversationBridge', 'Error flushing pending messages:', error);
      return Promise.resolve();
    }
  });

  // Add a single message to the database (used for saving pending messages before unmount)
  ipcBridge.conversation.addMessage.provider(async ({ conversation_id, message }) => {
    try {
      ConversationManageWithDB.get(conversation_id).sync('insert', message);
      return Promise.resolve();
    } catch (error) {
      mainError('conversationBridge', 'Error adding message:', error);
      return Promise.resolve();
    }
  });

  // Sync messages from Moss Server to local DB (enterprise mode, triggered on conversation click)
  ipcBridge.conversation.syncMessages.provider(async ({ conversation_id }) => {
    try {
      const provider = getConversationProvider();
      if (provider.type !== 'remote' || !provider.syncFromMossServer) {
        return { success: true, data: { syncedCount: 0, nameUpdated: false } };
      }

      const result = await provider.syncFromMossServer(conversation_id);

      if (result.nameUpdated) {
        ipcBridge.database.conversationChanged.emit({
          conversationId: conversation_id,
          source: 'sudowork',
          action: 'updated',
        });
      }

      return { success: true, data: result };
    } catch (error) {
      mainError('conversationBridge', 'Error syncing messages from Moss Server:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error), data: { syncedCount: 0, nameUpdated: false } };
    }
  });
}
