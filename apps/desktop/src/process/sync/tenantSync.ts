/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tenant Skill/Assistant Module
 *
 * 企业专属技能/助手模块
 *
 * 功能：
 * 1. 获取专属技能/助手列表（GET /api/v1/skills/tenant, /api/v1/agents/tenant）
 * 2. 下载并安装专属内容（GET /api/v1/skills/tenant/{id}/download）
 * 3. 发布专属申请（POST /api/v1/skills/tenant/publish）
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import JSZip from 'jszip';
import type { ISkillHubMeta } from '@sudowork/host-bridge/ipcBridge';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { getEnterpriseConfig } from '@/common/enterpriseDebugConfig';
import { initEnterpriseDirs, getEnterpriseTenantSkillsDir, getEnterpriseTenantAssistantsDir, getSkillMetaFileName, getAssistantMetaFileName } from '@/process/constants/enterpriseStorage';
import type { IAssistantMeta } from '@/process/constants/assistantStorage';
import { downloadFileWithAuth } from './remoteToLocalSync';

// ============ 类型定义 ============

/** Tenant skill info from Moss Server */
export interface TenantSkillInfo {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  status: 'pending' | 'approved' | 'rejected';
  author?: string;
  authorName?: string;
  approvedAt?: string;
  submittedAt?: string;
  installed?: boolean;
}

/** Tenant assistant info from Moss Server */
export interface TenantAssistantInfo {
  id: string;
  name: string;
  /** API may return display_name or displayName */
  display_name?: string;
  displayName?: string;
  description?: string;
  version?: string;
  status: 'pending' | 'approved' | 'rejected';
  author?: string;
  authorName?: string;
  enabledSkills?: string[];
  memoryMode?: 'session' | 'user';
  approvedAt?: string;
  submittedAt?: string;
  installed?: boolean;
}

/** Publish request result */
export interface PublishResult {
  success: boolean;
  id?: string;
  skillId?: string;
  assistantId?: string;
  skillName?: string;
  assistantName?: string;
  status?: string;
  message?: string;
  error?: string;
}

// ============ 工具函数 ============

function getMossConfig(): { serverUrl: string; token: string } {
  const config = getEnterpriseConfig();
  return {
    serverUrl: config.mossServerUrl,
    token: config.authToken,
  };
}

async function extractZipToDirectory(zipBuffer: Buffer, targetDir: string): Promise<void> {
  const zip = await JSZip.loadAsync(zipBuffer);

  await fs.mkdir(targetDir, { recursive: true });

  for (const [entryPath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;

    // Normalize path
    const normalizedPath = entryPath.replace(/^\/+/, '').replace(/\\/g, '/');
    if (normalizedPath.startsWith('..') || normalizedPath.includes('/..')) {
      mainWarn('TenantSync', `Skipping unsafe path: ${entryPath}`);
      continue;
    }

    const fullPath = path.join(targetDir, normalizedPath);
    const fullDir = path.dirname(fullPath);

    if (!existsSync(fullDir)) {
      mkdirSync(fullDir, { recursive: true });
    }

    const content = await zipEntry.async('nodebuffer');
    await fs.writeFile(fullPath, content);
  }
}

// ============ 专属技能 API ============

/**
 * Fetch tenant skills list from Moss Server
 */
export async function fetchTenantSkills(): Promise<TenantSkillInfo[]> {
  const { serverUrl, token } = getMossConfig();

  if (!serverUrl || !token) {
    throw new Error('Moss Server not configured or not authenticated');
  }

  const response = await fetch(`${serverUrl}/api/v1/skills/tenant`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch tenant skills: HTTP ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : data.data || [];
}

/**
 * Install tenant skill to local
 */
export async function installTenantSkill(skillId: string): Promise<{ success: boolean; name?: string; error?: string }> {
  const { serverUrl, token } = getMossConfig();

  if (!serverUrl || !token) {
    return { success: false, error: 'Moss Server not configured or not authenticated' };
  }

  try {
    // Initialize enterprise directories
    initEnterpriseDirs();

    // Get skill info first
    const skills = await fetchTenantSkills();
    const skill = skills.find((s) => s.id === skillId);

    if (!skill) {
      return { success: false, error: `Tenant skill not found: ${skillId}` };
    }

    if (skill.status !== 'approved') {
      return { success: false, error: `Skill is not approved: ${skill.status}` };
    }

    // Download skill package
    const downloadUrl = `${serverUrl}/api/v1/skills/tenant/${skillId}/download`;
    mainLog('TenantSync', `Downloading tenant skill: ${skill.name} from ${downloadUrl}`);

    const zipBuffer = await downloadFileWithAuth(downloadUrl, token, (percent) => {
      if (percent % 20 === 0) {
        mainLog('TenantSync', `Download progress for ${skill.name}: ${percent}%`);
      }
    });

    // Extract to tenant directory
    const tenantDir = getEnterpriseTenantSkillsDir();
    await fs.mkdir(tenantDir, { recursive: true });

    const skillDir = path.join(tenantDir, skill.name);

    // Remove existing if present
    if (existsSync(skillDir)) {
      await fs.rm(skillDir, { recursive: true, force: true });
    }

    await extractZipToDirectory(zipBuffer, skillDir);

    // Write metadata
    const meta: ISkillHubMeta = {
      id: skill.id,
      name: skill.name,
      display_name: skill.displayName || skill.name,
      description: skill.description || '',
      icon: '',
      emoji: null,
      category: '',
      categories: [],
      applicable_scenarios: null,
      core_features: null,
      homepage: null,
      author_id: skill.author || '',
      source_type: 'hub', // Tenant skills are also hub-type
      is_builtin: false,
      enabled: true,
      installed_version: skill.version || '1.0.0',
      installed_at: new Date().toISOString(),
    };

    const metaFileName = getSkillMetaFileName();
    const metaPath = path.join(skillDir, metaFileName);
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

    mainLog('TenantSync', `Successfully installed tenant skill: ${skill.name}`);
    return { success: true, name: skill.name };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    mainError('TenantSync', `Failed to install tenant skill ${skillId}:`, error);
    return { success: false, error: errorMsg };
  }
}

/**
 * Publish skill as tenant-exclusive
 */
export async function publishTenantSkill(skillId: string, publishNote?: string): Promise<PublishResult> {
  const { serverUrl, token } = getMossConfig();

  if (!serverUrl || !token) {
    return { success: false, error: 'Moss Server not configured or not authenticated' };
  }

  const url = `${serverUrl}/api/v1/skills/tenant/publish`;
  const requestBody = {
    skillId,
    publishNote: publishNote || '',
  };

  mainLog('TenantSync', `[Publish Skill] Request URL: ${url}`);
  mainLog('TenantSync', `[Publish Skill] Request body: ${JSON.stringify(requestBody)}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    mainLog('TenantSync', `[Publish Skill] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      mainError('TenantSync', `[Publish Skill] Error response: ${errorText}`);
      return { success: false, error: `Publish failed: HTTP ${response.status} - ${errorText}` };
    }

    const result = await response.json();
    mainLog('TenantSync', `[Publish Skill] Success response: ${JSON.stringify(result)}`);

    return {
      success: true,
      id: result.id,
      skillId: result.skillId || skillId,
      skillName: result.skillName,
      status: result.status || 'pending',
      message: result.message,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    mainError('TenantSync', `Failed to publish skill ${skillId}:`, error);
    return { success: false, error: errorMsg };
  }
}

// ============ 专属助手 API ============

/**
 * Fetch tenant assistants list from Moss Server
 */
export async function fetchTenantAssistants(): Promise<TenantAssistantInfo[]> {
  const { serverUrl, token } = getMossConfig();

  if (!serverUrl || !token) {
    throw new Error('Moss Server not configured or not authenticated');
  }

  const response = await fetch(`${serverUrl}/api/v1/agents/tenant`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch tenant assistants: HTTP ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : data.data || [];
}

/**
 * Install tenant assistant to local
 * Moss Server already sets correct metadata (id=UUID, source_type=tenant) during approval.
 * Sudowork just needs to download and extract to tenant directory.
 */
export async function installTenantAssistant(assistantId: string): Promise<{ success: boolean; name?: string; error?: string }> {
  const { serverUrl, token } = getMossConfig();

  if (!serverUrl || !token) {
    return { success: false, error: 'Moss Server not configured or not authenticated' };
  }

  try {
    // Initialize enterprise directories
    initEnterpriseDirs();

    // Get assistant info first
    const assistants = await fetchTenantAssistants();
    const assistant = assistants.find((a) => a.id === assistantId);

    if (!assistant) {
      return { success: false, error: `Tenant assistant not found: ${assistantId}` };
    }

    if (assistant.status !== 'approved') {
      return { success: false, error: `Assistant is not approved: ${assistant.status}` };
    }

    // Download assistant package
    const downloadUrl = `${serverUrl}/api/v1/agents/tenant/${assistantId}/download`;
    mainLog('TenantSync', `Downloading tenant assistant: ${assistant.name} from ${downloadUrl}`);

    const zipBuffer = await downloadFileWithAuth(downloadUrl, token, (percent) => {
      if (percent % 20 === 0) {
        mainLog('TenantSync', `Download progress for ${assistant.name}: ${percent}%`);
      }
    });

    // Extract to temp directory first to read original metadata
    const tempDir = path.join(path.dirname(getEnterpriseTenantAssistantsDir()), '.temp-tenant-' + Date.now());
    await fs.mkdir(tempDir, { recursive: true });

    try {
      await extractZipToDirectory(zipBuffer, tempDir);

      // Find the assistant directory (might be nested)
      let extractedDir = tempDir;
      const entries = await fs.readdir(tempDir, { withFileTypes: true });
      if (entries.length === 1 && entries[0].isDirectory()) {
        extractedDir = path.join(tempDir, entries[0].name);
      }

      // Read original metadata to get the UUID (Moss Server sets correct id=UUID)
      const originalMeta = await readAssistantMetaFromDir(extractedDir);
      const assistantUuid = originalMeta?.id || path.basename(extractedDir);

      // Move to tenant directory with UUID as directory name
      const tenantDir = getEnterpriseTenantAssistantsDir();
      await fs.mkdir(tenantDir, { recursive: true });

      const assistantDir = path.join(tenantDir, assistantUuid);

      // Remove existing if present
      if (existsSync(assistantDir)) {
        await fs.rm(assistantDir, { recursive: true, force: true });
      }

      // Move extracted directory to final location (preserves original metadata from Moss)
      await fs.rename(extractedDir, assistantDir);

      mainLog('TenantSync', `Successfully installed tenant assistant: ${assistantUuid}`);
      return { success: true, name: assistantUuid };
    } finally {
      // Cleanup temp directory
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    mainError('TenantSync', `Failed to install tenant assistant ${assistantId}:`, error);
    return { success: false, error: errorMsg };
  }
}

/**
 * Read assistant metadata from a directory
 */
async function readAssistantMetaFromDir(assistantDir: string): Promise<IAssistantMeta | null> {
  const metaFiles = ['_moss_meta.json', '_sudowork_meta.json'];

  for (const fileName of metaFiles) {
    const filePath = path.join(assistantDir, fileName);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as IAssistantMeta;
    } catch {
      // Try next file
    }
  }
  return null;
}

/**
 * Publish assistant as tenant-exclusive
 */
export async function publishTenantAssistant(assistantId: string, publishNote?: string): Promise<PublishResult> {
  const { serverUrl, token } = getMossConfig();

  if (!serverUrl || !token) {
    return { success: false, error: 'Moss Server not configured or not authenticated' };
  }

  const url = `${serverUrl}/api/v1/agents/tenant/publish`;
  const requestBody = {
    assistantId,
    publishNote: publishNote || '',
  };

  mainLog('TenantSync', `[Publish Assistant] Request URL: ${url}`);
  mainLog('TenantSync', `[Publish Assistant] Request body: ${JSON.stringify(requestBody)}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    mainLog('TenantSync', `[Publish Assistant] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      mainError('TenantSync', `[Publish Assistant] Error response: ${errorText}`);
      return { success: false, error: `Publish failed: HTTP ${response.status} - ${errorText}` };
    }

    const result = await response.json();
    mainLog('TenantSync', `[Publish Assistant] Success response: ${JSON.stringify(result)}`);

    return {
      success: true,
      id: result.id,
      assistantId: result.assistantId || assistantId,
      assistantName: result.assistantName,
      status: result.status || 'pending',
      message: result.message,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    mainError('TenantSync', `Failed to publish assistant ${assistantId}:`, error);
    return { success: false, error: errorMsg };
  }
}
