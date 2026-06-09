/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import fsSync, { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import https from 'node:https';
import http from 'node:http';
import { app } from 'electron';
import JSZip from 'jszip';
import { clearSkillsCache, getSkillsDir, getHubSkillsDir, getCustomSkillsDir, getBuiltinSkillsDir, SKILL_SUBDIRS, ProcessConfig } from '@/process/initStorage';
import { skillManager, SkillCategory, SkillStatus, ISkillMeta } from '@/process/SkillManager';
import WorkerManage from '@process/WorkerManage';
import { serviceManager } from '@process/services/serviceManager';
import { toAssetUrl } from '@/extensions/assetProtocol';
import { AcpSkillManager } from '@/process/task/AcpSkillManager';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { buildSkillDisplayName, canonicalizeSkillMarkdownPath, findRootSkillMarkdownFileName, isSkillMarkdownFileName, parseSkillFrontmatter, resolveSkillIconFromFiles } from '@/process/utils/skillPackage';
import { scanSkillDirectory, readAuditReport } from '@/process/services/safety/SkillAuditScanner';
import { isEnterpriseMode } from '@/common/enterpriseDebugConfig';
import { SKILLS_ROOT_DIR, ENTERPRISE_SKILL_SUBDIRS } from '@/process/constants/enterpriseStorage';

const SKILL_HUB_BASE_URL = 'https://sudoworkhub.sudoprivacy.com/api/skills';
const SKILL_HUB_CURSOR_URL = 'https://sudoworkhub.sudoprivacy.com/api/skills/cursor';
const AUTHORIZATION = 'sud0@sudo';
const VERSION_FILE_NAME = 'sudowork-version';
/** Metadata file saved alongside installed hub skills. Prefixed to avoid conflicts with skill content. */
const SKILL_HUB_META_FILE = '_sudowork_meta.json';
const MOSS_SKILL_META_FILE = '_moss_meta.json';
const UPLOAD_SKILL_DEFAULT_ICON_FILE = 'upload_skill_default.svg';
const MISSING_ROOT_SKILL_MD_MESSAGE = 'The selected directory must contain a root-level SKILL.md file (case-insensitive)';
type SkillHubMeta = import('@/common/ipcBridge').ISkillHubMeta;

/**
 * Read skill metadata file, trying both Moss and Sudowork meta file names
 * Enterprise mode: _moss_meta.json (primary), _sudowork_meta.json (fallback)
 * Personal mode: _sudowork_meta.json (primary), _moss_meta.json (fallback)
 */
async function readSkillMetaFileWithFallback(skillDir: string): Promise<{ content: string; fileName: string } | null> {
  const isEnterprise = isEnterpriseMode();
  const metaFiles = isEnterprise ? [MOSS_SKILL_META_FILE, SKILL_HUB_META_FILE] : [SKILL_HUB_META_FILE, MOSS_SKILL_META_FILE];

  for (const fileName of metaFiles) {
    const filePath = path.join(skillDir, fileName);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return { content, fileName };
    } catch {
      // Try next file
    }
  }
  return null;
}

/**
 * Write skill metadata file, using correct file name based on current mode
 */
async function writeSkillMetaFile(skillDir: string, meta: SkillHubMeta): Promise<void> {
  const isEnterprise = isEnterpriseMode();
  const fileName = isEnterprise ? MOSS_SKILL_META_FILE : SKILL_HUB_META_FILE;
  const filePath = path.join(skillDir, fileName);
  await fs.writeFile(filePath, JSON.stringify(meta, null, 2), 'utf-8');
}

function normalizeInstalledSkillVersion(version: string | undefined | null): string {
  const normalized = (version || '').trim();
  if (!normalized) {
    return '';
  }

  const lower = normalized.toLowerCase();
  if (lower === 'unknown' || lower === 'unkown') {
    return '';
  }

  return normalized;
}

function getUploadSkillDefaultIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, UPLOAD_SKILL_DEFAULT_ICON_FILE);
  }

  const appPath = app.getAppPath();
  const candidates = [path.join(appPath, 'resources', UPLOAD_SKILL_DEFAULT_ICON_FILE), path.join(appPath, '..', 'resources', UPLOAD_SKILL_DEFAULT_ICON_FILE), path.join(appPath, '..', '..', 'resources', UPLOAD_SKILL_DEFAULT_ICON_FILE)];

  const existing = candidates.find((candidate) => fsSync.existsSync(candidate));
  return existing || candidates[0];
}

function sanitizeSkillDownloadFileName(fileName: string): string {
  const normalized = Array.from(fileName.trim())
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code <= 31 || '<>:"/\\|?*'.includes(char)) {
        return '-';
      }
      return char;
    })
    .join('');
  return normalized || 'skill.zip';
}

function ensureUniqueFilePath(filePath: string): string {
  if (!fsSync.existsSync(filePath)) {
    return filePath;
  }

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);

  for (let index = 1; index < 1000; index += 1) {
    const candidate = path.join(dir, `${base} (${index})${ext}`);
    if (!fsSync.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

function normalizeZipEntryPath(entryPath: string): string {
  return path.posix.normalize(entryPath.replaceAll('\\', '/').replace(/^\.\/+/, ''));
}

function isUnsafeZipEntryPath(entryPath: string): boolean {
  if (!entryPath || entryPath === '.') {
    return false;
  }
  if (/^[a-zA-Z]:[\\/]/.test(entryPath)) {
    return true;
  }
  if (entryPath.startsWith('/') || entryPath.startsWith('\\')) {
    return true;
  }
  const normalized = normalizeZipEntryPath(entryPath);
  return normalized === '..' || normalized.startsWith('../');
}

function resolveZipSkillLayout(zip: JSZip): {
  stripPrefix: string;
} {
  const fileEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => normalizeZipEntryPath(entry.name))
    .filter(Boolean);

  for (const entryPath of fileEntries) {
    if (isUnsafeZipEntryPath(entryPath)) {
      throw new Error(`Unsafe zip entry path: ${entryPath}`);
    }
  }

  const skillMdPaths = fileEntries.filter((entryPath) => isSkillMarkdownFileName(path.posix.basename(entryPath)));

  if (skillMdPaths.includes('SKILL.md')) {
    return {
      stripPrefix: '',
    };
  }

  const skillRoots = Array.from(new Set(skillMdPaths.map((entryPath) => path.posix.dirname(entryPath)).filter((entryPath) => entryPath && entryPath !== '.')));

  if (skillRoots.length === 1) {
    const skillRoot = skillRoots[0];
    const skillDirName = path.posix.basename(skillRoot);
    if (!skillDirName || skillDirName === '.' || skillDirName === '..') {
      throw new Error(`Invalid zip skill root: ${skillRoot}`);
    }
    return {
      stripPrefix: `${skillRoot}/`,
    };
  }

  if (skillRoots.length > 1) {
    throw new Error(`Zip archive contains multiple skill roots: ${skillRoots.join(', ')}`);
  }

  return {
    stripPrefix: '',
  };
}

async function removeExistingInstalledSkillDirs(params: { userSkillsDir: string; requestedSkillName: string; finalSkillDirName: string }): Promise<void> {
  const dirsToRemove = new Set<string>([path.join(params.userSkillsDir, params.finalSkillDirName)]);

  if (params.requestedSkillName !== params.finalSkillDirName) {
    dirsToRemove.add(path.join(params.userSkillsDir, params.requestedSkillName));
  }

  for (const dir of dirsToRemove) {
    try {
      await fs.access(dir);
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Directory doesn't exist, which is fine.
    }
  }
}

/** @deprecated Use resolveInstalledSkillDirAllSubdirs instead */
async function resolveInstalledSkillDir(userSkillsDir: string, skillName: string): Promise<string | null> {
  return resolveInstalledSkillDirAllSubdirs(userSkillsDir, skillName);
}

/**
 * Get user skills root directory path (same as AcpSkillManager)
 */
function getUserSkillsDir(): string {
  return getSkillsDir();
}

/**
 * Resolve the installed skill directory by searching all subdirectories.
 * Priority: custom > hub > system > legacy flat
 */
async function resolveInstalledSkillDirAllSubdirs(userSkillsDir: string, skillName: string): Promise<string | null> {
  const subdirs = [SKILL_SUBDIRS.custom, SKILL_SUBDIRS.hub, SKILL_SUBDIRS.system];

  for (const subdir of subdirs) {
    const candidateDir = path.join(userSkillsDir, subdir, skillName);
    try {
      await fs.access(candidateDir);
      return candidateDir;
    } catch {
      // Not found in this subdir, continue
    }
  }

  // Fallback: search by metadata in all subdirectories
  for (const subdir of subdirs) {
    const parentDir = path.join(userSkillsDir, subdir);
    try {
      const entries = await fs.readdir(parentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillDir = path.join(parentDir, entry.name);
        const metaResult = await readSkillMetaFileWithFallback(skillDir);
        if (metaResult) {
          try {
            const meta = JSON.parse(metaResult.content) as import('@/common/ipcBridge').ISkillHubMeta;
            if (meta.name === skillName || meta.display_name === skillName) {
              return skillDir;
            }
          } catch {
            mainWarn('SkillHub', `Invalid JSON in metadata file at ${skillDir}, skipping`);
          }
        }
      }
    } catch {
      // Subdir doesn't exist
    }
  }

  // Legacy: check flat directory
  const legacyDir = path.join(userSkillsDir, skillName);
  try {
    await fs.access(legacyDir);
    return legacyDir;
  } catch {
    return null;
  }
}

async function reloadSkillRuntime(): Promise<void> {
  clearSkillsCache();
  AcpSkillManager.resetInstance();

  const gateway = serviceManager.getGateway();
  if (!gateway) {
    mainLog('SkillHub', 'Gateway not running, skipping reload');
    return;
  }

  const canHotReload = process.platform !== 'win32' && !gateway.isInProcess();
  if (canHotReload) {
    serviceManager.sendReloadSignal();
    mainLog('SkillHub', 'Sent SIGUSR1 to gateway for hot-reload');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return;
  }

  mainLog('SkillHub', 'Hot-reload not supported, restarting gateway...');
  await serviceManager.restartSudoclaw();
}

async function extractSkillZipToDirectory(zipBuffer: Buffer, skillDir: string): Promise<{ extractedFiles: string[] }> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const { stripPrefix } = resolveZipSkillLayout(zip);
  const extractedFiles: string[] = [];

  for (const zipEntry of Object.values(zip.files)) {
    if (zipEntry.dir) continue;
    if (isUnsafeZipEntryPath(zipEntry.name)) {
      throw new Error(`Unsafe zip entry path: ${zipEntry.name}`);
    }

    const normalizedPath = normalizeZipEntryPath(zipEntry.name);
    let targetPath = normalizedPath;

    if (stripPrefix) {
      if (!normalizedPath.startsWith(stripPrefix)) {
        continue;
      }
      targetPath = normalizedPath.slice(stripPrefix.length);
    }

    targetPath = canonicalizeSkillMarkdownPath(targetPath);

    if (!targetPath) continue;

    const fullPath = path.join(skillDir, targetPath);
    const fullDir = path.dirname(fullPath);
    await fs.mkdir(fullDir, { recursive: true });

    const content = await zipEntry.async('nodebuffer');
    await fs.writeFile(fullPath, content);
    extractedFiles.push(targetPath);
  }

  return { extractedFiles };
}

async function resolveRootSkillMarkdownPath(skillDir: string): Promise<string> {
  const entries = await fs.readdir(skillDir, { withFileTypes: true });
  const rootSkillMarkdown = findRootSkillMarkdownFileName(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  if (!rootSkillMarkdown) {
    throw new Error(MISSING_ROOT_SKILL_MD_MESSAGE);
  }
  return path.join(skillDir, rootSkillMarkdown);
}

async function copySkillDirectoryToDirectory(sourceDir: string, targetDir: string): Promise<{ copiedFiles: string[] }> {
  const rootEntries = await fs.readdir(sourceDir, { withFileTypes: true });
  const rootSkillMarkdown = findRootSkillMarkdownFileName(rootEntries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  if (!rootSkillMarkdown) {
    throw new Error(MISSING_ROOT_SKILL_MD_MESSAGE);
  }

  const copiedFiles: string[] = [];

  const copyDirectoryEntries = async (currentSourceDir: string, currentTargetDir: string, currentRelativePath = ''): Promise<void> => {
    const entries = await fs.readdir(currentSourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(currentSourceDir, entry.name);

      if (entry.isDirectory()) {
        const nextTargetDir = path.join(currentTargetDir, entry.name);
        const nextRelativePath = currentRelativePath ? path.posix.join(currentRelativePath, entry.name) : entry.name;
        await fs.mkdir(nextTargetDir, { recursive: true });
        await copyDirectoryEntries(sourcePath, nextTargetDir, nextRelativePath);
        continue;
      }

      if (entry.isSymbolicLink()) {
        const relativePath = currentRelativePath ? path.posix.join(currentRelativePath, entry.name) : entry.name;
        throw new Error(`Symlinks are not supported in skill directories: ${relativePath}`);
      }

      if (!entry.isFile()) {
        continue;
      }

      const targetName = !currentRelativePath && isSkillMarkdownFileName(entry.name) ? 'SKILL.md' : entry.name;
      const targetPath = path.join(currentTargetDir, targetName);
      await fs.copyFile(sourcePath, targetPath);
      copiedFiles.push(currentRelativePath ? path.posix.join(currentRelativePath, targetName) : targetName);
    }
  };

  await fs.mkdir(targetDir, { recursive: true });
  await copyDirectoryEntries(sourceDir, targetDir);

  return { copiedFiles };
}

async function readSkillManifestFromDirectory(
  skillDir: string,
  extractedFiles?: string[]
): Promise<{
  skillName: string;
  displayName: string;
  description: string;
  icon: string;
  emoji: string | null;
  category: string;
  homepage: string | null;
  version: string;
}> {
  const skillMdPath = await resolveRootSkillMarkdownPath(skillDir);
  const content = await fs.readFile(skillMdPath, 'utf-8');
  const frontmatter = parseSkillFrontmatter(content);
  const fallbackName = path.basename(skillDir);
  const skillName = frontmatter.name?.trim() || fallbackName;
  const displayName = frontmatter.displayName?.trim() || buildSkillDisplayName(skillName);
  const icon = frontmatter.icon?.trim() || resolveSkillIconFromFiles(extractedFiles || (await fs.readdir(skillDir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name)) || '';
  const version = frontmatter.version?.trim() || '';

  return {
    skillName,
    displayName,
    description: frontmatter.description?.trim() || '',
    icon,
    emoji: frontmatter.emoji?.trim() || null,
    category: frontmatter.category?.trim() || '',
    homepage: frontmatter.homepage?.trim() || null,
    version,
  };
}

async function readSkillHubMetaFromDirectory(skillDir: string): Promise<SkillHubMeta | null> {
  const metaResult = await readSkillMetaFileWithFallback(skillDir);
  if (metaResult) {
    try {
      return JSON.parse(metaResult.content) as SkillHubMeta;
    } catch {
      mainWarn('SkillHub', `Invalid JSON in metadata file at ${skillDir}`);
      return null;
    }
  }
  return null;
}

async function readInstalledVersionFromDirectory(skillDir: string): Promise<string> {
  try {
    return normalizeInstalledSkillVersion(await fs.readFile(path.join(skillDir, VERSION_FILE_NAME), 'utf-8'));
  } catch {
    return '';
  }
}

async function installImportedSkillFromPreparedDirectory(skillDir: string, importedFiles: string[], missingSkillMessage: string): Promise<{ success: true; data: { skillName: string; installedVersion: string } } | { success: false; msg: string }> {
  const customSkillsDir = getCustomSkillsDir();
  await fs.mkdir(customSkillsDir, { recursive: true });

  const importedMeta = await readSkillHubMetaFromDirectory(skillDir);
  let manifest: Awaited<ReturnType<typeof readSkillManifestFromDirectory>> | null = null;

  try {
    manifest = await readSkillManifestFromDirectory(skillDir, importedFiles);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === MISSING_ROOT_SKILL_MD_MESSAGE) {
      if (!importedMeta) {
        return { success: false, msg: missingSkillMessage };
      }
    } else {
      return { success: false, msg: message };
    }
  }

  const detectedIcon = resolveSkillIconFromFiles(importedFiles);
  const installedVersion = normalizeInstalledSkillVersion(importedMeta?.installed_version) || manifest?.version || (await readInstalledVersionFromDirectory(skillDir));
  const skillName = importedMeta?.name?.trim() || manifest?.skillName;
  const categories = importedMeta?.categories?.filter(Boolean) || [];

  if (!skillName) {
    return { success: false, msg: 'Unable to determine skill name from _sudowork_meta.json or SKILL.md' };
  }

  const systemDir = path.join(getBuiltinSkillsDir(), skillName);
  const hubDir = path.join(getHubSkillsDir(), skillName);
  const customDir = path.join(customSkillsDir, skillName);

  try {
    await fs.access(systemDir);
    return { success: false, msg: `Skill "${skillName}" already exists in builtin skills` };
  } catch {
    // builtin skill does not exist
  }

  try {
    await fs.access(hubDir);
    return { success: false, msg: `Skill "${skillName}" already exists in hub-installed skills` };
  } catch {
    // hub skill does not exist
  }

  try {
    await fs.access(customDir);
    return { success: false, msg: `Skill "${skillName}" already exists in custom skills` };
  } catch {
    // custom skill does not exist
  }

  await fs.rename(skillDir, customDir);

  const installedAt = new Date().toISOString();
  const meta: SkillHubMeta = {
    id: importedMeta?.id?.trim() || '',
    name: skillName,
    display_name: importedMeta?.display_name?.trim() || manifest?.displayName || buildSkillDisplayName(skillName),
    description: importedMeta?.description?.trim() || manifest?.description || '',
    icon: importedMeta?.icon?.trim() || manifest?.icon || detectedIcon || UPLOAD_SKILL_DEFAULT_ICON_FILE,
    emoji: importedMeta?.emoji?.trim() || manifest?.emoji || null,
    category: importedMeta?.category?.trim() || manifest?.category || '',
    categories: categories.length > 0 ? categories : importedMeta?.category?.trim() ? [importedMeta.category.trim()] : manifest?.category ? [manifest.category] : [],
    applicable_scenarios: importedMeta?.applicable_scenarios ?? null,
    core_features: importedMeta?.core_features ?? null,
    homepage: importedMeta?.homepage?.trim() || manifest?.homepage || null,
    author_id: importedMeta?.author_id?.trim() || '',
    source_type: 'upload',
    is_builtin: false,
    enabled: true,
    installed_version: installedVersion,
    installed_at: installedAt,
  };
  await writeSkillMetaFile(customDir, meta);

  // Run security audit synchronously so the report is ready when the frontend opens the audit modal
  try {
    await scanSkillDirectory(customDir, skillName);
  } catch (err) {
    mainWarn('SkillHub', 'Security audit after import failed:', err);
  }

  void (async () => {
    try {
      await reloadSkillRuntime();
    } catch (err) {
      mainWarn('SkillHub', 'Reload after local skill import failed:', err);
      await serviceManager.restartSudoclaw();
    }
  })();

  return {
    success: true,
    data: {
      skillName,
      installedVersion,
    },
  };
}

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
          'User-Agent': 'Sudowork-SkillHub/1.0',
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
 * Initialize IPC bridge for Skill Hub API.
 * Fetches skills, categories, and skill details from the external Skill Hub service.
 */
export function initSkillHubBridge(): void {
  mainLog('SkillHub', 'Initializing SkillHub bridge...');

  // Fetch skills list from Skill Hub API with cursor-based pagination
  ipcBridge.skillHub.fetchSkills.provider(async ({ cursor, limit = 20, query = '', category = '', tenantId }) => {
    try {
      // 企业模式：从本地 hub/ 目录加载已同步的技能
      if (isEnterpriseMode()) {
        // 企业模式下，技能库展示本地已同步的内容
        // 专属技能 Tab (tenantId 存在时) 从本地 tenant/ 目录加载
        const sourceType = tenantId ? 'tenant' : 'hub';
        const skillsDir = sourceType === 'tenant' ? path.join(SKILLS_ROOT_DIR, ENTERPRISE_SKILL_SUBDIRS.tenant) : path.join(SKILLS_ROOT_DIR, ENTERPRISE_SKILL_SUBDIRS.hub);

        mainLog('SkillHub', `Enterprise mode: loading skills from ${skillsDir}`);

        // 读取本地目录中的技能
        const skills: import('@/common/ipcBridge').ISkillHubSkill[] = [];

        if (existsSync(skillsDir)) {
          const entries = await fs.readdir(skillsDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            // Skip directories starting with _ (like _disable)
            if (entry.name.startsWith('_')) continue;

            const dirName = entry.name;
            const skillDir = path.join(skillsDir, dirName);

            // Read metadata first for search filtering
            const metaResult = await readSkillMetaFileWithFallback(skillDir);
            if (metaResult) {
              let meta: SkillHubMeta;
              try {
                meta = JSON.parse(metaResult.content) as SkillHubMeta;
              } catch {
                mainWarn('SkillHub', `Invalid JSON in metadata file for skill "${dirName}" at ${skillDir}, skipping`);
                continue;
              }

              // Use meta.name if available (same logic as SkillManager.readSkillInfo)
              const skillName = meta.name?.trim() || dirName;
              const displayName = meta.display_name || skillName;
              const description = meta.description || '';

              // Search filter: search by name, display_name, and description
              if (query) {
                const queryLower = query.toLowerCase();
                const nameMatch = skillName.toLowerCase().includes(queryLower);
                const displayNameMatch = displayName.toLowerCase().includes(queryLower);
                const descriptionMatch = description.toLowerCase().includes(queryLower);
                if (!nameMatch && !displayNameMatch && !descriptionMatch) continue;
              }

              // Category filter
              if (category && category !== 'all') {
                const skillCategories = meta.categories || [];
                if (!skillCategories.includes(category)) continue;
              }

              skills.push({
                id: meta.id || skillName,
                name: skillName,
                display_name: displayName,
                description: description,
                icon: meta.icon || '',
                emoji: meta.emoji || null,
                category: meta.category || '',
                categories: meta.categories || [],
                applicable_scenarios: meta.applicable_scenarios || null,
                core_features: meta.core_features || null,
                homepage: meta.homepage || null,
                author_id: meta.author_id || '',
                star_count: 0,
                created_at: meta.installed_at || new Date().toISOString(),
                updated_at: meta.installed_at || new Date().toISOString(),
                visible_to: meta.visible_to || null,
                version: meta.installed_version || '1.0.0',
              });
            }
          }
        }

        // 企业模式不支持分页，返回所有结果
        return {
          success: true,
          data: {
            skills,
            next_cursor: null,
            has_more: false,
          },
        };
      }

      // 个人模式：从 SudoPrivacy Skill Hub API 获取数据
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      if (limit) params.set('limit', String(limit));
      if (query) params.set('query', query);
      if (category) params.set('categories', category);
      if (typeof tenantId === 'string' && tenantId.trim()) params.set('tenant_id', tenantId.trim());
      const response = await fetch(`${SKILL_HUB_CURSOR_URL}?${params}`, {
        headers: { Authorization: AUTHORIZATION },
      });
      const result = await response.json();
      // API returns { success, message, data: { skills, next_cursor, has_more } }
      return { success: true, data: result.data };
    } catch (error) {
      mainError('SkillHub', 'Failed to fetch skills:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Fetch skill categories from Skill Hub API
  ipcBridge.skillHub.fetchCategories.provider(async () => {
    try {
      mainLog('SkillHub', 'Fetching categories');

      // 企业模式：从本地已安装的技能中提取分类
      if (isEnterpriseMode()) {
        const hubSkillsDir = path.join(SKILLS_ROOT_DIR, ENTERPRISE_SKILL_SUBDIRS.hub);
        const categoriesSet = new Set<string>();

        if (existsSync(hubSkillsDir)) {
          const entries = await fs.readdir(hubSkillsDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const skillDir = path.join(hubSkillsDir, entry.name);
            const metaResult = await readSkillMetaFileWithFallback(skillDir);
            if (metaResult) {
              try {
                const meta = JSON.parse(metaResult.content) as SkillHubMeta;
                if (meta.categories) {
                  for (const cat of meta.categories) {
                    categoriesSet.add(cat);
                  }
                }
              } catch {
                mainWarn('SkillHub', `Invalid JSON in metadata file for skill "${entry.name}" at ${skillDir}, skipping`);
              }
            }
          }
        }

        return { success: true, data: Array.from(categoriesSet) };
      }

      // 个人模式：从 SudoPrivacy Skill Hub API 获取分类
      const response = await fetch('https://sudoworkhub.sudoprivacy.com/api/categories', {
        headers: { Authorization: AUTHORIZATION },
      });
      const data = await response.json();
      return { success: true, data: data.data || [] };
    } catch (error) {
      mainError('SkillHub', 'Failed to fetch categories:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Fetch skill detail from Skill Hub API
  ipcBridge.skillHub.fetchSkillDetail.provider(async ({ skillId }) => {
    try {
      // 企业模式：从本地 hub/ 目录获取详情
      if (isEnterpriseMode()) {
        // 先尝试从 hub 目录查找
        const hubSkillsDir = path.join(SKILLS_ROOT_DIR, ENTERPRISE_SKILL_SUBDIRS.hub);

        if (existsSync(hubSkillsDir)) {
          const entries = await fs.readdir(hubSkillsDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const skillDir = path.join(hubSkillsDir, entry.name);
            const metaResult = await readSkillMetaFileWithFallback(skillDir);
            if (metaResult) {
              let meta: SkillHubMeta;
              try {
                meta = JSON.parse(metaResult.content) as SkillHubMeta;
              } catch {
                mainWarn('SkillHub', `Invalid JSON in metadata file for skill "${entry.name}" at ${skillDir}, skipping`);
                continue;
              }
              // 匹配 id 或 name (use meta.name for name matching)
              const skillName = meta.name?.trim() || entry.name;
              if (meta.id === skillId || skillName === skillId || entry.name === skillId) {
                const detail = {
                  id: meta.id || entry.name,
                  name: skillName,
                  display_name: meta.display_name || skillName,
                  description: meta.description || '',
                  icon: meta.icon || '',
                  emoji: meta.emoji || null,
                  category: meta.category || '',
                  categories: meta.categories || [],
                  applicable_scenarios: meta.applicable_scenarios || null,
                  core_features: meta.core_features || null,
                  homepage: meta.homepage || null,
                  author_id: meta.author_id || '',
                  version: meta.installed_version || '1.0.0',
                  visible_to: meta.visible_to || null,
                };
                return { success: true, data: detail };
              }
            }
          }
        }

        // 未找到
        return { success: false, msg: 'Skill not found in local hub directory' };
      }

      // 个人模式：从 SudoPrivacy Skill Hub API 获取详情
      const response = await fetch(`${SKILL_HUB_BASE_URL}/${skillId}`, {
        headers: { Authorization: AUTHORIZATION },
      });
      const data = await response.json();
      return { success: true, data: data.data };
    } catch (error) {
      mainError('SkillHub', 'Failed to fetch skill detail:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Download and install skill
  ipcBridge.skillHub.downloadAndInstallSkill.provider(async ({ skillName, displayName, sourceUrl, version, checksum, skillMeta }) => {
    try {
      // Trim skillName to prevent directory names with leading/trailing spaces
      const trimmedSkillName = skillName.trim();
      mainLog('SkillHub', `Downloading skill: ${trimmedSkillName} version: ${version}`);

      // Download zip file
      const zipBuffer = await downloadFile(sourceUrl, (percent) => {
        mainLog('SkillHub', `Download progress: ${percent}%`);
      });

      // Verify checksum if provided
      if (checksum) {
        const isValid = await verifyChecksum(zipBuffer, checksum);
        if (!isValid) {
          mainWarn('SkillHub', 'Checksum verification failed, but continuing anyway');
        }
      }

      // Get hub skills subdirectory
      const hubSkillsDir = getHubSkillsDir();
      await fs.mkdir(hubSkillsDir, { recursive: true });

      const skillDir = path.join(hubSkillsDir, trimmedSkillName);

      await removeExistingInstalledSkillDirs({
        userSkillsDir: hubSkillsDir,
        requestedSkillName: trimmedSkillName,
        finalSkillDirName: trimmedSkillName,
      });
      await fs.mkdir(skillDir, { recursive: true });

      await extractSkillZipToDirectory(zipBuffer, skillDir);

      // Write hub metadata file so installed skills can be displayed with full info
      // NOTE: Metadata file is the single source of truth for installed version.
      // The standalone sudowork-version file is no longer written for new installs.
      const meta: SkillHubMeta = {
        id: skillMeta?.id ?? '',
        name: trimmedSkillName,
        display_name: skillMeta?.display_name ?? displayName,
        description: skillMeta?.description ?? '',
        icon: skillMeta?.icon ?? '',
        emoji: skillMeta?.emoji ?? null,
        category: skillMeta?.category ?? '',
        categories: skillMeta?.categories ?? [],
        applicable_scenarios: skillMeta?.applicable_scenarios ?? null,
        core_features: skillMeta?.core_features ?? null,
        homepage: skillMeta?.homepage ?? null,
        author_id: skillMeta?.author_id ?? '',
        source_type: 'hub',
        is_builtin: false,
        enabled: true,
        installed_version: version,
        installed_at: new Date().toISOString(),
      };
      await writeSkillMetaFile(skillDir, meta);

      mainLog('SkillHub', `Successfully installed skill "${trimmedSkillName}" v${version} to ${skillDir}`);

      // Reload Sudoclaw gateway to pick up new skills.
      // - On Unix: use SIGUSR1 for hot-reload (keeps sessions alive)
      // - On Windows/In-process: full restart required (SIGUSR1 not supported)
      void (async () => {
        try {
          await reloadSkillRuntime();
        } catch (err) {
          mainWarn('SkillHub', 'Reload failed:', err);
          await serviceManager.restartSudoclaw();
        }
      })();

      return {
        success: true,
        data: {
          skillName: trimmedSkillName,
          installedVersion: version,
        },
      };
    } catch (error) {
      mainError('SkillHub', 'Failed to install skill:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcBridge.skillHub.downloadSkillZip.provider(async ({ skillName, version, sourceUrl, checksum }) => {
    try {
      const zipBuffer = await downloadFile(sourceUrl);

      if (checksum) {
        const isValid = await verifyChecksum(zipBuffer, checksum);
        if (!isValid) {
          mainWarn('SkillHub', 'Zip checksum verification failed, but continuing local download');
        }
      }

      const downloadsDir = app.getPath('downloads');
      await fs.mkdir(downloadsDir, { recursive: true });

      const baseName = sanitizeSkillDownloadFileName(`${skillName}-${version || 'latest'}.zip`);
      const filePath = ensureUniqueFilePath(path.join(downloadsDir, baseName));
      await fs.writeFile(filePath, zipBuffer);

      return {
        success: true,
        data: {
          filePath,
        },
      };
    } catch (error) {
      mainError('SkillHub', 'Failed to download skill zip:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcBridge.skillHub.importLocalSkill.provider(async ({ sourcePath }) => {
    try {
      const sourceStat = await fs.stat(sourcePath);
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sudowork-skill-import-'));
      try {
        let importedFiles: string[] = [];

        if (sourceStat.isDirectory()) {
          const { copiedFiles } = await copySkillDirectoryToDirectory(sourcePath, tempDir);
          importedFiles = copiedFiles;
        } else if (sourceStat.isFile()) {
          if (path.extname(sourcePath).toLowerCase() !== '.zip') {
            return { success: false, msg: 'Please select a .zip file or a skill directory' };
          }

          const zipBuffer = await fs.readFile(sourcePath);
          const { extractedFiles } = await extractSkillZipToDirectory(zipBuffer, tempDir);
          importedFiles = extractedFiles;
        } else {
          return { success: false, msg: 'Please select a .zip file or a skill directory' };
        }

        const missingSkillMessage = sourceStat.isDirectory() ? MISSING_ROOT_SKILL_MD_MESSAGE : 'The zip package must contain SKILL.md or _sudowork_meta.json at the root or in a single top-level directory';

        return await installImportedSkillFromPreparedDirectory(tempDir, importedFiles, missingSkillMessage);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch((): void => undefined);
      }
    } catch (error) {
      mainError('SkillHub', 'Failed to import local skill:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Get installed skills with versions (using SkillManager)
  ipcBridge.skillHub.getInstalledSkills.provider(async () => {
    try {
      const skills = await skillManager.getInstalledSkills();
      // 转换为前端需要的格式，补充 ISkillHubMeta 需要的必填字段
      const result: import('@/common/ipcBridge').IInstalledSkillInfo[] = skills.map((skill) => ({
        name: skill.name,
        version: skill.version,
        isBuiltin: skill.isBuiltin,
        isAutoInjectedBuiltin: skill.isAutoInjectedBuiltin === true,
        isHubInstalled: skill.isHubInstalled,
        enabled: skill.enabled,
        // 目录分类优先，作为主要分类依据
        category: skill.category,
        meta: skill.meta
          ? {
            ...skill.meta,
            // 补充 ISkillHubMeta 必填字段
            name: skill.meta.name || skill.name,
            id: skill.meta.id || skill.name,
            display_name: skill.meta.display_name || skill.name,
            description: skill.meta.description || '',
            icon: skill.meta.icon || '',
            emoji: skill.meta.emoji ?? null,
            category: skill.meta.category || '',
            categories: skill.meta.categories || [],
            applicable_scenarios: skill.meta.applicable_scenarios ?? null,
            core_features: skill.meta.core_features ?? null,
            homepage: skill.meta.homepage ?? null,
            author_id: skill.meta.author_id || '',
            installed_version: skill.meta.installed_version || skill.version,
            installed_at: skill.meta.installed_at || '',
          }
          : undefined,
      }));
      return { success: true, data: result };
    } catch (error) {
      mainError('SkillHub', 'Failed to get installed skills:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Uninstall a skill (using SkillManager)
  ipcBridge.skillHub.uninstallSkill.provider(async ({ skillName, category }) => {
    try {
      const result = await skillManager.uninstallSkill(skillName, category);
      if (result.success) {
        void (async () => {
          try {
            await reloadSkillRuntime();
          } catch (err) {
            mainWarn('SkillHub', 'Reload after uninstall failed:', err);
            await serviceManager.restartSudoclaw();
          }
        })();
      }
      return result;
    } catch (error) {
      mainError('SkillHub', 'Failed to uninstall skill:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Enable/disable a skill (using SkillManager)
  ipcBridge.skillHub.setSkillEnabled.provider(async ({ skillName, enabled, category }) => {
    try {
      const result = enabled ? await skillManager.enableSkill(skillName, category) : await skillManager.disableSkill(skillName, category);
      if (result.success) {
        void (async () => {
          try {
            await reloadSkillRuntime();
          } catch (err) {
            mainWarn('SkillHub', 'Reload after enable toggle failed:', err);
            await serviceManager.restartSudoclaw();
          }
        })();
      }
      return result;
    } catch (error) {
      mainError('SkillHub', 'Failed to update skill enabled state:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Get security audit report for an installed skill
  ipcBridge.skillHub.getSkillAuditReport.provider(async ({ skillName }) => {
    try {
      const userSkillsDir = getUserSkillsDir();
      const skillDir = await resolveInstalledSkillDirAllSubdirs(userSkillsDir, skillName);
      if (!skillDir) {
        return { success: false, msg: `Skill "${skillName}" not found` };
      }

      // Try reading existing report first
      const existingReport = await readAuditReport(skillDir);
      if (existingReport) {
        return { success: true, data: existingReport };
      }

      // No existing report, run audit now
      const report = await scanSkillDirectory(skillDir, skillName);
      return { success: true, data: report };
    } catch (error) {
      mainError('SkillHub', 'Failed to get audit report:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Run (or re-run) security audit for an installed skill
  ipcBridge.skillHub.runSkillAudit.provider(async ({ skillName }) => {
    try {
      const userSkillsDir = getUserSkillsDir();
      const skillDir = await resolveInstalledSkillDirAllSubdirs(userSkillsDir, skillName);
      if (!skillDir) {
        return { success: false, msg: `Skill "${skillName}" not found` };
      }

      const report = await scanSkillDirectory(skillDir, skillName);
      return { success: true, data: report };
    } catch (error) {
      mainError('SkillHub', 'Failed to run audit:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });
}
