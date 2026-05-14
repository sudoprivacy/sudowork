/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Remote → Local 同步模块
 *
 * 企业登录后，将服务端已安装的 skill 和 assistant 同步到本地
 *
 * 同步流程：
 * 1. 获取远程已安装列表（/api/v1/skills/installed, /api/v1/agents/installed）
 * 2. 计算本地与远程差异
 * 3. 下载技能/助手包（/api/v1/skills/installed/{id}/download）
 * 4. 解压安装到本地 hub/ 目录
 * 5. 写入 _sudowork_meta.json 元数据
 */

import { ProcessConfig, getHubSkillsDir, getHubAssistantsDir } from '@process/initStorage';
import { mainLog, mainError, mainWarn } from '@process/utils/mainLogger';
import { getValidToken } from '@process/bridge/eeclawBridge';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import https from 'node:https';
import http from 'node:http';
import JSZip from 'jszip';
import { skillManager } from '@process/SkillManager';
import { assistantManager } from '@process/AssistantManager';
import { isEnterpriseMode } from '@/common/enterpriseDebugConfig';
import { initEnterpriseDirs, getEnterpriseHubSkillsDir, getEnterpriseHubAssistantsDir, getEnterpriseTenantSkillsDir, getEnterpriseTenantAssistantsDir, getSkillMetaFileName, getAssistantMetaFileName } from '@/process/constants/enterpriseStorage';
import { SKILL_HUB_META_FILE } from '@/process/constants/skillStorage';
import type { IAssistantMeta } from '@/process/constants/assistantStorage';
import { ASSISTANT_META_FILE } from '@/process/constants/assistantStorage';
import type { ISkillHubMeta } from '@/common/ipcBridge';

// ============ 类型定义 ============

export type SyncResult = {
  installed: string[];
  skipped: string[];
  failed: Array<{ id: string; name: string; error: string }>;
};

export type SyncAllResult = {
  skills: { hub: SyncResult; tenant: SyncResult };
  assistants: { hub: SyncResult; tenant: SyncResult };
};

export type RemoteSkillInfo = {
  id: string;
  name: string;
  displayName: string;
  version: string;
  source: string;
  isHubInstalled: boolean;
  visibleTo: { department_ids: string[] | null } | null;
};

export type RemoteAssistantInfo = {
  id: string;
  name: string;
  displayName: string;
  version: string;
  source: string;
  isHubInstalled: boolean;
  visibleTo: { department_ids: string[] | null } | null;
  enabledSkills: string[];
};

export type SkillInstallDetail = {
  name: string;
  sourceUrl: string;
  checksum: string;
  version: string;
  meta: Record<string, unknown>;
};

export type AssistantInstallDetail = {
  name: string;
  sourceUrl: string;
  checksum: string;
  version: string;
  meta: Record<string, unknown>;
};

// ============ Mock 开关 ============

const USE_MOCK = process.env.MOSS_SYNC_MOCK === 'true';

// ============ API 调用 ============

async function fetchRemote<T>(urlPath: string, serverUrl: string, token: string): Promise<T> {
  const response = await fetch(`${serverUrl}${urlPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function getRemoteSkillsInstalledMock(): Promise<RemoteSkillInfo[]> {
  return [
    {
      id: 'skill-001',
      name: 'code-review',
      displayName: 'Code Review',
      version: '1.2.0',
      source: '/mock/path',
      isHubInstalled: true,
      visibleTo: { department_ids: ['dept-001'] },
    },
    {
      id: 'skill-002',
      name: 'test-gen',
      displayName: 'Test Generator',
      version: '1.0.0',
      source: '/mock/path',
      isHubInstalled: true,
      visibleTo: null,
    },
  ];
}

async function getRemoteSkillsInstalled(serverUrl: string, token: string): Promise<RemoteSkillInfo[]> {
  if (USE_MOCK) {
    return getRemoteSkillsInstalledMock();
  }

  const data = await fetchRemote<RemoteSkillInfo[] | { data: RemoteSkillInfo[] }>('/api/v1/skills/installed', serverUrl, token);
  return Array.isArray(data) ? data : (data.data ?? []);
}

async function getRemoteAssistantsInstalledMock(): Promise<RemoteAssistantInfo[]> {
  return [
    {
      id: 'agent-001',
      name: 'code-assistant',
      displayName: 'Code Assistant',
      version: '2.0.0',
      source: '/mock/path',
      isHubInstalled: true,
      visibleTo: null,
      enabledSkills: ['skill-001', 'skill-002'],
    },
  ];
}

async function getRemoteAssistantsInstalled(serverUrl: string, token: string): Promise<RemoteAssistantInfo[]> {
  if (USE_MOCK) {
    return getRemoteAssistantsInstalledMock();
  }

  const data = await fetchRemote<RemoteAssistantInfo[] | { data: RemoteAssistantInfo[] }>('/api/v1/agents/installed', serverUrl, token);
  return Array.isArray(data) ? data : (data.data ?? []);
}

async function getSkillInstallDetailMock(name: string): Promise<SkillInstallDetail> {
  return {
    name,
    sourceUrl: `https://mock-skill-hub.internal/skills/${name}/package.zip`,
    checksum: 'mock-checksum',
    version: '1.0.0',
    meta: {
      id: `skill-${name}`,
      display_name: name,
      description: `Mock skill ${name}`,
      visible_to: { department_ids: ['dept-001'] },
    },
  };
}

async function getSkillInstallDetail(name: string, serverUrl: string, token: string): Promise<SkillInstallDetail> {
  if (USE_MOCK) {
    return getSkillInstallDetailMock(name);
  }

  return fetchRemote<SkillInstallDetail>(`/api/v1/skills/installed-detail?name=${encodeURIComponent(name)}`, serverUrl, token);
}

async function getAssistantInstallDetailMock(name: string): Promise<AssistantInstallDetail> {
  return {
    name,
    sourceUrl: `https://mock-assistant-hub.internal/assistants/${name}/package.zip`,
    checksum: 'mock-checksum',
    version: '1.0.0',
    meta: {
      id: `agent-${name}`,
      display_name: name,
      description: `Mock assistant ${name}`,
      visible_to: null,
      enabledSkills: [],
    },
  };
}

async function getAssistantInstallDetail(name: string, serverUrl: string, token: string): Promise<AssistantInstallDetail> {
  if (USE_MOCK) {
    return getAssistantInstallDetailMock(name);
  }

  return fetchRemote<AssistantInstallDetail>(`/api/v1/agents/installed-detail?name=${encodeURIComponent(name)}`, serverUrl, token);
}

// ============ 新版 API（通过 ID 下载）============

/**
 * Download skill package by ID from Moss Server
 * 新版 API：通过 ID 直接下载技能包
 *
 * @param skillId - Skill UUID
 * @param serverUrl - Moss Server URL
 * @param token - Auth token
 * @returns Zip buffer
 */
async function downloadSkillById(skillId: string, serverUrl: string, token: string, onProgress?: (percent: number) => void): Promise<Buffer> {
  const downloadUrl = `${serverUrl}/api/v1/skills/installed/${skillId}/download`;
  mainLog('remoteToLocalSync', `Downloading skill by ID: ${skillId} from ${downloadUrl}`);

  return downloadFileWithAuth(downloadUrl, token, onProgress);
}

/**
 * Download assistant package by ID from Moss Server
 * 新版 API：通过 ID 直接下载助手包
 *
 * @param assistantId - Assistant UUID
 * @param serverUrl - Moss Server URL
 * @param token - Auth token
 * @returns Zip buffer
 */
async function downloadAssistantById(assistantId: string, serverUrl: string, token: string, onProgress?: (percent: number) => void): Promise<Buffer> {
  const downloadUrl = `${serverUrl}/api/v1/agents/installed/${assistantId}/download`;
  mainLog('remoteToLocalSync', `Downloading assistant by ID: ${assistantId} from ${downloadUrl}`);

  return downloadFileWithAuth(downloadUrl, token, onProgress);
}

/**
 * Download file with Bearer token authentication
 * Exported for use by tenantSync module
 */
export async function downloadFileWithAuth(url: string, token: string, onProgress?: (percent: number) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const request = client.get(
      url,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Sudowork-EnterpriseSync/1.0',
        },
      },
      (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            downloadFileWithAuth(redirectUrl, token, onProgress).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedSize = 0;

        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          downloadedSize += chunk.length;
          if (totalSize > 0 && onProgress) {
            onProgress(Math.round((downloadedSize / totalSize) * 100));
          }
        });

        response.on('end', () => {
          resolve(Buffer.concat(chunks));
        });

        response.on('error', reject);
      }
    );

    request.setTimeout(120000, () => {
      request.destroy(new Error('Download timeout'));
    });

    request.on('error', reject);
  });
}

// ============ 文件下载 ============

/**
 * Download file from URL with progress callback
 */
async function downloadFile(url: string, onProgress?: (percent: number) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const request = client.get(
      url,
      {
        headers: {
          'User-Agent': 'Sudowork-RemoteSync/1.0',
        },
      },
      (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            downloadFile(redirectUrl, onProgress).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        const totalSize = parseInt(response.headers['content-length'] || '0', 10);
        let downloadedSize = 0;

        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          downloadedSize += chunk.length;
          if (totalSize > 0 && onProgress) {
            onProgress(Math.round((downloadedSize / totalSize) * 100));
          }
        });

        response.on('end', () => {
          resolve(Buffer.concat(chunks));
        });

        response.on('error', reject);
      }
    );

    request.setTimeout(60000, () => {
      request.destroy(new Error('Download timeout'));
    });

    request.on('error', reject);
  });
}

/**
 * Verify checksum (SHA256)
 */
async function verifyChecksum(buffer: Buffer, expectedChecksum: string): Promise<boolean> {
  const crypto = await import('crypto');
  const actualChecksum = crypto.createHash('sha256').update(buffer).digest('hex');
  return actualChecksum === expectedChecksum;
}

// ============ Zip 处理 ============

function normalizeZipEntryPath(entryPath: string): string {
  return path.posix.normalize(entryPath.replaceAll('\\', '/').replace(/^\.\/+/, ''));
}

function isUnsafeZipEntryPath(entryPath: string): boolean {
  if (!entryPath || entryPath === '.') return false;
  if (/^[a-zA-Z]:[\\/]/.test(entryPath)) return true;
  if (entryPath.startsWith('/') || entryPath.startsWith('\\')) return true;
  const normalized = normalizeZipEntryPath(entryPath);
  return normalized === '..' || normalized.startsWith('../');
}

function resolveZipLayout(zip: JSZip): { stripPrefix: string } {
  const fileEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => normalizeZipEntryPath(entry.name))
    .filter(Boolean);

  for (const entryPath of fileEntries) {
    if (isUnsafeZipEntryPath(entryPath)) {
      throw new Error(`Unsafe zip entry path: ${entryPath}`);
    }
  }

  // Check if all files are under a single top-level directory
  const topLevelParts = fileEntries.map((entryPath) => entryPath.split('/')[0]);
  const uniqueTopLevel = Array.from(new Set(topLevelParts));

  // If there's a single top-level directory and all files have path separator, strip it
  if (uniqueTopLevel.length === 1 && fileEntries.every((e) => e.includes('/'))) {
    return { stripPrefix: `${uniqueTopLevel[0]}/` };
  }

  return { stripPrefix: '' };
}

async function extractZipToDirectory(zipBuffer: Buffer, targetDir: string): Promise<void> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const { stripPrefix } = resolveZipLayout(zip);

  await fs.mkdir(targetDir, { recursive: true });

  for (const zipEntry of Object.values(zip.files)) {
    if (zipEntry.dir) continue;
    if (isUnsafeZipEntryPath(zipEntry.name)) {
      throw new Error(`Unsafe zip entry path: ${zipEntry.name}`);
    }

    const normalizedPath = normalizeZipEntryPath(zipEntry.name);
    let targetPath = normalizedPath;

    if (stripPrefix) {
      if (!normalizedPath.startsWith(stripPrefix)) continue;
      targetPath = normalizedPath.slice(stripPrefix.length);
    }

    if (!targetPath) continue;

    const fullPath = path.join(targetDir, targetPath);
    const fullDir = path.dirname(fullPath);
    await fs.mkdir(fullDir, { recursive: true });

    const content = await zipEntry.async('nodebuffer');
    await fs.writeFile(fullPath, content);
  }
}

// ============ 本地安装 ============

/**
 * Get the appropriate hub skills directory based on current mode
 */
async function getHubSkillsDirForMode(): Promise<string> {
  if (isEnterpriseMode()) {
    return getEnterpriseHubSkillsDir();
  }
  return getHubSkillsDir();
}

/**
 * Get the appropriate hub assistants directory based on current mode
 */
async function getHubAssistantsDirForMode(): Promise<string> {
  if (isEnterpriseMode()) {
    return getEnterpriseHubAssistantsDir();
  }
  return getHubAssistantsDir();
}

/**
 * 下载并安装 skill 到本地
 */
async function installSkillToLocal(detail: SkillInstallDetail): Promise<void> {
  // Trim skill name to avoid leading/trailing spaces in directory names
  const skillName = detail.name.trim();
  mainLog('remoteToLocalSync', `Installing skill: ${skillName} v${detail.version}`);

  // Download zip file
  const zipBuffer = await downloadFile(detail.sourceUrl, (percent) => {
    mainLog('remoteToLocalSync', `Download progress for ${skillName}: ${percent}%`);
  });

  // Verify checksum if provided
  if (detail.checksum) {
    const isValid = await verifyChecksum(zipBuffer, detail.checksum);
    if (!isValid) {
      mainWarn('remoteToLocalSync', `Checksum verification failed for skill ${skillName}, but continuing anyway`);
    }
  }

  // Initialize enterprise directories if needed
  if (isEnterpriseMode()) {
    initEnterpriseDirs();
  }

  // Get hub skills directory (mode-aware)
  const hubSkillsDir = await getHubSkillsDirForMode();
  await fs.mkdir(hubSkillsDir, { recursive: true });

  const skillDir = path.join(hubSkillsDir, skillName);

  // Remove existing if present
  try {
    await fs.access(skillDir);
    await fs.rm(skillDir, { recursive: true, force: true });
  } catch {
    // Directory doesn't exist
  }

  // Extract zip contents
  await extractZipToDirectory(zipBuffer, skillDir);

  // Use mode-aware metadata file name
  const metaFileName = getSkillMetaFileName();
  const metaFilePath = path.join(skillDir, metaFileName);
  const meta = {
    id: detail.meta.id || skillName,
    name: skillName,
    display_name: detail.meta.display_name || skillName,
    description: detail.meta.description || '',
    icon: detail.meta.icon || '',
    emoji: detail.meta.emoji ?? null,
    category: detail.meta.category || '',
    categories: detail.meta.categories || [],
    applicable_scenarios: detail.meta.applicable_scenarios ?? null,
    core_features: detail.meta.core_features ?? null,
    homepage: detail.meta.homepage ?? null,
    author_id: detail.meta.author_id || '',
    source_type: 'hub',
    is_builtin: false,
    enabled: true,
    installed_version: detail.version,
    installed_at: new Date().toISOString(),
    // Include visible_to for permission filtering
    visible_to: detail.meta.visible_to ?? null,
  };
  await fs.writeFile(metaFilePath, JSON.stringify(meta, null, 2), 'utf-8');

  mainLog('remoteToLocalSync', `Successfully installed skill: ${skillName} v${detail.version}`);
}

/**
 * 下载并安装 assistant 到本地
 */
async function installAssistantToLocal(detail: AssistantInstallDetail): Promise<void> {
  // Trim assistant name to avoid leading/trailing spaces in directory names
  const assistantName = detail.name.trim();
  mainLog('remoteToLocalSync', `Installing assistant: ${assistantName} v${detail.version}`);

  // Download zip file
  const zipBuffer = await downloadFile(detail.sourceUrl, (percent) => {
    mainLog('remoteToLocalSync', `Download progress for ${assistantName}: ${percent}%`);
  });

  // Verify checksum if provided
  if (detail.checksum) {
    const isValid = await verifyChecksum(zipBuffer, detail.checksum);
    if (!isValid) {
      mainWarn('remoteToLocalSync', `Checksum verification failed for assistant ${assistantName}, but continuing anyway`);
    }
  }

  // Initialize enterprise directories if needed
  if (isEnterpriseMode()) {
    initEnterpriseDirs();
  }

  // Get hub assistants directory (mode-aware)
  const hubAssistantsDir = await getHubAssistantsDirForMode();
  await fs.mkdir(hubAssistantsDir, { recursive: true });

  const assistantDir = path.join(hubAssistantsDir, assistantName);

  // Remove existing if present
  try {
    await fs.access(assistantDir);
    await fs.rm(assistantDir, { recursive: true, force: true });
  } catch {
    // Directory doesn't exist
  }

  // Extract zip contents
  await extractZipToDirectory(zipBuffer, assistantDir);

  // Scan for .md files and select ruleFile
  let ruleFile: string | undefined;
  try {
    const files = await fs.readdir(assistantDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));
    if (mdFiles.length > 0) {
      // Priority: {assistantName}.md > any .md file
      ruleFile = mdFiles.find((f) => f === `${assistantName}.md`) || mdFiles[0];
    }
  } catch {
    // Ignore
  }

  // Use mode-aware metadata file name
  const metaFileName = getAssistantMetaFileName();
  const metaFilePath = path.join(assistantDir, metaFileName);
  const meta = {
    id: detail.meta.id || assistantName,
    name: assistantName,
    nameI18n: { 'zh-CN': detail.meta.display_name || assistantName },
    descriptionI18n: detail.meta.description ? { 'zh-CN': detail.meta.description } : undefined,
    avatar: detail.meta.avatar || detail.meta.emoji || undefined,
    emoji: detail.meta.emoji,
    presetAgentType: detail.meta.presetAgentType || 'claude',
    source_type: 'hub',
    tag: 'hub',
    skills: detail.meta.enabledSkills || [],
    category_id: detail.meta.category || '',
    categories: detail.meta.categories || [],
    author_id: detail.meta.author_id || '',
    homepage: detail.meta.homepage ?? null,
    applicable_scenarios: detail.meta.applicable_scenarios ?? null,
    core_features: detail.meta.core_features ?? null,
    is_builtin: false,
    enabled: true,
    defaultInitPrompt: detail.meta.defaultInitPrompt || null,
    installed_version: detail.version,
    installed_at: new Date().toISOString(),
    enabledSkills: detail.meta.enabledSkills || [],
    ruleFile: ruleFile,
    // Include visible_to for permission filtering
    visible_to: detail.meta.visible_to ?? null,
  };
  await fs.writeFile(metaFilePath, JSON.stringify(meta, null, 2), 'utf-8');

  mainLog('remoteToLocalSync', `Successfully installed assistant: ${assistantName} v${detail.version}`);
}

// ============ 新版安装函数（通过 ID 下载）============

/**
 * 通过 ID 直接下载并安装技能
 * 新版 API：使用 /api/v1/skills/installed/{id}/download
 */
async function installSkillById(skill: RemoteSkillInfo, serverUrl: string, token: string): Promise<void> {
  // Trim skill name to avoid leading/trailing spaces in directory names
  const skillName = skill.name.trim();
  mainLog('remoteToLocalSync', `Installing skill by ID: ${skillName} (${skill.id})`);

  // Download skill package by ID
  const zipBuffer = await downloadSkillById(skill.id, serverUrl, token, (percent) => {
    if (percent % 20 === 0) {
      mainLog('remoteToLocalSync', `Download progress for ${skillName}: ${percent}%`);
    }
  });

  // Initialize enterprise directories if needed
  if (isEnterpriseMode()) {
    initEnterpriseDirs();
  }

  // Get hub skills directory (mode-aware)
  const hubSkillsDir = await getHubSkillsDirForMode();
  await fs.mkdir(hubSkillsDir, { recursive: true });

  const skillDir = path.join(hubSkillsDir, skillName);

  // Remove existing if present
  try {
    await fs.access(skillDir);
    await fs.rm(skillDir, { recursive: true, force: true });
  } catch {
    // Directory doesn't exist
  }

  // Extract zip contents
  await extractZipToDirectory(zipBuffer, skillDir);

  // Read existing meta from zip (if exists) and merge with remote info
  const metaFileName = getSkillMetaFileName();
  const metaFilePath = path.join(skillDir, metaFileName);

  let existingMeta: ISkillHubMeta | null = null;
  try {
    const metaContent = await fs.readFile(metaFilePath, 'utf-8');
    existingMeta = JSON.parse(metaContent) as ISkillHubMeta;
  } catch {
    // Meta file doesn't exist in zip, will create new one
  }

  // Merge existing meta with remote info (remote info takes precedence for certain fields)
  const meta: ISkillHubMeta = {
    // Start with existing meta or defaults
    id: existingMeta?.id || skill.id,
    name: existingMeta?.name || skillName,
    display_name: existingMeta?.display_name || skill.displayName || skillName,
    description: existingMeta?.description || '',
    icon: existingMeta?.icon || '',
    emoji: existingMeta?.emoji || null,
    category: existingMeta?.category || '',
    categories: existingMeta?.categories || [],
    applicable_scenarios: existingMeta?.applicable_scenarios || null,
    core_features: existingMeta?.core_features || null,
    homepage: existingMeta?.homepage || null,
    author_id: existingMeta?.author_id || '',
    source_type: 'hub',
    is_builtin: false,
    enabled: true,
    installed_version: skill.version || existingMeta?.installed_version || '1.0.0',
    installed_at: new Date().toISOString(),
    visible_to: skill.visibleTo ?? existingMeta?.visible_to ?? null,
  };

  await fs.writeFile(metaFilePath, JSON.stringify(meta, null, 2), 'utf-8');

  mainLog('remoteToLocalSync', `Successfully installed skill by ID: ${skillName}`);
}

/**
 * 通过 ID 直接下载并安装助手
 * 新版 API：使用 /api/v1/agents/installed/{id}/download
 */
async function installAssistantById(assistant: RemoteAssistantInfo, serverUrl: string, token: string): Promise<void> {
  // Trim assistant name to avoid leading/trailing spaces in directory names
  const assistantName = assistant.name.trim();
  mainLog('remoteToLocalSync', `Installing assistant by ID: ${assistantName} (${assistant.id})`);

  // Download assistant package by ID
  const zipBuffer = await downloadAssistantById(assistant.id, serverUrl, token, (percent) => {
    if (percent % 20 === 0) {
      mainLog('remoteToLocalSync', `Download progress for ${assistantName}: ${percent}%`);
    }
  });

  // Initialize enterprise directories if needed
  if (isEnterpriseMode()) {
    initEnterpriseDirs();
  }

  // Get hub assistants directory (mode-aware)
  const hubAssistantsDir = await getHubAssistantsDirForMode();
  await fs.mkdir(hubAssistantsDir, { recursive: true });

  const assistantDir = path.join(hubAssistantsDir, assistantName);

  // Remove existing if present
  try {
    await fs.access(assistantDir);
    await fs.rm(assistantDir, { recursive: true, force: true });
  } catch {
    // Directory doesn't exist
  }

  // Extract zip contents
  await extractZipToDirectory(zipBuffer, assistantDir);

  // Scan for .md files and select ruleFile
  let ruleFile: string | undefined;
  try {
    const files = await fs.readdir(assistantDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));
    if (mdFiles.length > 0) {
      ruleFile = mdFiles.find((f) => f === `${assistantName}.md`) || mdFiles[0];
    }
  } catch {
    // Ignore
  }

  // Read existing meta from zip (if exists) and merge with remote info
  const metaFileName = getAssistantMetaFileName();
  const metaFilePath = path.join(assistantDir, metaFileName);

  let existingMeta: IAssistantMeta | null = null;
  try {
    const metaContent = await fs.readFile(metaFilePath, 'utf-8');
    existingMeta = JSON.parse(metaContent) as IAssistantMeta;
  } catch {
    // Meta file doesn't exist in zip, will create new one
  }

  // Merge existing meta with remote info
  const meta: IAssistantMeta = {
    // Start with existing meta or defaults
    id: existingMeta?.id || assistant.id,
    name: existingMeta?.name || assistantName,
    nameI18n: existingMeta?.nameI18n || { 'en-US': assistant.displayName || assistantName },
    descriptionI18n: existingMeta?.descriptionI18n || {},
    avatar: existingMeta?.avatar || undefined,
    emoji: existingMeta?.emoji || undefined,
    presetAgentType: existingMeta?.presetAgentType || 'claude',
    source_type: 'hub',
    tag: 'hub',
    skills: existingMeta?.skills || assistant.enabledSkills || [],
    category_id: existingMeta?.category_id || '',
    categories: existingMeta?.categories || [],
    author_id: existingMeta?.author_id || '',
    homepage: existingMeta?.homepage || null,
    applicable_scenarios: existingMeta?.applicable_scenarios || null,
    core_features: existingMeta?.core_features || null,
    is_builtin: false,
    enabled: true,
    defaultInitPrompt: existingMeta?.defaultInitPrompt || null,
    installed_version: assistant.version || existingMeta?.installed_version || '1.0.0',
    installed_at: new Date().toISOString(),
    enabledSkills: existingMeta?.enabledSkills || assistant.enabledSkills || [],
    defaultEnabledSkills: existingMeta?.defaultEnabledSkills || assistant.enabledSkills || [],
    ruleFile: ruleFile || existingMeta?.ruleFile,
    visible_to: assistant.visibleTo ?? existingMeta?.visible_to ?? null,
  };
  await fs.writeFile(metaFilePath, JSON.stringify(meta, null, 2), 'utf-8');

  mainLog('remoteToLocalSync', `Successfully installed assistant by ID: ${assistantName}`);
}

// ============ 本地已安装查询 ============

/**
 * 获取本地已安装技能 ID 集合
 * 用于增量同步时判断是否需要下载
 */
async function getLocalInstalledSkillIds(): Promise<Set<string>> {
  const skills = await skillManager.getInstalledSkills();
  const ids = new Set<string>();
  for (const skill of skills) {
    if (skill.meta?.id) {
      ids.add(skill.meta.id);
    }
  }
  return ids;
}

async function getLocalInstalledSkills(): Promise<Set<string>> {
  const skills = await skillManager.getInstalledSkills();
  return new Set(skills.map((s) => s.name));
}

/**
 * 获取本地已安装助手 ID 集合
 * 用于增量同步时判断是否需要下载
 */
async function getLocalInstalledAssistantIds(): Promise<Set<string>> {
  const assistants = await assistantManager.getInstalledAssistants();
  const ids = new Set<string>();
  for (const assistant of assistants) {
    // Check meta.id first, then fall back to name for backwards compatibility
    if (assistant.meta?.id) {
      ids.add(assistant.meta.id);
    } else if (assistant.id) {
      ids.add(assistant.id);
    }
  }
  return ids;
}

async function getLocalInstalledAssistants(): Promise<Set<string>> {
  const assistants = await assistantManager.getInstalledAssistants();
  return new Set(assistants.map((a) => a.name));
}

// ============ 核心同步逻辑 ============

/**
 * 同步远程 skills 到本地
 * 优先使用新版 API（通过 ID 下载），失败时回退到旧版 API
 *
 * 注意：只同步 isHubInstalled: true 的技能（从技能库安装的）
 * 自定义技能和专属技能由各自的同步逻辑处理
 */
export async function syncRemoteSkillsToLocal(): Promise<SyncResult> {
  const serverUrl = ProcessConfig.getSync('eeclaw.serverUrl');
  if (!serverUrl) {
    throw new Error('Server URL not configured');
  }

  const token = await getValidToken();

  mainLog('remoteToLocalSync', 'Starting skill sync...');

  // 1. 获取远程已安装列表
  const remoteSkills = await getRemoteSkillsInstalled(serverUrl, token);
  mainLog('remoteToLocalSync', `Remote skills: ${remoteSkills.length}`);

  // 1.5 只同步从技能库安装的技能（isHubInstalled: true）
  // 自定义技能和专属技能由各自的同步逻辑处理
  const hubSkills = remoteSkills.filter((s) => s.isHubInstalled === true);
  mainLog('remoteToLocalSync', `Hub skills (isHubInstalled=true): ${hubSkills.length}`);

  // 2. 获取本地已安装列表（按 ID 判断）
  const localSkillIds = await getLocalInstalledSkillIds();
  mainLog('remoteToLocalSync', `Local skills (by ID): ${localSkillIds.size}`);

  // 3. 计算差异（按 ID）
  const toInstall = hubSkills.filter((s) => s.id && !localSkillIds.has(s.id));
  const alreadyInstalled = hubSkills.filter((s) => s.id && localSkillIds.has(s.id));
  mainLog('remoteToLocalSync', `Skills to install: ${toInstall.length}`);

  const result: SyncResult = {
    installed: [],
    skipped: alreadyInstalled.map((s) => s.name),
    failed: [],
  };

  // 4. 逐个安装（优先使用新版 API）
  for (const skill of toInstall) {
    try {
      if (skill.id) {
        // 新版 API：通过 ID 直接下载
        await installSkillById(skill, serverUrl, token);
      } else {
        // 回退到旧版 API：通过名称获取详情后下载
        mainWarn('remoteToLocalSync', `Skill ${skill.name} has no ID, falling back to legacy API`);
        const detail = await getSkillInstallDetail(skill.name, serverUrl, token);
        await installSkillToLocal(detail);
      }
      result.installed.push(skill.name);
    } catch (error) {
      mainError('remoteToLocalSync', `Failed to install skill ${skill.name}:`, error);
      result.failed.push({
        id: skill.id || '',
        name: skill.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  mainLog('remoteToLocalSync', `Skill sync completed: installed=${result.installed.length}, skipped=${result.skipped.length}, failed=${result.failed.length}`);

  return result;
}

/**
 * 同步远程 assistants 到本地
 * 优先使用新版 API（通过 ID 下载），失败时回退到旧版 API
 *
 * 注意：只同步 isHubInstalled: true 的助手（从助手库安装的）
 * 自定义助手和专属助手由各自的同步逻辑处理
 */
export async function syncRemoteAssistantsToLocal(): Promise<SyncResult> {
  const serverUrl = ProcessConfig.getSync('eeclaw.serverUrl');
  if (!serverUrl) {
    throw new Error('Server URL not configured');
  }

  const token = await getValidToken();

  mainLog('remoteToLocalSync', 'Starting assistant sync...');

  // 1. 获取远程已安装列表
  const remoteAssistants = await getRemoteAssistantsInstalled(serverUrl, token);
  mainLog('remoteToLocalSync', `Remote assistants: ${remoteAssistants.length}`);

  // 1.5 只同步从助手库安装的助手（isHubInstalled: true）
  // 自定义助手和专属助手由各自的同步逻辑处理
  const hubAssistants = remoteAssistants.filter((a) => a.isHubInstalled === true);
  mainLog('remoteToLocalSync', `Hub assistants (isHubInstalled=true): ${hubAssistants.length}`);

  // 2. 获取本地已安装列表（按 ID 判断）
  const localAssistantIds = await getLocalInstalledAssistantIds();
  mainLog('remoteToLocalSync', `Local assistants (by ID): ${localAssistantIds.size}`);

  // 3. 计算差异（按 ID）
  const toInstall = hubAssistants.filter((a) => a.id && !localAssistantIds.has(a.id));
  const alreadyInstalled = hubAssistants.filter((a) => a.id && localAssistantIds.has(a.id));
  mainLog('remoteToLocalSync', `Assistants to install: ${toInstall.length}`);

  const result: SyncResult = {
    installed: [],
    skipped: alreadyInstalled.map((a) => a.name),
    failed: [],
  };

  // 4. 逐个安装（优先使用新版 API）
  for (const assistant of toInstall) {
    try {
      if (assistant.id) {
        // 新版 API：通过 ID 直接下载
        await installAssistantById(assistant, serverUrl, token);
      } else {
        // 回退到旧版 API：通过名称获取详情后下载
        mainWarn('remoteToLocalSync', `Assistant ${assistant.name} has no ID, falling back to legacy API`);
        const detail = await getAssistantInstallDetail(assistant.name, serverUrl, token);
        await installAssistantToLocal(detail);
      }
      result.installed.push(assistant.name);
    } catch (error) {
      mainError('remoteToLocalSync', `Failed to install assistant ${assistant.name}:`, error);
      result.failed.push({
        id: assistant.id || '',
        name: assistant.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  mainLog('remoteToLocalSync', `Assistant sync completed: installed=${result.installed.length}, skipped=${result.skipped.length}, failed=${result.failed.length}`);

  return result;
}

/**
 * 全量同步（登录成功后调用）
 *
 * 并行同步 hub skills/assistants 和 tenant skills/assistants
 */
export async function syncAllFromRemote(): Promise<SyncAllResult> {
  mainLog('remoteToLocalSync', 'Starting full sync from remote...');

  // 并行同步 hub 和 tenant
  const [hubSkills, hubAssistants, tenantSkills, tenantAssistants] = await Promise.all([
    syncRemoteSkillsToLocal().catch((error) => {
      mainError('remoteToLocalSync', 'Hub skill sync failed:', error);
      return { installed: [] as string[], skipped: [] as string[], failed: [] as Array<{ id: string; name: string; error: string }> };
    }),
    syncRemoteAssistantsToLocal().catch((error) => {
      mainError('remoteToLocalSync', 'Hub assistant sync failed:', error);
      return { installed: [] as string[], skipped: [] as string[], failed: [] as Array<{ id: string; name: string; error: string }> };
    }),
    syncTenantSkillsToLocal().catch((error) => {
      mainError('remoteToLocalSync', 'Tenant skill sync failed:', error);
      return { installed: [] as string[], skipped: [] as string[], failed: [] as Array<{ id: string; name: string; error: string }> };
    }),
    syncTenantAssistantsToLocal().catch((error) => {
      mainError('remoteToLocalSync', 'Tenant assistant sync failed:', error);
      return { installed: [] as string[], skipped: [] as string[], failed: [] as Array<{ id: string; name: string; error: string }> };
    }),
  ]);

  mainLog('remoteToLocalSync', 'Full sync completed', {
    hubSkills: hubSkills.installed.length,
    hubAssistants: hubAssistants.installed.length,
    tenantSkills: tenantSkills.installed.length,
    tenantAssistants: tenantAssistants.installed.length,
  });

  return {
    skills: { hub: hubSkills, tenant: tenantSkills },
    assistants: { hub: hubAssistants, tenant: tenantAssistants },
  };
}

/**
 * 增量同步（切换到 Local 模式时调用）
 *
 * 仅同步差异部分，比全量同步更快
 */
export async function syncIncrementalFromRemote(): Promise<SyncAllResult> {
  // 增量同步逻辑与全量同步相同，只是调用时机不同
  // 差异计算已在 syncRemoteSkillsToLocal/syncRemoteAssistantsToLocal 中实现
  return syncAllFromRemote();
}

// ============ Tenant 同步逻辑 ============

/**
 * 同步专属技能到本地 tenant 目录
 */
async function syncTenantSkillsToLocal(): Promise<SyncResult> {
  const { fetchTenantSkills, installTenantSkill } = await import('./tenantSync');

  mainLog('remoteToLocalSync', 'Starting tenant skill sync...');

  // 1. 获取远程专属技能列表（只获取已审核通过的）
  const remoteSkills = await fetchTenantSkills();
  const approvedSkills = remoteSkills.filter((s) => s.status === 'approved');
  mainLog('remoteToLocalSync', `Remote tenant skills (approved): ${approvedSkills.length}`);

  // 2. 获取本地已安装的专属技能 ID（包括 _disable 目录）
  const localSkillIds = await getLocalTenantSkillIds();
  mainLog('remoteToLocalSync', `Local tenant skills (by ID): ${localSkillIds.size}`);

  // 3. 计算差异
  const toInstall = approvedSkills.filter((s) => s.id && !localSkillIds.has(s.id));
  const alreadyInstalled = approvedSkills.filter((s) => s.id && localSkillIds.has(s.id));
  mainLog('remoteToLocalSync', `Tenant skills to install: ${toInstall.length}, already installed: ${alreadyInstalled.length}`);

  const result: SyncResult = {
    installed: [],
    skipped: alreadyInstalled.map((s) => s.name),
    failed: [],
  };

  // 4. 逐个安装
  for (const skill of toInstall) {
    try {
      const installResult = await installTenantSkill(skill.id);
      if (installResult.success) {
        result.installed.push(skill.name);
      } else {
        result.failed.push({
          id: skill.id,
          name: skill.name,
          error: installResult.error || 'Unknown error',
        });
      }
    } catch (error) {
      mainError('remoteToLocalSync', `Failed to install tenant skill ${skill.name}:`, error);
      result.failed.push({
        id: skill.id,
        name: skill.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  mainLog('remoteToLocalSync', `Tenant skill sync completed: installed=${result.installed.length}, skipped=${result.skipped.length}, failed=${result.failed.length}`);

  return result;
}

/**
 * 同步专属助手到本地 tenant 目录
 */
async function syncTenantAssistantsToLocal(): Promise<SyncResult> {
  const { fetchTenantAssistants, installTenantAssistant } = await import('./tenantSync');

  mainLog('remoteToLocalSync', 'Starting tenant assistant sync...');

  // 1. 获取远程专属助手列表（只获取已审核通过的）
  const remoteAssistants = await fetchTenantAssistants();
  const approvedAssistants = remoteAssistants.filter((a) => a.status === 'approved');
  mainLog('remoteToLocalSync', `Remote tenant assistants (approved): ${approvedAssistants.length}`);

  // 2. 获取本地已安装的专属助手 ID（包括 _disable 目录）
  const localAssistantIds = await getLocalTenantAssistantIds();
  mainLog('remoteToLocalSync', `Local tenant assistants (by ID): ${localAssistantIds.size}`);

  // 3. 计算差异
  const toInstall = approvedAssistants.filter((a) => a.id && !localAssistantIds.has(a.id));
  const alreadyInstalled = approvedAssistants.filter((a) => a.id && localAssistantIds.has(a.id));
  mainLog('remoteToLocalSync', `Tenant assistants to install: ${toInstall.length}, already installed: ${alreadyInstalled.length}`);

  const result: SyncResult = {
    installed: [],
    skipped: alreadyInstalled.map((a) => a.name),
    failed: [],
  };

  // 4. 逐个安装
  for (const assistant of toInstall) {
    try {
      const installResult = await installTenantAssistant(assistant.id);
      if (installResult.success) {
        result.installed.push(assistant.name);
      } else {
        result.failed.push({
          id: assistant.id,
          name: assistant.name,
          error: installResult.error || 'Unknown error',
        });
      }
    } catch (error) {
      mainError('remoteToLocalSync', `Failed to install tenant assistant ${assistant.name}:`, error);
      result.failed.push({
        id: assistant.id,
        name: assistant.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  mainLog('remoteToLocalSync', `Tenant assistant sync completed: installed=${result.installed.length}, skipped=${result.skipped.length}, failed=${result.failed.length}`);

  return result;
}

/**
 * 获取本地已安装的专属技能 ID 集合（包括 _disable 目录）
 */
async function getLocalTenantSkillIds(): Promise<Set<string>> {
  const ids = new Set<string>();

  if (!isEnterpriseMode()) {
    return ids;
  }

  try {
    const tenantDir = getEnterpriseTenantSkillsDir();
    if (!existsSync(tenantDir)) {
      return ids;
    }

    // 扫描 tenant/ 和 tenant/_disable/ 目录
    const dirsToScan = [tenantDir];
    const disableDir = path.join(tenantDir, '_disable');
    if (existsSync(disableDir)) {
      dirsToScan.push(disableDir);
    }

    for (const dir of dirsToScan) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('_')) continue;

        const skillDir = path.join(dir, entry.name);
        const metaFileName = getSkillMetaFileName();
        const metaPath = path.join(skillDir, metaFileName);

        if (existsSync(metaPath)) {
          try {
            const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as ISkillHubMeta;
            if (meta.id) {
              ids.add(meta.id);
            }
          } catch {
            // Ignore invalid meta
          }
        }
      }
    }
  } catch (error) {
    mainWarn('remoteToLocalSync', 'Failed to get local tenant skill IDs:', error);
  }

  return ids;
}

/**
 * 获取本地已安装的专属助手 ID 集合（包括 _disable 目录）
 */
async function getLocalTenantAssistantIds(): Promise<Set<string>> {
  const ids = new Set<string>();

  if (!isEnterpriseMode()) {
    return ids;
  }

  try {
    const tenantDir = getEnterpriseTenantAssistantsDir();
    if (!existsSync(tenantDir)) {
      return ids;
    }

    // 扫描 tenant/ 和 tenant/_disable/ 目录
    const dirsToScan = [tenantDir];
    const disableDir = path.join(tenantDir, '_disable');
    if (existsSync(disableDir)) {
      dirsToScan.push(disableDir);
    }

    for (const dir of dirsToScan) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('_')) continue;

        const assistantDir = path.join(dir, entry.name);
        const metaFileName = getAssistantMetaFileName();
        const metaPath = path.join(assistantDir, metaFileName);

        if (existsSync(metaPath)) {
          try {
            const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as IAssistantMeta;
            if (meta.id) {
              ids.add(meta.id);
            }
          } catch {
            // Ignore invalid meta
          }
        }
      }
    }
  } catch (error) {
    mainWarn('remoteToLocalSync', 'Failed to get local tenant assistant IDs:', error);
  }

  return ids;
}
