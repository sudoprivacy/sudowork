/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICreateConversationParams } from '@/common/ipcBridge';
import { getDefaultAcpModelId } from '@/common/acp/defaultModels';
import type { TChatConversation } from '@/common/storage';
import { uuid } from '@/common/utils';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { DRAFTS_DIR_NAME } from '@/common/constants';
import { getSystemDir } from './initStorage';
import { SUDOCLAW_DIR } from './services/sudoclaw/SudoclawInstallService';
import { computeOpenClawIdentityHash } from './utils/openclawUtils';

/**
 * 创建工作空间目录（不复制文件）
 * Create workspace directory (without copying files)
 *
 * 注意：文件复制统一由 sendMessage 时的 copyFilesToDirectory 处理
 * 避免文件被复制两次（一次在创建会话时，一次在发送消息时）
 * Note: File copying is handled by copyFilesToDirectory in sendMessage
 * This avoids files being copied twice
 */
const buildWorkspaceWidthFiles = async (defaultWorkspaceName: string, workspace?: string, _defaultFiles?: string[], providedCustomWorkspace?: boolean) => {
  // 使用前端提供的customWorkspace标志，如果没有则根据workspace参数判断
  const customWorkspace = providedCustomWorkspace !== undefined ? providedCustomWorkspace : !!workspace;

  if (!workspace) {
    const tempPath = getSystemDir().workDir;
    workspace = path.join(tempPath, defaultWorkspaceName);
    await fs.mkdir(workspace, { recursive: true });
  } else {
    // 规范化路径：去除末尾斜杠，解析为绝对路径
    workspace = path.resolve(workspace);
  }

  // Auto-create drafts directory for intermediate files
  // 自动创建草稿箱目录，用于存放 Agent 执行过程中的中间文件
  const draftsDir = path.join(workspace, DRAFTS_DIR_NAME);
  await fs.mkdir(draftsDir, { recursive: true });

  return { workspace, customWorkspace };
};

export const createAcpAgent = async (options: ICreateConversationParams): Promise<TChatConversation> => {
  const { extra } = options;
  const { workspace, customWorkspace } = await buildWorkspaceWidthFiles(`${extra.backend}-temp-${Date.now()}`, extra.workspace, extra.defaultFiles, extra.customWorkspace);
  const currentModelId = extra.currentModelId || getDefaultAcpModelId(extra.backend) || undefined;
  return {
    type: 'acp',
    extra: {
      workspace: workspace,
      customWorkspace,
      backend: extra.backend,
      cliPath: extra.cliPath,
      agentName: extra.agentName,
      customAgentId: extra.customAgentId, // 同时用于标识预设助手 / Also used to identify preset assistant
      presetContext: extra.presetContext, // 智能助手的预设规则/提示词
      // 启用的 skills 列表（通过 SkillManager 加载）/ Enabled skills list (loaded via SkillManager)
      enabledSkills: extra.enabledSkills,
      // 预设助手 ID，用于在会话面板显示助手名称和头像
      // Preset assistant ID for displaying name and avatar in conversation panel
      presetAssistantId: extra.presetAssistantId,
      // Initial session mode selected on Guid page (from AgentModeSelector)
      sessionMode: extra.sessionMode,
      // Pre-selected model from Guid page (cached model list)
      currentModelId,
      // Explicit marker for temporary health-check conversations
      isHealthCheck: extra.isHealthCheck,
      // Cron job metadata (set when conversation is created by a cron execution)
      cronJobId: extra.cronJobId,
      cronJobName: extra.cronJobName,
    },
    createTime: Date.now(),
    modifyTime: Date.now(),
    name: workspace,
    id: uuid(),
  };
};

export function getSudoclawWorkspaceRoot(): string {
  try {
    const configPath = path.join(SUDOCLAW_DIR, 'sudoclaw.json');
    const raw = fsSync.readFileSync(configPath, 'utf-8');
    const cfg = JSON.parse(raw);
    const configured = cfg?.agents?.defaults?.workspace;
    if (typeof configured === 'string' && configured.trim()) {
      return configured.trim();
    }
  } catch {
    // fall through to default
  }
  return getSystemDir().workDir;
}

export const createOpenClawAgent = async (options: ICreateConversationParams): Promise<TChatConversation> => {
  const { extra } = options;
  // Use workspace root from sudoclaw.json so the agent's working dir matches the UI workspace panel.
  // Falls back to getSystemDir().workDir if sudoclaw.json is missing or has no workspace configured.
  const tempName = `sudoclaw-temp-${Date.now()}`;
  let resolvedWorkspace = extra.workspace;
  if (!resolvedWorkspace) {
    const root = getSudoclawWorkspaceRoot();
    resolvedWorkspace = path.join(root, tempName);
    await fs.mkdir(resolvedWorkspace, { recursive: true });
  }
  const { workspace, customWorkspace } = await buildWorkspaceWidthFiles(tempName, resolvedWorkspace, extra.defaultFiles, extra.customWorkspace);
  // Compute identity hash from the shared workspace root (where IDENTITY.md/SOUL.md live),
  // not from the per-session temp directory. The temp workspace is only for task-specific files;
  // identity and memory persist in the parent workspace across all sessions.
  const sharedWorkspaceRoot = getSudoclawWorkspaceRoot();
  const expectedIdentityHash = await computeOpenClawIdentityHash(sharedWorkspaceRoot);

  const stateDir = SUDOCLAW_DIR;

  return {
    type: 'openclaw-gateway',
    extra: {
      workspace: workspace,
      backend: extra.backend,
      agentName: extra.agentName,
      customWorkspace,
      gateway: {
        stateDir,
      },
      runtimeValidation: {
        expectedWorkspace: workspace,
        expectedBackend: extra.backend,
        expectedAgentName: extra.agentName,
        // Note: model is not used by openclaw-gateway, so skip expectedModel to avoid
        // validation mismatch (conversation object doesn't store model for this type)
        expectedIdentityHash,
        switchedAt: extra.runtimeValidation?.switchedAt ?? Date.now(),
      },
      // Custom agent ID for preset assistant identification
      customAgentId: extra.customAgentId,
      // Preset context/rules for preset assistants
      presetContext: extra.presetContext,
      // Enabled skills list (loaded via SkillManager)
      enabledSkills: extra.enabledSkills,
      // Preset assistant ID for displaying name and avatar in conversation panel
      presetAssistantId: extra.presetAssistantId,
      // Initial session mode selected on Guid page
      sessionMode: extra.sessionMode,
      // Pre-selected model from Guid page
      currentModelId: extra.currentModelId,
      // Cron job metadata (set when conversation is created by a cron execution)
      cronJobId: extra.cronJobId,
      cronJobName: extra.cronJobName,
    },
    createTime: Date.now(),
    modifyTime: Date.now(),
    name: workspace,
    id: uuid(),
  };
};
