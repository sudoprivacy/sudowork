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
import { ensureWorkspaceAgentsMdRules } from './services/scode/ScodeInstallService';
import { filterEnabledSkillNames } from './utils/enabledSkillFilter';

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
  const enabledSkills = await filterEnabledSkillNames(extra.enabledSkills);
  if (extra.backend === 'scode') {
    ensureWorkspaceAgentsMdRules(workspace);
  }
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
      enabledSkills,
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

/**
 * Create Remote Agent conversation (Moss Server enterprise mode)
 * Remote agent doesn't need CLI detection - connection is established lazily when sendMessage is called
 */
export const createRemoteAgent = async (options: ICreateConversationParams): Promise<TChatConversation> => {
  const { extra } = options;
  const tempName = `moss-temp-${Date.now()}`;
  const { workspace, customWorkspace } = await buildWorkspaceWidthFiles(tempName, extra.workspace, extra.defaultFiles, extra.customWorkspace);
  const enabledSkills = await filterEnabledSkillNames(extra.enabledSkills);

  return {
    type: 'remote-agent',
    extra: {
      workspace: workspace,
      customWorkspace,
      // Moss Server specific fields
      mossServerUrl: extra.mossServerUrl,
      // Persist only stable credentials (API keys). Session JWTs outlive
      // logins/logouts and resurface revoked (issue #849) — connections read
      // the current auth storage instead.
      authToken: extra.authToken && !extra.authToken.startsWith('eyJ') ? extra.authToken : undefined,
      username: extra.username,
      password: extra.password,
      runtimeType: extra.runtimeType,
      dangerouslySkipPermissions: extra.dangerouslySkipPermissions,
      // Agent identification
      agentName: extra.agentName,
      customAgentId: extra.customAgentId,
      presetAssistantId: extra.presetAssistantId,
      presetContext: extra.presetContext,
      enabledSkills,
      sessionMode: extra.sessionMode,
      // Cron job metadata
      cronJobId: extra.cronJobId,
      cronJobName: extra.cronJobName,
    },
    createTime: Date.now(),
    modifyTime: Date.now(),
    name: workspace,
    id: uuid(),
  };
};
