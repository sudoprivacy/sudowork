/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Custom Skill/Assistant Upload Module
 *
 * 自定义技能/助手创建与上传模块
 *
 * 功能：
 * 1. 本地创建自定义技能/助手（保存到 custom/ 目录）
 * 2. 打包为 zip 文件
 * 3. 上传到 Moss Server
 * 4. 更新本地元数据标记为已上传
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { existsSync, mkdirSync } from 'fs';
import JSZip from 'jszip';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { isEnterpriseMode, getEnterpriseConfig } from '@/common/enterpriseDebugConfig';
import { getSkillInstallDir, getAssistantInstallDir, initEnterpriseDirs, getEnterpriseCustomSkillsDir, getEnterpriseCustomAssistantsDir, getSkillMetaFileName, getAssistantMetaFileName, SourceType } from '@/process/constants/enterpriseStorage';
import type { IAssistantMeta } from '@/process/constants/assistantStorage';
import type { ISkillHubMeta } from '@/common/ipcBridge';
import { DEFAULT_PRESET_AGENT_TYPE } from '@/types/acpTypes';

// ============ 类型定义 ============

export interface CustomSkillUploadParams {
  skillName: string;
  displayName: string;
  description?: string;
  version?: string;
  /** Local skill directory path (if already exists) */
  sourcePath?: string;
}

export interface CustomSkillUploadResult {
  success: boolean;
  id?: string;
  name: string;
  status?: string;
  error?: string;
}

export interface CustomAssistantUploadParams {
  /** Assistant name (display name, e.g., "微信公众号运营助手") */
  assistantName: string;
  /** Assistant ID (UUID, e.g., "fb11954c-a848-41a2-967f-e1ef5e711fe6") */
  assistantId: string;
  displayName: string;
  description?: string;
  version?: string;
  enabledSkills?: string[];
  memoryMode?: 'session' | 'user';
  /** Local assistant directory path (if already exists) */
  sourcePath?: string;
}

export interface CustomAssistantUploadResult {
  success: boolean;
  id?: string;
  name: string;
  status?: string;
  error?: string;
}

// ============ 工具函数 ============

/**
 * Get Moss Server URL and token
 */
function getMossConfig(): { serverUrl: string; token: string } {
  const config = getEnterpriseConfig();
  return {
    serverUrl: config.mossServerUrl,
    token: config.authToken,
  };
}

/**
 * Create zip file from directory
 */
async function createZipFromDirectory(sourceDir: string): Promise<Buffer> {
  const zip = new JSZip();

  async function addDirectoryToZip(dirPath: string, zipPath: string = ''): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const zipEntryPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await addDirectoryToZip(fullPath, zipEntryPath);
      } else if (entry.isFile()) {
        const content = await fs.readFile(fullPath);
        zip.file(zipEntryPath, content);
      }
    }
  }

  await addDirectoryToZip(sourceDir);
  return zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * Upload file to Moss Server via JSON body with base64 encoded file
 * Moss Server expects JSON body with file as base64 string
 */
async function uploadFile(url: string, token: string, params: Record<string, string | string[] | undefined>, zipBuffer: Buffer): Promise<Response> {
  // Convert zip buffer to base64
  const fileBase64 = zipBuffer.toString('base64');

  // Build JSON body matching Moss Server's expected format
  const body: Record<string, unknown> = {
    file: fileBase64,
    name: params.name || '',
    displayName: params.displayName || params.name || '',
    description: params.description || '',
    version: params.version || '1.0.0',
  };

  // Add id (UUID) if provided
  if (params.id) {
    body.id = params.id;
  }

  // Add optional fields for assistants
  if (params.enabledSkills) {
    body.enabledSkills = params.enabledSkills;
  }
  if (params.memoryMode) {
    body.memoryMode = params.memoryMode;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return response;
}

// ============ 自定义技能上传 ============

/**
 * Create local custom skill directory
 */
export async function createLocalCustomSkill(params: CustomSkillUploadParams): Promise<string> {
  // Initialize enterprise directories if needed
  if (isEnterpriseMode()) {
    initEnterpriseDirs();
  }

  const skillDir = getSkillInstallDir(params.skillName, 'custom');
  await fs.mkdir(skillDir, { recursive: true });

  // Create SKILL.md if not exists
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (!existsSync(skillMdPath)) {
    const skillMdContent = `---
name: ${params.skillName}
display_name: ${params.displayName}
version: ${params.version || '1.0.0'}
description: ${params.description || ''}
---

# ${params.displayName}

${params.description || 'Custom skill created by user.'}
`;
    await fs.writeFile(skillMdPath, skillMdContent, 'utf-8');
  }

  // Create metadata
  const meta: ISkillHubMeta = {
    id: '',
    name: params.skillName,
    display_name: params.displayName,
    description: params.description || '',
    icon: '',
    emoji: null,
    category: '',
    categories: [],
    applicable_scenarios: null,
    core_features: null,
    homepage: null,
    author_id: '',
    source_type: 'custom',
    is_builtin: false,
    enabled: true,
    installed_version: params.version || '1.0.0',
    installed_at: new Date().toISOString(),
  };

  const metaFileName = getSkillMetaFileName();
  const metaPath = path.join(skillDir, metaFileName);
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

  mainLog('CustomUpload', `Created local custom skill: ${params.skillName} at ${skillDir}`);
  return skillDir;
}

/**
 * Upload custom skill to Moss Server
 */
export async function uploadCustomSkill(params: CustomSkillUploadParams): Promise<CustomSkillUploadResult> {
  const { serverUrl, token } = getMossConfig();

  if (!serverUrl || !token) {
    return {
      success: false,
      name: params.skillName,
      error: 'Moss Server not configured or not authenticated',
    };
  }

  try {
    // Determine source directory
    let skillDir: string;
    if (params.sourcePath) {
      skillDir = params.sourcePath;
    } else {
      skillDir = getSkillInstallDir(params.skillName, 'custom');
    }

    // Check if directory exists
    if (!existsSync(skillDir)) {
      return {
        success: false,
        name: params.skillName,
        error: `Skill directory not found: ${skillDir}`,
      };
    }

    // Create zip
    mainLog('CustomUpload', `Creating zip for skill: ${params.skillName}`);
    const zipBuffer = await createZipFromDirectory(skillDir);

    // Upload to Moss Server
    const uploadUrl = `${serverUrl}/api/v1/skills/custom`;
    mainLog('CustomUpload', `Uploading skill to: ${uploadUrl}`);

    const response = await uploadFile(
      uploadUrl,
      token,
      {
        name: params.skillName,
        displayName: params.displayName,
        description: params.description,
        version: params.version,
      },
      zipBuffer
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        name: params.skillName,
        error: `Upload failed: HTTP ${response.status} - ${errorText}`,
      };
    }

    const result = await response.json();
    mainLog('CustomUpload', `Skill upload successful: ${JSON.stringify(result)}`);

    // Update local metadata with server ID
    const metaFileName = getSkillMetaFileName();
    const metaPath = path.join(skillDir, metaFileName);
    if (existsSync(metaPath)) {
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as ISkillHubMeta;
      meta.id = result.id || '';
      meta.uploaded = true;
      meta.uploaded_at = new Date().toISOString();
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    }

    return {
      success: true,
      id: result.id,
      name: params.skillName,
      status: result.status || 'active',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    mainError('CustomUpload', `Failed to upload skill ${params.skillName}:`, error);
    return {
      success: false,
      name: params.skillName,
      error: errorMsg,
    };
  }
}

// ============ 自定义助手上传 ============

/**
 * Create local custom assistant directory
 */
export async function createLocalCustomAssistant(params: CustomAssistantUploadParams): Promise<string> {
  // Initialize enterprise directories if needed
  if (isEnterpriseMode()) {
    initEnterpriseDirs();
  }

  const assistantDir = getAssistantInstallDir(params.assistantName, 'custom');
  await fs.mkdir(assistantDir, { recursive: true });

  // Create AGENT.md if not exists
  const agentMdPath = path.join(assistantDir, 'AGENT.md');
  if (!existsSync(agentMdPath)) {
    const agentMdContent = `# ${params.displayName}

${params.description || 'Custom assistant created by user.'}
`;
    await fs.writeFile(agentMdPath, agentMdContent, 'utf-8');
  }

  // Create metadata
  const meta: IAssistantMeta = {
    id: '',
    name: params.displayName, // Use actual user-input name
    nameI18n: { 'en-US': params.displayName },
    descriptionI18n: { 'en-US': params.description || '' },
    presetAgentType: DEFAULT_PRESET_AGENT_TYPE,
    defaultEnabledSkills: params.enabledSkills || [],
    enabledSkills: params.enabledSkills || [],
    source_type: 'custom',
    tag: 'custom',
    is_builtin: false,
    enabled: true,
    installed_version: params.version || '1.0.0',
    installed_at: new Date().toISOString(),
  };

  const metaFileName = getAssistantMetaFileName();
  const metaPath = path.join(assistantDir, metaFileName);
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

  mainLog('CustomUpload', `Created local custom assistant: ${params.assistantName} at ${assistantDir}`);
  return assistantDir;
}

/**
 * Upload custom assistant to Moss Server
 */
export async function uploadCustomAssistant(params: CustomAssistantUploadParams): Promise<CustomAssistantUploadResult> {
  const { serverUrl, token } = getMossConfig();

  if (!serverUrl || !token) {
    return {
      success: false,
      name: params.assistantName,
      error: 'Moss Server not configured or not authenticated',
    };
  }

  try {
    // Determine source directory - use assistantId (UUID) as directory name
    let assistantDir: string;
    if (params.sourcePath) {
      assistantDir = params.sourcePath;
    } else {
      // Local directory is named by assistantId (UUID)
      assistantDir = getAssistantInstallDir(params.assistantId, 'custom');
    }

    mainLog('CustomUpload', `[Upload Assistant] assistantName: ${params.assistantName}, assistantId: ${params.assistantId}, sourceDir: ${assistantDir}`);

    // Check if directory exists
    if (!existsSync(assistantDir)) {
      return {
        success: false,
        name: params.assistantName,
        error: `Assistant directory not found: ${assistantDir}`,
      };
    }

    // Create zip
    mainLog('CustomUpload', `Creating zip for assistant: ${params.assistantName}`);
    const zipBuffer = await createZipFromDirectory(assistantDir);

    // Upload to Moss Server
    const uploadUrl = `${serverUrl}/api/v1/agents/custom`;
    mainLog('CustomUpload', `Uploading assistant to: ${uploadUrl}`);

    const response = await uploadFile(
      uploadUrl,
      token,
      {
        name: params.assistantName, // User-visible name
        id: params.assistantId, // UUID for server reference
        displayName: params.displayName,
        description: params.description,
        version: params.version,
        enabledSkills: params.enabledSkills ? JSON.stringify(params.enabledSkills) : undefined,
        memoryMode: params.memoryMode,
      },
      zipBuffer
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        name: params.assistantName,
        error: `Upload failed: HTTP ${response.status} - ${errorText}`,
      };
    }

    const result = await response.json();
    mainLog('CustomUpload', `Assistant upload successful: ${JSON.stringify(result)}`);
    mainLog('CustomUpload', `[Upload Assistant] Server returned id: ${result.id}, local assistantName: ${params.assistantName}`);

    // Update local metadata with server ID, preserving existing fields like ruleFile
    const metaFileName = getAssistantMetaFileName();
    const metaPath = path.join(assistantDir, metaFileName);
    mainLog('CustomUpload', `[Upload Assistant] Updating metadata at: ${metaPath}`);
    if (existsSync(metaPath)) {
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as IAssistantMeta;
      const oldId = meta.id;
      meta.id = result.id || '';
      meta.uploaded = true;
      meta.uploaded_at = new Date().toISOString();
      // Preserve ruleFile field if it exists
      // Note: ruleFile should already be set if AGENT.md was created during assistant creation
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
      mainLog('CustomUpload', `[Upload Assistant] Updated metadata: oldId=${oldId} -> newId=${meta.id}`);
    } else {
      mainWarn('CustomUpload', `[Upload Assistant] Metadata file not found at ${metaPath}`);
    }

    return {
      success: true,
      id: result.id,
      name: params.assistantName,
      status: result.status || 'active',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    mainError('CustomUpload', `Failed to upload assistant ${params.assistantName}:`, error);
    return {
      success: false,
      name: params.assistantName,
      error: errorMsg,
    };
  }
}
