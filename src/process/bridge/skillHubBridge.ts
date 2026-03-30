/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import https from 'node:https';
import http from 'node:http';
import { app } from 'electron';
import JSZip from 'jszip';
import { clearSkillsCache, getSkillsDir } from '@/process/initStorage';
import WorkerManage from '@process/WorkerManage';
import { serviceManager } from '@process/services/serviceManager';
import { toAssetUrl } from '@/extensions/assetProtocol';
import { AcpSkillManager } from '@/process/task/AcpSkillManager';
import { buildSkillDisplayName, parseSkillFrontmatter, resolveSkillIconFromFiles } from '@/process/utils/skillPackage';

const SKILL_HUB_BASE_URL = 'https://sudoclawhub.sudoprivacy.com/api/skills';
const SKILL_HUB_CURSOR_URL = 'https://sudoclawhub.sudoprivacy.com/api/skills/cursor';
const AUTHORIZATION = 'sud0@sudo';
const VERSION_FILE_NAME = 'sudowork-version';
/** Metadata file saved alongside installed hub skills. Prefixed to avoid conflicts with skill content. */
const SKILL_HUB_META_FILE = '_sudowork_meta.json';
const UPLOAD_SKILL_DEFAULT_ICON_FILE = 'upload_skill_default.svg';
type SkillHubMeta = import('@/common/ipcBridge').ISkillHubMeta;

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

  const skillMdPaths = fileEntries.filter((entryPath) => path.posix.basename(entryPath) === 'SKILL.md');

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

async function resolveInstalledSkillDir(userSkillsDir: string, skillName: string): Promise<string | null> {
  const directDir = path.join(userSkillsDir, skillName);
  try {
    await fs.access(directDir);
    return directDir;
  } catch {
    // Fall through to metadata lookup.
  }

  const entries = await fs.readdir(userSkillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '_builtin') continue;

    const skillDir = path.join(userSkillsDir, entry.name);
    try {
      const raw = await fs.readFile(path.join(skillDir, SKILL_HUB_META_FILE), 'utf-8');
      const meta = JSON.parse(raw) as import('@/common/ipcBridge').ISkillHubMeta;
      if (meta.name === skillName || meta.display_name === skillName) {
        return skillDir;
      }
    } catch {
      // Ignore non-hub skills or malformed metadata.
    }
  }

  return null;
}

/**
 * Get user skills directory path (same as AcpSkillManager)
 */
function getUserSkillsDir(): string {
  return getSkillsDir();
}

async function reloadSkillRuntime(): Promise<void> {
  clearSkillsCache();
  AcpSkillManager.resetInstance();

  const gateway = serviceManager.getGateway();
  if (!gateway) {
    console.log('[SkillHub] Gateway not running, skipping reload');
    return;
  }

  const canHotReload = process.platform !== 'win32' && !gateway.isInProcess();
  if (canHotReload) {
    serviceManager.sendReloadSignal();
    console.log('[SkillHub] Sent SIGUSR1 to gateway for hot-reload');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return;
  }

  console.log('[SkillHub] Hot-reload not supported, restarting gateway...');
  await serviceManager.restartOpenClaw();
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
  const skillMdPath = path.join(skillDir, 'SKILL.md');
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
  try {
    const raw = await fs.readFile(path.join(skillDir, SKILL_HUB_META_FILE), 'utf-8');
    return JSON.parse(raw) as SkillHubMeta;
  } catch {
    return null;
  }
}

async function readInstalledVersionFromDirectory(skillDir: string): Promise<string> {
  try {
    return normalizeInstalledSkillVersion(await fs.readFile(path.join(skillDir, VERSION_FILE_NAME), 'utf-8'));
  } catch {
    return '';
  }
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
  console.log('[SkillHub] Initializing SkillHub bridge...');

  // Fetch skills list from Skill Hub API with cursor-based pagination
  ipcBridge.skillHub.fetchSkills.provider(async ({ cursor, limit = 20, query = '', category = '' }) => {
    try {
      console.log('[SkillHub] Fetching skills with params:', { cursor, limit, query, category });
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      if (limit) params.set('limit', String(limit));
      if (query) params.set('query', query);
      if (category) params.set('categories', category);
      const response = await fetch(`${SKILL_HUB_CURSOR_URL}?${params}`, {
        headers: { Authorization: AUTHORIZATION },
      });
      const result = await response.json();
      console.log('[SkillHub] Skills response:', result);
      // API returns { success, message, data: { skills, next_cursor, has_more } }
      return { success: true, data: result.data };
    } catch (error) {
      console.error('[SkillHub] Failed to fetch skills:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Fetch skill categories from Skill Hub API
  ipcBridge.skillHub.fetchCategories.provider(async () => {
    try {
      console.log('[SkillHub] Fetching categories');
      const response = await fetch('https://sudoclawhub.sudoprivacy.com/api/categories', {
        headers: { Authorization: AUTHORIZATION },
      });
      const data = await response.json();
      console.log('[SkillHub] Categories response:', data);
      return { success: true, data: data.data || [] };
    } catch (error) {
      console.error('[SkillHub] Failed to fetch categories:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Fetch skill detail from Skill Hub API
  ipcBridge.skillHub.fetchSkillDetail.provider(async ({ skillId }) => {
    try {
      console.log('[SkillHub] Fetching skill detail:', skillId);
      const response = await fetch(`${SKILL_HUB_BASE_URL}/${skillId}`, {
        headers: { Authorization: AUTHORIZATION },
      });
      const data = await response.json();
      console.log('[SkillHub] Skill detail response:', data);
      return { success: true, data: data.data };
    } catch (error) {
      console.error('[SkillHub] Failed to fetch skill detail:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Download and install skill
  ipcBridge.skillHub.downloadAndInstallSkill.provider(async ({ skillName, displayName, sourceUrl, version, checksum, skillMeta }) => {
    try {
      console.log('[SkillHub] Downloading skill:', skillName, 'version:', version);

      // Download zip file
      const zipBuffer = await downloadFile(sourceUrl, (percent) => {
        console.log(`[SkillHub] Download progress: ${percent}%`);
      });

      // Verify checksum if provided
      if (checksum) {
        const isValid = await verifyChecksum(zipBuffer, checksum);
        if (!isValid) {
          console.warn('[SkillHub] Checksum verification failed, but continuing anyway');
        }
      }

      // Get user skills directory
      const userSkillsDir = getUserSkillsDir();
      await fs.mkdir(userSkillsDir, { recursive: true });

      const skillDir = path.join(userSkillsDir, skillName);

      await removeExistingInstalledSkillDirs({
        userSkillsDir,
        requestedSkillName: skillName,
        finalSkillDirName: skillName,
      });
      await fs.mkdir(skillDir, { recursive: true });

      await extractSkillZipToDirectory(zipBuffer, skillDir);

      // Write version file
      const versionFilePath = path.join(skillDir, VERSION_FILE_NAME);
      await fs.writeFile(versionFilePath, version, 'utf-8');

      // Write hub metadata file so installed skills can be displayed with full info
      const metaFilePath = path.join(skillDir, SKILL_HUB_META_FILE);
      const meta = {
        id: skillMeta?.id ?? '',
        name: skillName,
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
      await fs.writeFile(metaFilePath, JSON.stringify(meta, null, 2), 'utf-8');

      console.log(`[SkillHub] Successfully installed skill "${skillName}" v${version} to ${skillDir}`);

      // Reload Sudoclaw gateway to pick up new skills.
      // - On Unix: use SIGUSR1 for hot-reload (keeps sessions alive)
      // - On Windows/In-process: full restart required (SIGUSR1 not supported)
      void (async () => {
        try {
          await reloadSkillRuntime();
        } catch (err) {
          console.warn('[SkillHub] Reload failed:', err);
          await WorkerManage.restartOpenClawGateways();
        }
      })();

      return {
        success: true,
        data: {
          skillName,
          installedVersion: version,
        },
      };
    } catch (error) {
      console.error('[SkillHub] Failed to install skill:', error);
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
          console.warn('[SkillHub] Zip checksum verification failed, but continuing local download');
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
      console.error('[SkillHub] Failed to download skill zip:', error);
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcBridge.skillHub.importSkillZip.provider(async ({ zipPath }) => {
    try {
      const zipBuffer = await fs.readFile(zipPath);
      const userSkillsDir = getUserSkillsDir();
      await fs.mkdir(userSkillsDir, { recursive: true });

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sudowork-skill-import-'));
      try {
        const { extractedFiles } = await extractSkillZipToDirectory(zipBuffer, tempDir);
        const importedMeta = await readSkillHubMetaFromDirectory(tempDir);
        const skillMdPath = path.join(tempDir, 'SKILL.md');
        let manifest: Awaited<ReturnType<typeof readSkillManifestFromDirectory>> | null = null;

        try {
          await fs.access(skillMdPath);
          manifest = await readSkillManifestFromDirectory(tempDir, extractedFiles);
        } catch {
          if (!importedMeta) {
            return { success: false, msg: 'The zip package must contain SKILL.md or _sudowork_meta.json at the root or in a single top-level directory' };
          }
        }

        const detectedIcon = resolveSkillIconFromFiles(extractedFiles);
        const installedVersion = normalizeInstalledSkillVersion(importedMeta?.installed_version) || manifest?.version || (await readInstalledVersionFromDirectory(tempDir));
        const skillName = importedMeta?.name?.trim() || manifest?.skillName;
        const categories = importedMeta?.categories?.filter(Boolean) || [];

        if (!skillName) {
          return { success: false, msg: 'Unable to determine skill name from _sudowork_meta.json or SKILL.md' };
        }

        const builtinDir = path.join(userSkillsDir, '_builtin', skillName);
        const skillDir = path.join(userSkillsDir, skillName);

        try {
          await fs.access(builtinDir);
          return { success: false, msg: `Skill "${skillName}" already exists in builtin skills` };
        } catch {
          // builtin skill does not exist
        }

        try {
          await fs.access(skillDir);
          return { success: false, msg: `Skill "${skillName}" already exists in user skills` };
        } catch {
          // user skill does not exist
        }
        await fs.rename(tempDir, skillDir);

        const metaFilePath = path.join(skillDir, SKILL_HUB_META_FILE);
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
        await fs.writeFile(metaFilePath, JSON.stringify(meta, null, 2), 'utf-8');

        if (installedVersion) {
          await fs.writeFile(path.join(skillDir, VERSION_FILE_NAME), installedVersion, 'utf-8');
        }

        void (async () => {
          try {
            await reloadSkillRuntime();
          } catch (err) {
            console.warn('[SkillHub] Reload after zip import failed:', err);
            await WorkerManage.restartOpenClawGateways();
          }
        })();

        return {
          success: true,
          data: {
            skillName,
            installedVersion,
          },
        };
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch((): void => undefined);
      }
    } catch (error) {
      console.error('[SkillHub] Failed to import skill zip:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Get installed skills with versions
  ipcBridge.skillHub.getInstalledSkills.provider(async () => {
    try {
      const userSkillsDir = getUserSkillsDir();
      const skills: import('@/common/ipcBridge').IInstalledSkillInfo[] = [];

      try {
        await fs.access(userSkillsDir);
      } catch {
        return { success: true, data: [] };
      }

      // Helper to read a single skill directory
      const readSkill = async (dirName: string, skillDir: string, forceBuiltin = false) => {
        // Read version
        let version = '';
        try {
          version = normalizeInstalledSkillVersion(await fs.readFile(path.join(skillDir, VERSION_FILE_NAME), 'utf-8'));
        } catch {
          // fallback: try SKILL.md frontmatter
          try {
            const content = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
            const m = content.match(/^version:\s*(.+)$/m);
            if (m) version = normalizeInstalledSkillVersion(m[1]);
          } catch {
            /* ignore */
          }
        }

        // Try to read hub metadata file
        let meta: import('@/common/ipcBridge').ISkillHubMeta | undefined;
        let isHubInstalled = false;
        let isBuiltin = forceBuiltin;
        let enabled = true;
        try {
          const raw = await fs.readFile(path.join(skillDir, SKILL_HUB_META_FILE), 'utf-8');
          meta = JSON.parse(raw) as import('@/common/ipcBridge').ISkillHubMeta;
          isHubInstalled = meta.source_type === 'hub' || meta.source_type === undefined;
          // Use meta.is_builtin if set, otherwise use forceBuiltin
          if (meta.is_builtin !== undefined) {
            isBuiltin = meta.is_builtin === true;
          }
          enabled = meta.enabled !== false;
          // Use stored version as source of truth
          version = normalizeInstalledSkillVersion(meta.installed_version) || version;
          // Resolve local icon path if icon is a relative path (e.g., "icon.svg")
          if (meta.icon === UPLOAD_SKILL_DEFAULT_ICON_FILE && meta.source_type === 'upload') {
            meta.icon = toAssetUrl(getUploadSkillDefaultIconPath());
          } else if (meta.icon && !meta.icon.startsWith('http') && !meta.icon.startsWith('/') && !meta.icon.startsWith('aion-asset://') && !meta.icon.startsWith('data:')) {
            const iconAbsPath = path.join(skillDir, meta.icon);
            meta.icon = toAssetUrl(iconAbsPath);
          }
        } catch {
          // No meta file → locally created skill (not builtin, not hub-installed)
        }

        return {
          name: meta?.name?.trim() || dirName,
          version,
          isBuiltin,
          isHubInstalled,
          enabled,
          meta,
        };
      };

      // 1. First, read skills from _builtin directory (all are builtin)
      const builtinDir = path.join(userSkillsDir, '_builtin');
      try {
        await fs.access(builtinDir);
        const builtinEntries = await fs.readdir(builtinDir, { withFileTypes: true });
        for (const entry of builtinEntries) {
          if (!entry.isDirectory()) continue;
          const skillDir = path.join(builtinDir, entry.name);
          const skill = await readSkill(entry.name, skillDir, true); // force builtin
          skills.push(skill);
        }
      } catch {
        // _builtin directory doesn't exist
      }

      // 2. Then, read skills from the outer directory (exclude _builtin)
      const entries = await fs.readdir(userSkillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === '_builtin') continue; // already processed

        const skillDir = path.join(userSkillsDir, entry.name);
        const skill = await readSkill(entry.name, skillDir, false);
        skills.push(skill);
      }

      return { success: true, data: skills };
    } catch (error) {
      console.error('[SkillHub] Failed to get installed skills:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Uninstall a hub-installed skill (built-in skills are rejected)
  ipcBridge.skillHub.uninstallSkill.provider(async ({ skillName }) => {
    try {
      const userSkillsDir = getUserSkillsDir();
      const skillDir = await resolveInstalledSkillDir(userSkillsDir, skillName);
      if (!skillDir) {
        return { success: false, msg: 'Skill not found' };
      }

      // Safety check: must be within user skills dir
      const resolvedSkillDir = path.resolve(skillDir);
      const resolvedSkillsDir = path.resolve(userSkillsDir);
      if (!resolvedSkillDir.startsWith(resolvedSkillsDir + path.sep)) {
        return { success: false, msg: 'Invalid skill path' };
      }

      // Check if skill is built-in via meta file
      try {
        const raw = await fs.readFile(path.join(skillDir, SKILL_HUB_META_FILE), 'utf-8');
        const meta = JSON.parse(raw) as import('@/common/ipcBridge').ISkillHubMeta;
        if (meta.is_builtin === true) {
          return { success: false, msg: '该技能为内置技能，无法卸载' };
        }
      } catch {
        // No meta file → locally created skill, allow uninstall
      }

      await fs.rm(skillDir, { recursive: true, force: true });
      void (async () => {
        try {
          await reloadSkillRuntime();
        } catch (err) {
          console.warn('[SkillHub] Reload after uninstall failed:', err);
          await WorkerManage.restartOpenClawGateways();
        }
      })();
      return { success: true };
    } catch (error) {
      console.error('[SkillHub] Failed to uninstall skill:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.skillHub.setSkillEnabled.provider(async ({ skillName, enabled }) => {
    try {
      const userSkillsDir = getUserSkillsDir();
      const skillDir = await resolveInstalledSkillDir(userSkillsDir, skillName);
      if (!skillDir) {
        return { success: false, msg: 'Skill not found' };
      }

      const metaFilePath = path.join(skillDir, SKILL_HUB_META_FILE);
      const raw = await fs.readFile(metaFilePath, 'utf-8');
      const meta = JSON.parse(raw) as import('@/common/ipcBridge').ISkillHubMeta;

      if (meta.is_builtin === true) {
        return { success: false, msg: '内置技能无法禁用' };
      }

      meta.enabled = enabled;
      await fs.writeFile(metaFilePath, JSON.stringify(meta, null, 2), 'utf-8');

      void (async () => {
        try {
          await reloadSkillRuntime();
        } catch (err) {
          console.warn('[SkillHub] Reload after enable toggle failed:', err);
          await WorkerManage.restartOpenClawGateways();
        }
      })();

      return { success: true };
    } catch (error) {
      console.error('[SkillHub] Failed to update skill enabled state:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });
}
