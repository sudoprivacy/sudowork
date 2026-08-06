/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fsSync, { existsSync } from 'fs';
import type { Dirent } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import https from 'node:https';
import http from 'node:http';
import { app } from 'electron';
import JSZip from 'jszip';
import { serviceManager } from '@process/services/serviceManager';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { clearSkillsCache, getSkillsDir, getHubSkillsDir, getCustomSkillsDir, getBuiltinSkillsDir, SKILL_SUBDIRS } from '@/process/initStorage';
import { skillManager, type ISkillInfo } from '@/process/SkillManager';
import { AcpSkillManager } from '@/process/task/AcpSkillManager';
import { ipcBridge } from '@/common';
import { buildSkillDisplayName, canonicalizeSkillMarkdownPath, findRootSkillMarkdownFileName, isSkillMarkdownFileName, parseSkillFrontmatter, resolveSkillIconFromFiles } from '@/process/utils/skillPackage';
import { scanSkillDirectory, readAuditReport } from '@/process/services/safety/SkillAuditScanner';
import { isEnterpriseMode } from '@/common/enterpriseDebugConfig';
import { SKILLS_ROOT_DIR, ENTERPRISE_SKILL_SUBDIRS } from '@/process/constants/enterpriseStorage';
import { getSkillHubBaseUrl } from '@/common/systemConfig';
import { getSkillhubToken } from '@/process/credentialsCache';
import { tokenMissingResponse } from '@common/nexus/hubErrors';

const VERSION_FILE_NAME = 'sudowork-version';
/** Metadata file saved alongside installed hub skills. Prefixed to avoid conflicts with skill content. */
const SKILL_HUB_META_FILE = '_sudowork_meta.json';
const MOSS_SKILL_META_FILE = '_moss_meta.json';
const UPLOAD_SKILL_DEFAULT_ICON_FILE = 'upload_skill_default.svg';
const MISSING_ROOT_SKILL_MD_MESSAGE = 'The selected directory must contain a root-level SKILL.md file (case-insensitive)';
const SKILL_HUB_UPLOAD_EXCLUDED_FILE_NAMES = new Set([SKILL_HUB_META_FILE, MOSS_SKILL_META_FILE, '_sudowork_audit.json', '_sudowork_audit.md']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type SkillHubMeta = import('@/common/ipcBridge').ISkillHubMeta;
type SkillHubSkill = import('@/common/ipcBridge').ISkillHubSkill;
type SkillHubPublishStatus = 'pending' | 'approved' | 'rejected';
type SkillHubUploadStatus = Extract<SkillHubPublishStatus, 'pending' | 'approved'>;

interface SkillHubUploadApiBody {
  status?: string;
  message?: string;
  msg?: string;
  id?: string;
  data?: {
    id?: string;
    skill?: {
      id?: string;
      name?: string;
      status?: number;
    };
    version?: {
      version?: string;
    };
  };
}

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

function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveCustomSkillDirForUpload(skillName: string): Promise<string | null> {
  const customSkillsDir = getCustomSkillsDir();
  const disabledCustomSkillsDir = path.join(customSkillsDir, '_disable');
  const directCandidates = [path.join(customSkillsDir, skillName), path.join(disabledCustomSkillsDir, skillName)];

  for (const candidate of directCandidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  for (const parentDir of [customSkillsDir, disabledCustomSkillsDir]) {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(parentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      const candidateDir = path.join(parentDir, entry.name);
      const meta = await readSkillHubMetaFromDirectory(candidateDir);
      if (meta?.name === skillName || meta?.display_name === skillName) {
        return candidateDir;
      }
    }
  }

  return null;
}

async function createSkillHubUploadZip(skillDir: string): Promise<Buffer> {
  const zip = new JSZip();

  const addDirectoryToZip = async (currentDir: string, relativeDir = ''): Promise<void> => {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(currentDir, entry.name);
      const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;

      if (entry.isDirectory()) {
        await addDirectoryToZip(sourcePath, relativePath);
        continue;
      }

      if (entry.isSymbolicLink()) {
        throw new Error(`Symlinks are not supported in skill packages: ${relativePath}`);
      }

      if (!entry.isFile() || SKILL_HUB_UPLOAD_EXCLUDED_FILE_NAMES.has(entry.name)) {
        continue;
      }

      const zipEntryPath = canonicalizeSkillMarkdownPath(relativePath);
      const content = await fs.readFile(sourcePath);
      zip.file(zipEntryPath, content);
    }
  };

  await addDirectoryToZip(skillDir);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function normalizeUploadFormValue(value: unknown): string {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

function appendOptionalFormValue(formData: FormData, name: string, value: unknown): void {
  const normalized = normalizeUploadFormValue(value);
  if (normalized) {
    formData.append(name, normalized);
  }
}

function appendOptionalFormList(formData: FormData, name: string, values: string[]): void {
  for (const value of values) {
    const normalized = value.trim();
    if (normalized) {
      formData.append(name, normalized);
    }
  }
}

function normalizeUploadAuthorId(authorId: string | null | undefined): string {
  const normalized = authorId?.trim() || '';
  if (!normalized) {
    return '';
  }

  if (UUID_PATTERN.test(normalized)) {
    return normalized;
  }

  mainWarn('SkillHub', `Skip non-UUID author_id when uploading custom skill: ${normalized}`);
  return '';
}

function resolveUploadCategories(meta: SkillHubMeta | null, manifest: Awaited<ReturnType<typeof readSkillManifestFromDirectory>>): string[] {
  const categories = new Set<string>();

  for (const category of meta?.categories || []) {
    const normalized = category.trim();
    if (normalized) categories.add(normalized);
  }

  const primaryCategory = meta?.category?.trim() || manifest.category;
  if (primaryCategory) {
    categories.add(primaryCategory);
  }

  return Array.from(categories);
}

async function readSkillUploadIconFile(skillDir: string, icon: string | null | undefined): Promise<{ content: Buffer; fileName: string; mimeType: string } | null> {
  const normalizedIcon = icon?.trim();
  if (!normalizedIcon || /^(https?:|data:|aion-asset:|file:)/i.test(normalizedIcon)) {
    return null;
  }

  const iconPath = path.resolve(skillDir, normalizedIcon);
  if (!isPathInside(skillDir, iconPath)) {
    return null;
  }

  const ext = path.extname(iconPath).toLowerCase();
  if (ext !== '.png' && ext !== '.svg') {
    return null;
  }

  try {
    const content = await fs.readFile(iconPath);
    return {
      content,
      fileName: path.basename(iconPath),
      mimeType: ext === '.png' ? 'image/png' : 'image/svg+xml',
    };
  } catch {
    return null;
  }
}

async function parseSkillHubUploadResponse(response: Response): Promise<SkillHubUploadApiBody | null> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as SkillHubUploadApiBody;
  } catch {
    return { message: text };
  }
}

function resolveSkillHubUploadStatus(body: SkillHubUploadApiBody | null): SkillHubUploadStatus {
  return normalizeSkillHubPublishStatus(body?.data?.skill?.status) === 'approved' ? 'approved' : 'pending';
}

function resolveSkillHubUploadId(body: SkillHubUploadApiBody | null, fallbackId: string): string {
  return body?.data?.skill?.id || body?.data?.id || body?.id || fallbackId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSkillHubPublishStatus(status: unknown): SkillHubPublishStatus | null {
  if (typeof status === 'number') {
    if (status === 1) return 'approved';
    if (status === 2) return 'rejected';
    if (status === 0) return 'pending';
    return null;
  }

  if (typeof status !== 'string') {
    return null;
  }

  const normalized = status.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['1', 'approved', 'approve', 'published', 'online', 'active'].includes(normalized)) {
    return 'approved';
  }

  if (['2', 'rejected', 'reject'].includes(normalized)) {
    return 'rejected';
  }

  if (['0', 'pending', 'reviewing', 'submitted', 'inactive'].includes(normalized)) {
    return 'pending';
  }

  return null;
}

function resolveSkillHubDetailPublishStatus(body: unknown): SkillHubPublishStatus | null {
  if (!isRecord(body)) {
    return null;
  }

  const data = isRecord(body.data) ? body.data : body;
  const skill = isRecord(data.skill) ? data.skill : data;

  return normalizeSkillHubPublishStatus(skill.status ?? data.status ?? body.status);
}

async function fetchUploadedSkillPublishStatus(skillId: string, token: string): Promise<SkillHubPublishStatus | null> {
  const response = await fetch(`${getSkillHubBaseUrl()}/api/skills/${encodeURIComponent(skillId)}`, {
    headers: { Authorization: token },
  });

  if (!response.ok) {
    mainLog('SkillHub', `Skip uploaded skill status refresh for ${skillId}: HTTP ${response.status}`);
    return null;
  }

  const body = await response.json();
  return resolveSkillHubDetailPublishStatus(body);
}

function isUploadedCustomSkillStatusRefreshCandidate(skill: ISkillInfo): boolean {
  const meta = skill.meta;
  if (skill.category !== 'custom' || !meta?.id || meta.source_type !== 'upload') {
    return false;
  }

  const isUploadedToSkillHub = meta.uploaded === true || Boolean(meta.publish_status);
  const isAwaitingFinalStatus = meta.publish_status !== 'approved' && meta.publish_status !== 'rejected';
  return isUploadedToSkillHub && isAwaitingFinalStatus;
}

async function refreshUploadedSkillStatusesFromSkillHub(token: string): Promise<{ checked: number; updated: number }> {
  const skills = await skillManager.getInstalledSkills();
  const candidates = skills.filter(isUploadedCustomSkillStatusRefreshCandidate);
  let updated = 0;

  for (const skill of candidates) {
    try {
      const skillId = skill.meta?.id;
      if (!skillId) continue;

      const remoteStatus = await fetchUploadedSkillPublishStatus(skillId, token);
      if (!remoteStatus) continue;

      const skillDir = await resolveCustomSkillDirForUpload(skill.name);
      if (!skillDir) continue;

      const currentMeta = await readSkillHubMetaFromDirectory(skillDir);
      if (!currentMeta) continue;

      const currentStatus = currentMeta.publish_status || (currentMeta.uploaded ? 'pending' : undefined);
      if (currentStatus === remoteStatus) continue;

      const nextMeta: SkillHubMeta = {
        ...currentMeta,
        publish_status: remoteStatus,
      };
      if (remoteStatus === 'approved') {
        nextMeta.published_at = currentMeta.published_at || new Date().toISOString();
      }

      await writeSkillMetaFile(skillDir, nextMeta);
      updated += 1;
      mainLog('SkillHub', `Updated uploaded skill "${skill.name}" publish status: ${currentStatus || 'unknown'} -> ${remoteStatus}`);
    } catch (error) {
      mainWarn('SkillHub', `Failed to refresh uploaded skill status for "${skill.name}":`, error);
    }
  }

  return { checked: candidates.length, updated };
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
/**
 * Download + install a hub skill package into the hub skills dir, writing its
 * metadata (installed_version is the single source of truth) and reloading the
 * skill runtime.
 *
 * Extracted from the download-and-install IPC provider so first-install AND
 * SkillUpdateService (auto-update) share one install path — no duplicated logic,
 * and install is reachable as a plain function rather than only via IPC.
 */
export async function installHubSkillPackage(params: {
  skillName: string;
  displayName: string;
  sourceUrl: string;
  version: string;
  checksum?: string;
  skillMeta?: SkillHubSkill;
}): Promise<{ success: true; data: { skillName: string; installedVersion: string } } | { success: false; msg: string }> {
  const { skillName, displayName, sourceUrl, version, checksum, skillMeta } = params;
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

    // Write hub metadata file so installed skills can be displayed with full info.
    // NOTE: Metadata file is the single source of truth for installed version.
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
}

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
      const token = getSkillhubToken();
      if (!token) {
        mainError('SkillHub', 'skillhub token not provisioned, skip fetchSkills');
        return tokenMissingResponse('skillHub');
      }
      const response = await fetch(`${getSkillHubBaseUrl()}/api/skills/cursor?${params}`, {
        headers: { Authorization: token },
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
      const token = getSkillhubToken();
      if (!token) {
        mainError('SkillHub', 'skillhub token not provisioned, skip fetchCategories');
        return tokenMissingResponse('skillHub');
      }
      const response = await fetch(`${getSkillHubBaseUrl()}/api/categories`, {
        headers: { Authorization: token },
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
      const token = getSkillhubToken();
      if (!token) {
        mainError('SkillHub', 'skillhub token not provisioned, skip fetchSkillDetail');
        return tokenMissingResponse('skillHub');
      }
      const response = await fetch(`${getSkillHubBaseUrl()}/api/skills/${skillId}`, {
        headers: { Authorization: token },
      });
      const data = await response.json();
      return { success: true, data: data.data };
    } catch (error) {
      mainError('SkillHub', 'Failed to fetch skill detail:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Download and install skill
  ipcBridge.skillHub.downloadAndInstallSkill.provider(async (params) => installHubSkillPackage(params));

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

  ipcBridge.skillHub.uploadSkillToHub.provider(async ({ skillName, tenantId }) => {
    if (isEnterpriseMode()) {
      return { success: false, msg: 'SkillHub upload is only available in personal mode' };
    }

    const normalizedSkillName = skillName.trim();
    const normalizedTenantId = tenantId.trim();
    if (!normalizedSkillName) {
      return { success: false, msg: 'Skill name is required' };
    }
    if (!normalizedTenantId) {
      return { success: false, msg: 'User has no tenant ID, cannot upload skill' };
    }

    try {
      const token = getSkillhubToken();
      if (!token) {
        mainError('SkillHub', 'skillhub token not provisioned, skip uploadSkillToHub');
        return tokenMissingResponse('skillHub');
      }

      const skillDir = await resolveCustomSkillDirForUpload(normalizedSkillName);
      if (!skillDir) {
        return { success: false, msg: `Custom skill "${normalizedSkillName}" not found` };
      }

      const customSkillsDir = getCustomSkillsDir();
      const resolvedSkillDir = path.resolve(skillDir);
      if (!isPathInside(path.resolve(customSkillsDir), resolvedSkillDir)) {
        return { success: false, msg: 'Only custom skills can be uploaded to SkillHub' };
      }

      const importedMeta = await readSkillHubMetaFromDirectory(skillDir);
      const manifest = await readSkillManifestFromDirectory(skillDir);
      const uploadSkillName = importedMeta?.name?.trim() || manifest.skillName;
      const displayName = importedMeta?.display_name?.trim() || manifest.displayName || buildSkillDisplayName(uploadSkillName);
      const version = normalizeInstalledSkillVersion(importedMeta?.installed_version) || manifest.version || (await readInstalledVersionFromDirectory(skillDir)) || '1.0.0';
      const categories = resolveUploadCategories(importedMeta, manifest);
      const uploadAuthorId = normalizeUploadAuthorId(importedMeta?.author_id);

      const zipBuffer = await createSkillHubUploadZip(skillDir);
      const formData = new FormData();
      formData.append('name', uploadSkillName);
      formData.append('display_name', displayName);
      formData.append('version', version);
      formData.append('tenant_id', normalizedTenantId);
      formData.append('status', '0');
      appendOptionalFormValue(formData, 'category', importedMeta?.category || manifest.category);
      if (categories.length > 0) {
        appendOptionalFormList(formData, 'categories', categories);
      }
      appendOptionalFormValue(formData, 'description', importedMeta?.description || manifest.description);
      appendOptionalFormValue(formData, 'core_features', importedMeta?.core_features);
      appendOptionalFormValue(formData, 'applicable_scenarios', importedMeta?.applicable_scenarios);
      appendOptionalFormValue(formData, 'emoji', importedMeta?.emoji || manifest.emoji);
      appendOptionalFormValue(formData, 'homepage', importedMeta?.homepage || manifest.homepage);
      appendOptionalFormValue(formData, 'author_id', uploadAuthorId);

      const skillBlob = new Blob([new Uint8Array(zipBuffer)], { type: 'application/zip' });
      formData.append('skill_file', skillBlob, `${uploadSkillName}.zip`);

      const iconFile = await readSkillUploadIconFile(skillDir, importedMeta?.icon || manifest.icon);
      if (iconFile) {
        const iconBlob = new Blob([new Uint8Array(iconFile.content)], { type: iconFile.mimeType });
        formData.append('icon_file', iconBlob, iconFile.fileName);
      }

      const uploadUrl = `${getSkillHubBaseUrl()}/api/skills`;
      mainLog('SkillHub', `Uploading custom skill "${uploadSkillName}" to SkillHub tenant ${normalizedTenantId}`);
      mainLog(
        'SkillHub',
        `Custom skill upload payload: ${JSON.stringify({
          name: uploadSkillName,
          display_name: displayName,
          version,
          tenant_id: normalizedTenantId,
          status: 0,
          category: importedMeta?.category || manifest.category || null,
          categories,
          has_description: Boolean(importedMeta?.description || manifest.description),
          has_core_features: Boolean(importedMeta?.core_features),
          has_applicable_scenarios: Boolean(importedMeta?.applicable_scenarios),
          has_author_id: Boolean(uploadAuthorId),
          has_icon_file: Boolean(iconFile),
        })}`
      );
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: token },
        body: formData,
      });
      const responseBody = await parseSkillHubUploadResponse(response);

      if (!response.ok) {
        const message = responseBody?.message || responseBody?.msg || JSON.stringify(responseBody);
        mainError('SkillHub', `Upload skill failed: ${response.status} - ${message}`);
        return { success: false, msg: `Upload failed: HTTP ${response.status} - ${message}` };
      }

      const uploadedId = resolveSkillHubUploadId(responseBody, importedMeta?.id || '');
      const publishStatus = resolveSkillHubUploadStatus(responseBody);
      const now = new Date().toISOString();
      const nextMeta: SkillHubMeta = {
        id: uploadedId,
        name: uploadSkillName,
        display_name: displayName,
        description: importedMeta?.description?.trim() || manifest.description || '',
        icon: importedMeta?.icon?.trim() || manifest.icon || UPLOAD_SKILL_DEFAULT_ICON_FILE,
        emoji: importedMeta?.emoji ?? manifest.emoji,
        category: importedMeta?.category?.trim() || manifest.category || '',
        categories,
        applicable_scenarios: importedMeta?.applicable_scenarios ?? null,
        core_features: importedMeta?.core_features ?? null,
        homepage: importedMeta?.homepage?.trim() || manifest.homepage || null,
        author_id: uploadAuthorId,
        source_type: 'upload',
        is_builtin: false,
        enabled: importedMeta?.enabled !== false,
        installed_version: version,
        installed_at: importedMeta?.installed_at || now,
        visible_to: importedMeta?.visible_to ?? null,
        uploaded: true,
        uploaded_at: now,
        publish_status: publishStatus,
      };
      await writeSkillMetaFile(skillDir, nextMeta);

      return {
        success: true,
        data: {
          id: uploadedId,
          name: uploadSkillName,
          status: publishStatus,
        },
      };
    } catch (error) {
      mainError('SkillHub', 'Failed to upload skill to SkillHub:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.skillHub.refreshUploadedSkillStatuses.provider(async () => {
    if (isEnterpriseMode()) {
      return { success: true, data: { checked: 0, updated: 0 } };
    }

    try {
      const token = getSkillhubToken();
      if (!token) {
        mainError('SkillHub', 'skillhub token not provisioned, skip refreshUploadedSkillStatuses');
        return tokenMissingResponse('skillHub');
      }

      const result = await refreshUploadedSkillStatusesFromSkillHub(token);
      return { success: true, data: result };
    } catch (error) {
      mainError('SkillHub', 'Failed to refresh uploaded skill statuses:', error);
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
