/**
 * IPC bridge for Assistant Hub — mirrors skillHubBridge pattern.
 * Hub API calls for fetching assistants, categories, and installing from Hub.
 */

import { ipcBridge } from '@/common';
import type { IAssistantHubSkill, IAssistantHubListResponse, IAssistantHubDetail, IAssistantInstallResult, ISkillHubSkill } from '@/common/ipcBridge';
import type { IBridgeResponse } from '@/common/ipcBridge';
import { assistantManager } from '@/process/AssistantManager';
import { getAssistantsDir, getHubAssistantsDir, getSystemAssistantsDir } from '@/process/initStorage';
import { skillManager } from '@/process/SkillManager';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import https from 'node:https';
import http from 'node:http';
import JSZip from 'jszip';

// Hub API constants (same service as Skill Hub)
const ASSISTANT_HUB_BASE_URL = 'https://sudoclawhub.sudoprivacy.com/api/assistants';
const ASSISTANT_HUB_CURSOR_URL = 'https://sudoclawhub.sudoprivacy.com/api/assistants/cursor';
const ASSISTANT_CATEGORY_URL = 'https://sudoclawhub.sudoprivacy.com/api/categories';
const AUTHORIZATION = 'sud0@sudo';
const ASSISTANT_META_FILE = '_sudowork_meta.json';

type AssistantHubMeta = import('@/process/constants/assistantStorage').IAssistantMeta;

// ==================== Helper Functions ====================

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
          'User-Agent': 'Sudowork-AssistantHub/1.0',
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

/**
 * Normalize zip entry path
 */
function normalizeZipEntryPath(entryPath: string): string {
  return path.posix.normalize(entryPath.replaceAll('\\', '/').replace(/^\.\/+/, ''));
}

/**
 * Check if zip entry path is unsafe
 */
function isUnsafeZipEntryPath(entryPath: string): boolean {
  if (!entryPath || entryPath === '.') return false;
  if (/^[a-zA-Z]:[\\/]/.test(entryPath)) return true;
  if (entryPath.startsWith('/') || entryPath.startsWith('\\')) return true;
  const normalized = normalizeZipEntryPath(entryPath);
  return normalized === '..' || normalized.startsWith('../');
}

/**
 * Resolve zip layout (handle top-level directory wrapper)
 * If all files are under a single top-level directory, strip it
 */
function resolveZipAssistantLayout(zip: JSZip): { stripPrefix: string } {
  const fileEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => normalizeZipEntryPath(entry.name))
    // Skip macOS system files
    .filter((entryPath) => !entryPath.includes('__MACOSX') && !entryPath.endsWith('.DS_Store'))
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

  // No wrapper directory or multiple directories - extract directly
  return { stripPrefix: '' };
}

/**
 * Extract assistant zip to directory
 */
async function extractAssistantZipToDirectory(zipBuffer: Buffer, assistantDir: string): Promise<void> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const { stripPrefix } = resolveZipAssistantLayout(zip);

  await fs.mkdir(assistantDir, { recursive: true });

  for (const zipEntry of Object.values(zip.files)) {
    if (zipEntry.dir) continue;
    if (isUnsafeZipEntryPath(zipEntry.name)) {
      throw new Error(`Unsafe zip entry path: ${zipEntry.name}`);
    }

    const normalizedPath = normalizeZipEntryPath(zipEntry.name);
    // Skip macOS system files
    if (normalizedPath.includes('__MACOSX') || normalizedPath.endsWith('.DS_Store')) continue;

    let targetPath = normalizedPath;

    if (stripPrefix) {
      if (!normalizedPath.startsWith(stripPrefix)) continue;
      targetPath = normalizedPath.slice(stripPrefix.length);
    }

    if (!targetPath) continue;

    const fullPath = path.join(assistantDir, targetPath);
    const fullDir = path.dirname(fullPath);
    await fs.mkdir(fullDir, { recursive: true });

    const content = await zipEntry.async('nodebuffer');
    await fs.writeFile(fullPath, content);
  }
}

/**
 * Scan directory for .md files and select the best one as ruleFile
 * Priority: {assistantName}.md > any .md file
 */
async function selectRuleFileFromDirectory(assistantDir: string, assistantName: string): Promise<string | undefined> {
  try {
    const files = await fs.readdir(assistantDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    if (mdFiles.length === 0) return undefined;

    // Priority 1: {assistantName}.md
    const primaryRuleFile = mdFiles.find((f) => f === `${assistantName}.md`);
    if (primaryRuleFile) return primaryRuleFile;

    // Priority 2: Any .md file (first one)
    return mdFiles[0];
  } catch {
    return undefined;
  }
}

// ==================== Bridge Initialization ====================

export function initAssistantHubBridge(): void {
  mainLog('AssistantHub', 'Initializing AssistantHub bridge...');

  // === Local CRUD operations ===

  ipcBridge.assistantHub.getInstalledAssistants.provider(async () => {
    try {
      const assistants = await assistantManager.getInstalledAssistants();
      return { success: true, data: assistants };
    } catch (error) {
      mainError('AssistantHub', 'Failed to get installed assistants:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.assistantHub.enableAssistant.provider(async ({ name }) => {
    const result = await assistantManager.enableAssistant(name);
    return result.success
      ? { success: true, data: undefined }
      : { success: false, msg: result.msg };
  });

  ipcBridge.assistantHub.disableAssistant.provider(async ({ name }) => {
    const result = await assistantManager.disableAssistant(name);
    return result.success
      ? { success: true, data: undefined }
      : { success: false, msg: result.msg };
  });

  ipcBridge.assistantHub.updateAssistantMeta.provider(async ({ name, updates }) => {
    const result = await assistantManager.updateAssistantMeta(name, updates);
    return result.success
      ? { success: true, data: undefined }
      : { success: false, msg: result.msg };
  });

  ipcBridge.assistantHub.getAssistantMeta.provider(async ({ name }) => {
    try {
      const meta = await assistantManager.getAssistantMeta(name);
      return { success: true, data: meta };
    } catch (error) {
      mainError('AssistantHub', 'Failed to get assistant meta:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.assistantHub.createAssistant.provider(async ({ meta, ruleContent }) => {
    const result = await assistantManager.createAssistant(meta, ruleContent);
    return result.success
      ? { success: true, data: undefined }
      : { success: false, msg: result.msg };
  });

  ipcBridge.assistantHub.uninstallAssistant.provider(async ({ name }) => {
    const result = await assistantManager.uninstallAssistant(name);
    return result.success
      ? { success: true, data: undefined }
      : { success: false, msg: result.msg };
  });

  // === Hub API operations ===

  // Fetch assistants list from Hub API with cursor-based pagination
  ipcBridge.assistantHub.fetchAssistants.provider(async ({ cursor, limit = 20, query = '', category = '', tenantId }) => {
    try {
      mainLog('AssistantHub', 'Fetching assistants with params:', { cursor, limit, query, category, tenantId });
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      if (limit) params.set('limit', String(limit));
      if (query) params.set('query', query);
      if (category) params.set('category', category);
      if (typeof tenantId === 'string' && tenantId.trim()) params.set('tenant_id', tenantId.trim());

      const response = await fetch(`${ASSISTANT_HUB_CURSOR_URL}?${params}`, {
        headers: { Authorization: AUTHORIZATION },
      });
      const result = await response.json();
      mainLog('AssistantHub', 'Assistants raw response:', JSON.stringify(result, null, 2));

      // Map API response to our type structure
      // API returns: { data: { assistants: [{ id, name, profession, description, avatar, categories, sourceUrl, ... }] } }
      const rawAssistants = result.data?.assistants || [];

      const mappedAssistants = rawAssistants.map((a: Record<string, unknown>): IAssistantHubSkill => ({
        id: a.id as string,
        name: a.name as string,
        display_name: (a.profession as string) || (a.name as string),
        description: a.description as string,
        avatar: a.avatar as string | null,
        emoji: null as string | null,
        // Use categories array from API (may be null)
        categories: (a.categories as string[]) || [],
        category: ((a.categories as string[]) || [])[0] || '',
        preset_agent_type: null as string | null,
        skills: (a.skills as string[]) || [] as string[],
        tag: 'hub' as const,
        homepage: null as string | null,
        author_id: '',
        star_count: 0,
        applicable_scenarios: null as string | null,
        core_features: null as string | null,
        created_at: a.createdAt as string,
        updated_at: a.updatedAt as string,
        // Store sourceUrl for download (not in original type but needed for install)
        _sourceUrl: a.sourceUrl as string,
      }));

      const mappedData = {
        assistants: mappedAssistants,
        next_cursor: result.data?.next_cursor || null,
        has_more: result.data?.has_more || false,
      };

      mainLog('AssistantHub', 'Mapped assistants:', mappedData.assistants.length);
      return { success: true, data: mappedData };
    } catch (error) {
      mainError('AssistantHub', 'Failed to fetch assistants:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Fetch assistant categories from Hub API (type=1 for assistants)
  ipcBridge.assistantHub.fetchCategories.provider(async () => {
    try {
      mainLog('AssistantHub', 'Fetching assistant categories');
      const response = await fetch(`${ASSISTANT_CATEGORY_URL}?type=1`, {
        headers: { Authorization: AUTHORIZATION },
      });
      const data = await response.json();
      mainLog('AssistantHub', 'Categories response:', data);
      return { success: true, data: data.data || [] };
    } catch (error) {
      mainError('AssistantHub', 'Failed to fetch categories:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Fetch assistant detail from Hub API
  ipcBridge.assistantHub.fetchAssistantDetail.provider(async ({ assistantId }) => {
    try {
      mainLog('AssistantHub', 'Fetching assistant detail:', assistantId);
      const url = `${ASSISTANT_HUB_BASE_URL}/${assistantId}`;
      mainLog('AssistantHub', 'Request URL:', url);
      const response = await fetch(url, {
        headers: { Authorization: AUTHORIZATION },
      });
      mainLog('AssistantHub', 'Response status:', response.status);
      const data = await response.json();
      mainLog('AssistantHub', 'Assistant detail response:', JSON.stringify(data, null, 2));
      return { success: true, data: data.data };
    } catch (error) {
      mainError('AssistantHub', 'Failed to fetch assistant detail:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Fetch skill details by IDs from Skill Hub API (for installation preview)
  ipcBridge.assistantHub.fetchSkillDetailsByIds.provider(async ({ skillIds }) => {
    try {
      if (!skillIds || skillIds.length === 0) {
        return { success: true, data: [] };
      }

      mainLog('AssistantHub', `Fetching skill details for IDs: ${skillIds.join(', ')}`);

      // Fetch all skills in parallel
      const responses = await Promise.all(
        skillIds.map(async (id) => {
          try {
            const response = await fetch(`https://sudoclawhub.sudoprivacy.com/api/skills/${id}`, {
              headers: { Authorization: AUTHORIZATION },
            });
            const data = await response.json();
            if (data.success && data.data?.skill) {
              return data.data.skill as ISkillHubSkill;
            }
            return null;
          } catch (err) {
            mainWarn('AssistantHub', `Failed to fetch skill ${id}:`, err);
            return null;
          }
        })
      );

      const skills = responses.filter((s): s is ISkillHubSkill => s !== null);
      mainLog('AssistantHub', `Fetched ${skills.length} skill details`);
      return { success: true, data: skills };
    } catch (error) {
      mainError('AssistantHub', 'Failed to fetch skill details:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Download and install assistant from Hub, optionally installing selected associated skills
  ipcBridge.assistantHub.downloadAndInstallAssistant.provider(async ({ assistantName, displayName, sourceUrl, version, checksum, assistantMeta, selectedSkillIds }) => {
    try {
      mainLog('AssistantHub', `Downloading assistant: ${assistantName} version: ${version}`);
      mainLog('AssistantHub', `Selected skills to install: ${selectedSkillIds?.join(', ') || 'none'}`);

      // Download zip file
      const zipBuffer = await downloadFile(sourceUrl, (percent) => {
        mainLog('AssistantHub', `Download progress: ${percent}%`);
      });

      // Verify checksum if provided
      if (checksum) {
        const isValid = await verifyChecksum(zipBuffer, checksum);
        if (!isValid) {
          mainWarn('AssistantHub', 'Checksum verification failed, but continuing anyway');
        }
      }

      // Determine target directory based on tag type
      const targetDir = assistantMeta.tag === 'system' ? getSystemAssistantsDir() : getHubAssistantsDir();
      await fs.mkdir(targetDir, { recursive: true });

      const assistantDir = path.join(targetDir, assistantName);

      // Remove existing if present
      try {
        await fs.access(assistantDir);
        await fs.rm(assistantDir, { recursive: true, force: true });
      } catch {
        // Directory doesn't exist
      }

      await fs.mkdir(assistantDir, { recursive: true });

      // Extract zip contents
      await extractAssistantZipToDirectory(zipBuffer, assistantDir);

      // Scan for .md files and select ruleFile
      const ruleFile = await selectRuleFileFromDirectory(assistantDir, assistantName);
      mainLog('AssistantHub', `Selected ruleFile: ${ruleFile}`);

      // Install selected associated skills FIRST, collect skill names for meta
      const installedSkillNames: string[] = [];
      const failedSkillIds: string[] = [];
      const allAssociatedSkillNames: string[] = []; // All skill names (installed + already installed)

      if (selectedSkillIds && selectedSkillIds.length > 0) {
        mainLog('AssistantHub', `Installing selected skills: ${selectedSkillIds.join(', ')}`);

        // Get current installed skills to check which need installation
        const installedSkills = await skillManager.getInstalledSkills();
        const installedSkillNamesSet = new Set(installedSkills.map((s) => s.name));

        for (const skillId of selectedSkillIds) {
          // Fetch skill detail from Hub to get name and download URL
          try {
            const skillDetailResponse = await fetch(`https://sudoclawhub.sudoprivacy.com/api/skills/${skillId}`, {
              headers: { Authorization: AUTHORIZATION },
            });
            const skillDetailData = await skillDetailResponse.json();

            if (skillDetailData.success && skillDetailData.data?.skill) {
              const skillInfo = skillDetailData.data.skill as ISkillHubSkill;
              const skillName = skillInfo.name;

              // Track all associated skill names (for enabledSkills)
              allAssociatedSkillNames.push(skillName);

              // Skip if already installed
              if (installedSkillNamesSet.has(skillName)) {
                mainLog('AssistantHub', `Skill "${skillName}" already installed, skipping download`);
                continue;
              }

              // Need version info for download
              if (!skillDetailData.data?.versions?.[0]) {
                mainWarn('AssistantHub', `Skill "${skillName}" has no versions available`);
                failedSkillIds.push(skillId);
                continue;
              }

              const latestVersion = skillDetailData.data.versions[0];

              // Download and install skill
              const skillZipBuffer = await downloadFile(latestVersion.source_url);
              if (latestVersion.checksum) {
                const isValid = await verifyChecksum(skillZipBuffer, latestVersion.checksum);
                if (!isValid) {
                  mainWarn('AssistantHub', `Skill "${skillName}" checksum verification failed, but continuing`);
                }
              }

              // Get hub skills directory
              const { getHubSkillsDir } = await import('@/process/initStorage');
              const hubSkillsDir = getHubSkillsDir();
              await fs.mkdir(hubSkillsDir, { recursive: true });
              const skillDir = path.join(hubSkillsDir, skillName);

              // Remove existing
              try {
                await fs.access(skillDir);
                await fs.rm(skillDir, { recursive: true, force: true });
              } catch { }

              await fs.mkdir(skillDir, { recursive: true });

              // Extract skill zip
              const skillZip = await JSZip.loadAsync(skillZipBuffer);
              for (const zipEntry of Object.values(skillZip.files)) {
                if (zipEntry.dir) continue;
                const normalizedPath = normalizeZipEntryPath(zipEntry.name);
                let targetPath = normalizedPath;
                // Handle top-level directory wrapper
                if (!normalizedPath.includes('/')) {
                  // Root file — use directly
                } else {
                  const parts = normalizedPath.split('/');
                  if (parts.length > 1) {
                    targetPath = parts.slice(1).join('/');
                  }
                }
                if (!targetPath) continue;

                const fullPath = path.join(skillDir, targetPath);
                const fullDir = path.dirname(fullPath);
                await fs.mkdir(fullDir, { recursive: true });
                const content = await zipEntry.async('nodebuffer');
                await fs.writeFile(fullPath, content);
              }

              // Write skill metadata
              const skillMeta = {
                id: skillInfo.id,
                name: skillInfo.name,
                display_name: skillInfo.display_name,
                description: skillInfo.description,
                icon: skillInfo.icon,
                emoji: skillInfo.emoji,
                category: skillInfo.category,
                categories: skillInfo.categories,
                applicable_scenarios: skillInfo.applicable_scenarios,
                core_features: skillInfo.core_features,
                homepage: skillInfo.homepage,
                author_id: skillInfo.author_id,
                source_type: 'hub',
                is_builtin: false,
                enabled: true,
                installed_version: latestVersion.version,
                installed_at: new Date().toISOString(),
              };
              await fs.writeFile(path.join(skillDir, '_sudowork_meta.json'), JSON.stringify(skillMeta, null, 2), 'utf-8');

              installedSkillNames.push(skillName);
              installedSkillNamesSet.add(skillName); // Update set for subsequent checks
              mainLog('AssistantHub', `Installed associated skill: ${skillName}`);
            } else {
              mainWarn('AssistantHub', `Failed to fetch skill detail for "${skillId}"`);
              failedSkillIds.push(skillId);
            }
          } catch (skillError) {
            mainWarn('AssistantHub', `Failed to install associated skill "${skillId}":`, skillError);
            failedSkillIds.push(skillId);
          }
        }
      }

      // Write assistant meta with CORRECT enabledSkills (skill names, not UUIDs)
      const metaFilePath = path.join(assistantDir, ASSISTANT_META_FILE);
      const meta: AssistantHubMeta = {
        id: assistantMeta.id,
        name: assistantMeta.name,
        nameI18n: { 'zh-CN': assistantMeta.display_name },
        descriptionI18n: assistantMeta.description ? { 'zh-CN': assistantMeta.description } : undefined,
        avatar: assistantMeta.avatar || assistantMeta.emoji || undefined,
        emoji: assistantMeta.emoji,
        presetAgentType: assistantMeta.preset_agent_type || 'sudoclaw',
        source_type: assistantMeta.tag === 'system' ? 'builtin' : 'hub',
        tag: assistantMeta.tag || 'hub',
        // skills: store skill names for reference (not UUIDs)
        skills: allAssociatedSkillNames,
        category_id: assistantMeta.category,
        categories: assistantMeta.categories,
        author_id: assistantMeta.author_id,
        homepage: assistantMeta.homepage,
        applicable_scenarios: assistantMeta.applicable_scenarios,
        core_features: assistantMeta.core_features,
        is_builtin: assistantMeta.tag === 'system',
        enabled: true,
        installed_version: version,
        installed_at: new Date().toISOString(),
        // enabledSkills: skill names that will be enabled for this assistant
        enabledSkills: allAssociatedSkillNames,
        // Rule file for displaying assistant rules
        ruleFile: ruleFile,
      };
      await fs.writeFile(metaFilePath, JSON.stringify(meta, null, 2), 'utf-8');

      mainLog('AssistantHub', `Successfully installed assistant "${assistantName}" v${version} to ${assistantDir}`);
      mainLog('AssistantHub', `Assistant enabledSkills: ${allAssociatedSkillNames.join(', ')}`);

      return {
        success: true,
        data: {
          assistantName,
          installedVersion: version,
          installedSkills: installedSkillNames,
          failedSkills: failedSkillIds,
        },
      };
    } catch (error) {
      mainError('AssistantHub', 'Failed to install assistant:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });
}