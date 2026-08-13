/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/storage';
import { isAcpBackendRuntimeEnabled, normalizeLegacyAcpConversationState } from '@/types/acpTypes';
import { mainLog, mainError } from '@process/utils/mainLogger';
import AcpAgent from './task/AcpAgent';
import RemoteAgent from './task/RemoteAgent';
import { ProcessChat, ProcessConfig } from './initStorage';
import type AgentBaseTask from './task/BaseAgent';
import { getDatabase } from './database/export';

const taskList: {
  id: string;
  task: AgentBaseTask<unknown>;
}[] = [];

/**
 * Runtime options for building conversations
 * Used by cron jobs to force yoloMode
 */
export interface BuildConversationOptions {
  /** Force yolo mode (auto-approve all tool calls) */
  yoloMode?: boolean;
  /** Skip task cache - create a new isolated instance */
  skipCache?: boolean;
}

const getTaskById = (id: string) => {
  return taskList.find((item) => item.id === id)?.task;
};

const buildConversation = (conversation: TChatConversation, options?: BuildConversationOptions) => {
  // If not skipping cache, check for existing task
  if (!options?.skipCache) {
    const task = getTaskById(conversation.id);
    if (task) {
      return task;
    }
  }

  switch (conversation.type) {
    case 'remote-agent': {
      // Enterprise mode: connect to Moss Server / 企业模式：连接 Moss Server
      const extra = conversation.extra as {
        mossServerUrl?: string;
        authToken?: string;
        username?: string;
        password?: string;
        acpWsUrl?: string;
        mossSessionId?: string;
        mossSessionPending?: boolean;
        presetAssistantId?: string;
        agentName?: string;
        dangerouslySkipPermissions?: boolean;
        runtimeType?: 'host' | 'docker';
      };

      // Moss Server URL must be configured in enterprise settings
      // Moss Server URL 必须在企业设置中配置
      // Do NOT use hardcoded default value - read from enterprise config instead
      // 不使用硬编码默认值 - 从企业配置读取
      const mossServerUrl = extra?.mossServerUrl;
      if (!mossServerUrl) {
        mainError('WorkerManage', 'Moss Server URL not configured for remote-agent conversation');
        return null;
      }

      // A conversation can only be resumed against the server that owns its
      // session. Resuming a server1 conversation while logged into server2
      // would send server2 credentials to server1 — fail explicitly instead
      // of producing an opaque 401 loop.
      try {
        const currentServerUrl = ProcessConfig.getSync('eeclaw.serverUrl');
        const normalize = (u: string) => u.replace(/\/+$/, '');
        if (currentServerUrl && normalize(currentServerUrl) !== normalize(mossServerUrl)) {
          mainError('WorkerManage', `Conversation ${conversation.id} belongs to ${mossServerUrl} but the current enterprise server is ${currentServerUrl}; switch back to resume it`);
          return null;
        }
      } catch {
        /* ignore — no enterprise config available */
      }

      // JWTs are never sourced from the conversation record: a token pinned at
      // creation time outlives logins/logouts and resurfaces revoked (issue
      // #849). Always read the current auth storage; MossWsConnection
      // re-validates via getValidToken at connect time anyway. A non-JWT
      // extra.authToken is an API key and stays — it is a stable credential,
      // not a session token.
      const pinnedToken = extra?.authToken || '';
      let authToken = pinnedToken && !pinnedToken.startsWith('eyJ') ? pinnedToken : '';
      if (!authToken) {
        try {
          const authStorage = ProcessConfig.getSync('eeclaw.authStorage');
          if (authStorage?.access_token) {
            authToken = authStorage.access_token;
          }
        } catch {
          /* ignore */
        }
      }
      const wsUrl = extra?.acpWsUrl;
      const mossSessionPending = extra?.mossSessionPending;
      const mossSessionId = extra?.mossSessionId;

      const task = new RemoteAgent({
        conversation_id: conversation.id,
        workspace: conversation.extra?.workspace,
        serverUrl: mossServerUrl,
        authToken,
        username: extra?.username,
        password: extra?.password,
        assistantName: extra?.presetAssistantId || extra?.agentName,
        dangerouslySkipPermissions: options?.yoloMode ?? extra?.dangerouslySkipPermissions,
        runtimeType: extra?.runtimeType,
        yoloMode: options?.yoloMode,
        // Resume mode: use existing wsUrl and sessionId
        // 恢复模式：使用已有的 wsUrl 和 sessionId
        wsUrl,
        sessionId: mossSessionPending ? undefined : mossSessionId || conversation.id,
        // Lazy creation: pass mossSessionPending flag
        // 延迟创建：传递 mossSessionPending 标志
        mossSessionPending,
        // Enabled skills: passed for non-assistant sessions
        // When assistant is specified, Moss Server will use assistant's config
        // 启用的技能：用于非助手会话；当指定助手时，Moss Server 会使用助手配置
        enabledSkills: conversation.extra?.enabledSkills,
      });

      if (!options?.skipCache) {
        taskList.push({ id: conversation.id, task });
      }
      return task;
    }
    case 'acp': {
      // Local ACP agent / 本地 ACP Agent
      if (!isAcpBackendRuntimeEnabled(conversation.extra?.backend)) {
        mainError('WorkerManage', `ACP backend ${conversation.extra?.backend} is disabled for conversation ${conversation.id}`);
        return null;
      }
      const normalized = normalizeLegacyAcpConversationState(conversation.extra?.backend, conversation.extra?.acpSessionId);
      const persistedBackend = conversation.extra?.backend as string | undefined;
      if (persistedBackend === 'claude' || persistedBackend === 'gemini') {
        getDatabase().updateConversation(conversation.id, {
          extra: {
            ...conversation.extra,
            backend: normalized.backend,
            cliPath: undefined,
            acpSessionId: undefined,
            acpSessionUpdatedAt: undefined,
          },
        });
      }
      const task = new AcpAgent({
        ...conversation.extra,
        ...normalized,
        conversation_id: conversation.id,
        // Runtime options / 运行时选项
        yoloMode: options?.yoloMode,
      });
      if (!options?.skipCache) {
        taskList.push({ id: conversation.id, task });
      }
      return task;
    }
    default: {
      return null;
    }
  }
};

const getTaskByIdRollbackBuild = async (id: string, options?: BuildConversationOptions): Promise<AgentBaseTask<unknown>> => {
  mainLog('WorkerManage', `getTaskByIdRollbackBuild: id=${id}, options=${JSON.stringify(options)}`);

  // If not skipping cache, check for existing task
  if (!options?.skipCache) {
    const task = taskList.find((item) => item.id === id)?.task;
    if (task) {
      mainLog('WorkerManage', `Found existing task in memory for: ${id}`);
      return Promise.resolve(task);
    }
  }

  // Try to load from database first
  const db = getDatabase();
  const dbResult = db.getConversation(id);
  mainLog('WorkerManage', `Database lookup result: success=${dbResult.success}, hasData=${!!dbResult.data}`);

  if (dbResult.success && dbResult.data) {
    mainLog('WorkerManage', `Building conversation from database: ${id}`);
    return buildConversation(dbResult.data, options);
  }

  // Fallback to file storage
  const list = (await ProcessChat.get('chat.history')) as TChatConversation[] | undefined;
  const conversation = list?.find((item) => item.id === id);
  if (conversation) {
    mainLog('WorkerManage', `Building conversation from file storage: ${id}`);
    return buildConversation(conversation, options);
  }

  // Note: Enterprise mode (Moss Server) conversations are now handled by RemoteConversationProvider
  // 注意：企业模式（Moss Server）会话现在由 RemoteConversationProvider 处理
  // The Provider layer manages session creation/resume, so WorkerManage no longer needs
  // Moss fallback logic here. See src/process/providers/RemoteConversationProvider.ts
  // Provider 层管理会话创建/恢复，因此 WorkerManage 不再需要 Moss 回退逻辑
  // 参见 src/process/providers/RemoteConversationProvider.ts

  mainError('WorkerManage', 'Conversation not found in database or file storage:', id);
  return Promise.reject(new Error('Conversation not found'));
};

const kill = (id: string) => {
  const index = taskList.findIndex((item) => item.id === id);
  if (index === -1) return;
  const task = taskList[index];
  if (task) {
    void task.task.kill();
  }
  taskList.splice(index, 1);
};

const clear = async (): Promise<void> => {
  // App exit / restart cleanup. For remote-agent tasks, we explicitly DETACH
  // (disconnect the local WS only) rather than terminate — Moss server reclaims
  // idle containers/sessions per its own policy, and we don't want a graceful
  // shutdown of the desktop client to also tear down the user's server-side
  // session. Local ACP agents and any other task type fall back to kill()
  // because they own a child process that must actually exit.
  // 应用退出/重启清理：对 remote-agent 显式 detach（仅断本地 WS），不调用
  // terminateSession——服务端 idle 回收由 Moss 自己负责。其它类型仍走 kill()，
  // 因为它们拥有需要真正退出的子进程。
  const cleanupPromises = taskList.map((item) => {
    try {
      const task = item.task as AgentBaseTask<unknown> & { detach?: () => void };
      const result = task.type === 'remote-agent' && typeof task.detach === 'function' ? task.detach() : task.kill();
      return result instanceof Promise ? result : Promise.resolve();
    } catch (err) {
      mainError('WorkerManage', `Failed to clean up task ${item.id}:`, err);
      return Promise.resolve();
    }
  });
  taskList.length = 0;
  // Wait for all agent child processes to terminate.
  // This prevents orphaned scode processes on Windows when the app quits.
  await Promise.allSettled(cleanupPromises);
};

const addTask = (id: string, task: AgentBaseTask<unknown>) => {
  const existing = taskList.find((item) => item.id === id);
  if (existing) {
    existing.task = task;
  } else {
    taskList.push({ id, task });
  }
};

const listTasks = () => {
  return taskList.map((t) => ({ id: t.id, type: t.task.type }));
};

/**
 * Update workspace path for all active agents that reference the old path.
 * Called when a workspace directory is renamed to keep running agents in sync.
 * 更新所有引用旧路径的活跃 Agent 的工作空间路径。
 * 在工作空间目录重命名时调用，保持运行中的 Agent 路径同步。
 */
const updateActiveAgentWorkspace = (oldPath: string, newPath: string): number => {
  let updatedCount = 0;
  for (const item of taskList) {
    const agent = item.task as any;
    if (agent.workspace === oldPath) {
      agent.workspace = newPath;
      // Update extra.workspace if it exists (AcpAgent stores it there too)
      if (agent.extra?.workspace === oldPath) {
        agent.extra.workspace = newPath;
      }
      // Update AcpConnection workingDir if applicable
      if (agent.connection?.workingDir === oldPath) {
        agent.connection.workingDir = newPath;
      }
      updatedCount++;
      mainLog('WorkerManage', `Updated workspace path for agent ${item.id}: ${oldPath} -> ${newPath}`);
    }
  }
  return updatedCount;
};

const WorkerManage = {
  buildConversation,
  getTaskById,
  getTaskByIdRollbackBuild,
  addTask,
  listTasks,
  kill,
  clear,
  updateActiveAgentWorkspace,
};

export default WorkerManage;
