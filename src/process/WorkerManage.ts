/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/storage';
import AcpAgent from './task/AcpAgent';
import OpenClawAgent from './task/OpenClawAgent';
import RemoteAgent from './task/RemoteAgent';
import { ProcessChat } from './initStorage';
import type AgentBaseTask from './task/BaseAgent';
import { getDatabase } from './database/export';
import { mainLog, mainError } from '@process/utils/mainLogger';

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
      const mossServerUrl = extra?.mossServerUrl || 'http://127.0.0.1:43127';
      const authToken = extra?.authToken || '';
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
        sessionId: wsUrl ? mossSessionId || conversation.id : undefined,
        // Lazy creation: pass mossSessionPending flag
        // 延迟创建：传递 mossSessionPending 标志
        mossSessionPending,
      });

      if (!options?.skipCache) {
        taskList.push({ id: conversation.id, task });
      }
      return task;
    }
    case 'acp': {
      // Local ACP agent / 本地 ACP Agent
      const task = new AcpAgent({
        ...conversation.extra,
        conversation_id: conversation.id,
        // Runtime options / 运行时选项
        yoloMode: options?.yoloMode,
      });
      if (!options?.skipCache) {
        taskList.push({ id: conversation.id, task });
      }
      return task;
    }
    case 'openclaw-gateway': {
      // Try to get model from multiple sources (priority: openclawModelId > runtimeValidation > model)
      const modelFromOpenClawModelId = (conversation.extra as any).openclawModelId;
      const modelFromRuntimeValidation = (conversation.extra as any).runtimeValidation?.expectedModel;
      const modelFromConfig = (conversation.extra as any).model;

      const task = new OpenClawAgent({
        ...conversation.extra,
        conversation_id: conversation.id,
        // Extract model: prefer openclawModelId (per-conversation), then runtimeValidation, then model
        model: modelFromOpenClawModelId || modelFromRuntimeValidation || modelFromConfig,
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
    task.task.kill();
  }
  taskList.splice(index, 1);
};

const clear = () => {
  taskList.forEach((item) => {
    item.task.kill();
  });
  taskList.length = 0;
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

/** Send SIGUSR1 to the ServiceManager-owned Sudoclaw gateway for hot-reload (skills) */
const reloadOpenClawSkills = async (): Promise<void> => {
  const { serviceManager } = await import('./services/serviceManager');
  serviceManager.sendReloadSignal();
};

/** Restart the Sudoclaw gateway (via ServiceManager) and reconnect all agent WebSockets */
const restartOpenClawGateways = async (): Promise<void> => {
  const { serviceManager } = await import('./services/serviceManager');
  await serviceManager.restartOpenClaw();
  // restartOpenClaw() already calls reconnectOpenClawAgents()
};

/** Reconnect all active openclaw-gateway agents' WebSocket connections (no gateway restart) */
const reconnectOpenClawAgents = (): void => {
  const openclawTasks = taskList.filter((item) => item.task.type === 'openclaw-gateway');
  for (const { id, task } of openclawTasks) {
    const agent = task as OpenClawAgent;
    agent
      .restartGateway()
      .then(() => {
        mainLog('WorkerManage', 'Reconnected OpenClaw agent for', id);
      })
      .catch((err) => {
        mainError('WorkerManage', `Failed to reconnect OpenClaw agent for ${id}`, err);
      });
  }
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
  reloadOpenClawSkills,
  restartOpenClawGateways,
  reconnectOpenClawAgents,
};

export default WorkerManage;
