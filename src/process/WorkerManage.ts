/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/storage';
import AcpAgent from './task/AcpAgent';
import OpenClawAgent from './task/OpenClawAgent';
import { ProcessChat } from './initStorage';
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
    case 'acp': {
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
  console.log(`[WorkerManage] getTaskByIdRollbackBuild: id=${id}, options=${JSON.stringify(options)}`);

  // If not skipping cache, check for existing task
  if (!options?.skipCache) {
    const task = taskList.find((item) => item.id === id)?.task;
    if (task) {
      console.log(`[WorkerManage] Found existing task in memory for: ${id}`);
      return Promise.resolve(task);
    }
  }

  // Try to load from database first
  const db = getDatabase();
  const dbResult = db.getConversation(id);
  console.log(`[WorkerManage] Database lookup result: success=${dbResult.success}, hasData=${!!dbResult.data}`);

  if (dbResult.success && dbResult.data) {
    console.log(`[WorkerManage] Building conversation from database: ${id}`);
    return buildConversation(dbResult.data, options);
  }

  // Fallback to file storage
  const list = (await ProcessChat.get('chat.history')) as TChatConversation[] | undefined;
  const conversation = list?.find((item) => item.id === id);
  if (conversation) {
    console.log(`[WorkerManage] Building conversation from file storage: ${id}`);
    return buildConversation(conversation, options);
  }

  console.error('[WorkerManage] Conversation not found in database or file storage:', id);
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
        console.log('[WorkerManage] Reconnected OpenClaw agent for', id);
      })
      .catch((err) => {
        console.error('[WorkerManage] Failed to reconnect OpenClaw agent for', id, ':', err);
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
  reloadOpenClawSkills,
  restartOpenClawGateways,
  reconnectOpenClawAgents,
};

export default WorkerManage;
