/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import path from 'path';
import { MOSS_SKILL_META_FILE, SKILL_HUB_META_FILE } from '@/process/constants/skillStorage';
import { buildSkillDisplayName, findRootSkillMarkdownFileName, parseSkillFrontmatter, resolveSkillIconFromFiles } from '@/process/utils/skillPackage';
import { maybeProvisionFfmpegForSkill } from '@/process/services/ffmpeg/ffmpegSkillGate';

export type TrackedWorkspaceFile = {
  path: string;
  intent: 'draft' | 'final';
  kind: 'create' | 'edit';
};

export type WorkspaceSkillInstallResult =
  | {
      status: 'installed';
      skillName: string;
      installedVersion: string;
      sourceDir: string;
      targetDir: string;
    }
  | {
      status: 'registered';
      skillName: string;
      installedVersion: string;
      sourceDir: string;
      targetDir: string;
    }
  | {
      status: 'updated';
      skillName: string;
      installedVersion: string;
      sourceDir: string;
      targetDir: string;
    }
  | {
      status: 'skipped';
      sourceDir: string;
      reason: string;
      skillName?: string;
    };

export type WorkspaceSkillInstallerDeps = {
  getCustomSkillsDir: () => string;
  existingCustomSkillNames?: ReadonlySet<string>;
  clearSkillsCache?: () => void;
  resetAcpSkillManager?: () => void;
  now?: () => Date;
};

type TrackedWorkspaceFiles = ReadonlyMap<string, TrackedWorkspaceFile>;

type InspectedWorkspaceSkill =
  | {
      skillName: string;
      installedVersion: string;
      metaFileName: string;
      meta: Required<Pick<WorkspaceSkillMeta, 'name' | 'display_name' | 'description' | 'icon' | 'emoji' | 'category' | 'categories' | 'applicable_scenarios' | 'core_features' | 'homepage' | 'author_id' | 'installed_version' | 'installed_at'>> & WorkspaceSkillMeta;
    }
  | { reason: string; skillName?: string };

type WorkspaceSkillMeta = {
  id?: string;
  name?: string;
  display_name?: string;
  description?: string;
  icon?: string;
  emoji?: string | null;
  category?: string;
  categories?: string[];
  applicable_scenarios?: string | null;
  core_features?: string | null;
  homepage?: string | null;
  author_id?: string;
  source_type?: 'hub' | 'upload' | 'custom' | 'tenant';
  is_builtin?: boolean;
  enabled?: boolean;
  installed_version?: string;
  installed_at?: string;
};

const SKILL_META_FILES = new Set([SKILL_HUB_META_FILE, MOSS_SKILL_META_FILE]);
const IGNORED_WORKSPACE_ROOTS = new Set(['.git', '.nexus', '.claude', '.drafts', 'node_modules', '__pycache__', '.venv', 'venv']);
const SANDBOX_CUSTOM_SKILLS_RELATIVE_PATH = ['.sandbox-home', '.nexus', 'skills', '_my-custom-skill'];

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isIgnoredCandidateRoot(workspace: string, candidateRoot: string): boolean {
  const relative = path.relative(workspace, candidateRoot);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return true;
  }

  const firstPart = relative.split(path.sep).filter(Boolean)[0];
  return !firstPart || firstPart.startsWith('.') || IGNORED_WORKSPACE_ROOTS.has(firstPart);
}

function addCandidateAncestors(workspace: string, filePath: string, candidates: Set<string>): void {
  const resolvedWorkspace = path.resolve(workspace);
  const resolvedFilePath = path.resolve(filePath);
  if (!isPathInside(resolvedWorkspace, resolvedFilePath)) return;

  let currentDir = path.dirname(resolvedFilePath);
  while (currentDir !== resolvedWorkspace && isPathInside(resolvedWorkspace, currentDir)) {
    if (!isIgnoredCandidateRoot(resolvedWorkspace, currentDir)) {
      candidates.add(currentDir);
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }
}

export function collectWorkspaceSkillCandidateRoots(workspace: string, trackedFiles: ReadonlyMap<string, TrackedWorkspaceFile>): string[] {
  const candidates = new Set<string>();
  const resolvedWorkspace = path.resolve(workspace);

  for (const [requestedPath, file] of trackedFiles) {
    if (file.intent !== 'final') continue;

    addCandidateAncestors(resolvedWorkspace, file.path, candidates);

    const requestedFilePath = path.isAbsolute(requestedPath) ? requestedPath : path.join(resolvedWorkspace, requestedPath);
    addCandidateAncestors(resolvedWorkspace, requestedFilePath, candidates);
  }

  return Array.from(candidates).sort((left, right) => left.localeCompare(right));
}

async function collectSandboxInstalledSkillRoots(workspace: string, existingCustomSkillNames?: ReadonlySet<string>): Promise<string[]> {
  const sandboxCustomSkillsDir = path.join(workspace, ...SANDBOX_CUSTOM_SKILLS_RELATIVE_PATH);
  const entries = await fs.readdir(sandboxCustomSkillsDir, { withFileTypes: true }).catch((): null => null);
  if (!entries) {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && !existingCustomSkillNames?.has(entry.name))
    .map((entry) => path.join(sandboxCustomSkillsDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function sanitizeSkillName(rawName: string, fallbackName: string): string {
  const fallback = fallbackName.replace(/^[._]+/, '').trim() || 'custom-skill';
  const sanitized = rawName
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/^[._]+/, '')
    .trim();
  return sanitized || fallback;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readSkillMeta(skillDir: string): Promise<{ meta: WorkspaceSkillMeta; fileName: string } | null> {
  for (const fileName of SKILL_META_FILES) {
    const metaPath = path.join(skillDir, fileName);
    try {
      const raw = await fs.readFile(metaPath, 'utf-8');
      return { meta: JSON.parse(raw) as WorkspaceSkillMeta, fileName };
    } catch {
      // Try the next supported metadata file name.
    }
  }
  return null;
}

async function collectRelativeFiles(skillDir: string, currentDir = skillDir, currentRelativePath = ''): Promise<string[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const sourcePath = path.join(currentDir, entry.name);
    const relativePath = currentRelativePath ? path.posix.join(currentRelativePath, entry.name) : entry.name;

    if (entry.isSymbolicLink()) {
      throw new Error(`Symlinks are not supported in skill directories: ${relativePath}`);
    }

    if (entry.isDirectory()) {
      files.push(...(await collectRelativeFiles(skillDir, sourcePath, relativePath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

async function copySkillDirectory(sourceDir: string, targetDir: string): Promise<void> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  await fs.mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isSymbolicLink()) {
      throw new Error(`Symlinks are not supported in skill directories: ${entry.name}`);
    }

    if (entry.isDirectory()) {
      await copySkillDirectory(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

function createSiblingTempPath(targetDir: string, purpose: string): string {
  const parentDir = path.dirname(targetDir);
  const baseName = path.basename(targetDir);
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return path.join(parentDir, `.${baseName}-${purpose}-${unique}`);
}

async function replaceSkillDirectory(sourceDir: string, targetDir: string, metaFileName: string, meta: WorkspaceSkillMeta): Promise<void> {
  const targetStat = await fs.lstat(targetDir).catch((): null => null);
  if (targetStat && (!targetStat.isDirectory() || targetStat.isSymbolicLink())) {
    throw new Error(`Target skill path is not a directory: ${targetDir}`);
  }

  const tempDir = createSiblingTempPath(targetDir, 'update');
  const backupDir = createSiblingTempPath(targetDir, 'backup');
  let hasBackup = false;

  try {
    await copySkillDirectory(sourceDir, tempDir);
    await fs.writeFile(path.join(tempDir, metaFileName), JSON.stringify(meta, null, 2), 'utf-8');

    if (targetStat) {
      await fs.rename(targetDir, backupDir);
      hasBackup = true;
    }

    await fs.rename(tempDir, targetDir);

    if (hasBackup) {
      await fs.rm(backupDir, { recursive: true, force: true });
      hasBackup = false;
    }
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch((): void => undefined);

    if (hasBackup && !(await pathExists(targetDir))) {
      await fs.rename(backupDir, targetDir).catch((): void => undefined);
      hasBackup = false;
    }

    throw error;
  } finally {
    if (hasBackup) {
      await fs.rm(backupDir, { recursive: true, force: true }).catch((): void => undefined);
    }
  }
}

async function inspectCandidateSkill(sourceDir: string): Promise<InspectedWorkspaceSkill> {
  const stat = await fs.lstat(sourceDir).catch((): null => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    return { reason: 'not-directory' };
  }

  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const rootSkillMarkdown = findRootSkillMarkdownFileName(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  if (!rootSkillMarkdown) {
    return { reason: 'missing-skill-md' };
  }

  const hasMetadata = entries.some((entry) => entry.isFile() && SKILL_META_FILES.has(entry.name));
  if (!hasMetadata) {
    return { reason: 'missing-sudowork-meta' };
  }

  const metaResult = await readSkillMeta(sourceDir);
  if (!metaResult) {
    return { reason: 'invalid-sudowork-meta' };
  }

  const skillMarkdown = await fs.readFile(path.join(sourceDir, rootSkillMarkdown), 'utf-8');
  const frontmatter = parseSkillFrontmatter(skillMarkdown);
  const relativeFiles = await collectRelativeFiles(sourceDir);
  const fallbackName = sanitizeSkillName(path.basename(sourceDir), 'custom-skill');
  const skillName = sanitizeSkillName(metaResult.meta.name || frontmatter.name || fallbackName, fallbackName);
  const installedVersion = (metaResult.meta.installed_version || frontmatter.version || '1.0.0').trim() || '1.0.0';
  const installedAt = metaResult.meta.installed_at || new Date().toISOString();
  const displayName = metaResult.meta.display_name?.trim() || frontmatter.displayName?.trim() || buildSkillDisplayName(skillName);
  const category = metaResult.meta.category?.trim() || frontmatter.category?.trim() || '';
  const categories = Array.isArray(metaResult.meta.categories) ? metaResult.meta.categories.filter(Boolean) : category ? [category] : [];

  return {
    skillName,
    installedVersion,
    metaFileName: metaResult.fileName,
    meta: {
      id: metaResult.meta.id?.trim() || '',
      name: skillName,
      display_name: displayName,
      description: metaResult.meta.description?.trim() || frontmatter.description?.trim() || '',
      icon: metaResult.meta.icon?.trim() || frontmatter.icon?.trim() || resolveSkillIconFromFiles(relativeFiles) || '',
      emoji: metaResult.meta.emoji ?? frontmatter.emoji?.trim() ?? null,
      category,
      categories,
      applicable_scenarios: metaResult.meta.applicable_scenarios ?? null,
      core_features: metaResult.meta.core_features ?? null,
      homepage: metaResult.meta.homepage?.trim() || frontmatter.homepage?.trim() || null,
      author_id: metaResult.meta.author_id?.trim() || '',
      source_type: metaResult.meta.source_type === 'custom' ? 'custom' : 'upload',
      is_builtin: false,
      enabled: metaResult.meta.enabled !== false,
      installed_version: installedVersion,
      installed_at: installedAt,
    },
  };
}

async function inspectInstalledTargetForSource(customSkillsDir: string, sourceDir: string, existingCustomSkillNames?: ReadonlySet<string>): Promise<Extract<WorkspaceSkillInstallResult, { status: 'registered' }> | null> {
  const fallbackName = sanitizeSkillName(path.basename(sourceDir), 'custom-skill');
  const targetDir = path.join(customSkillsDir, fallbackName);
  if (!isPathInside(customSkillsDir, targetDir) || targetDir === customSkillsDir) {
    return null;
  }

  const inspected = await inspectCandidateSkill(targetDir).catch((): InspectedWorkspaceSkill => ({ reason: 'invalid-installed-skill' }));
  if ('reason' in inspected) {
    return null;
  }
  if (existingCustomSkillNames?.has(inspected.skillName)) {
    return null;
  }

  return {
    status: 'registered',
    skillName: inspected.skillName,
    installedVersion: inspected.installedVersion,
    sourceDir,
    targetDir,
  };
}

export async function installWorkspaceSkillsFromTrackedFiles(workspace: string, trackedFiles: TrackedWorkspaceFiles, deps: WorkspaceSkillInstallerDeps): Promise<WorkspaceSkillInstallResult[]> {
  const candidateRoots = Array.from(new Set([...collectWorkspaceSkillCandidateRoots(workspace, trackedFiles), ...(await collectSandboxInstalledSkillRoots(workspace, deps.existingCustomSkillNames))]));
  if (candidateRoots.length === 0) {
    return [];
  }

  const results: WorkspaceSkillInstallResult[] = [];
  const customSkillsDir = deps.getCustomSkillsDir();
  await fs.mkdir(customSkillsDir, { recursive: true });

  for (const sourceDir of candidateRoots) {
    const inspected = await inspectCandidateSkill(sourceDir).catch((error: unknown): InspectedWorkspaceSkill => ({
      reason: error instanceof Error ? error.message : String(error),
    }));

    if ('reason' in inspected) {
      const registered = await inspectInstalledTargetForSource(customSkillsDir, sourceDir, deps.existingCustomSkillNames);
      if (registered) {
        results.push(registered);
        continue;
      }

      results.push({ status: 'skipped', sourceDir, reason: inspected.reason, skillName: inspected.skillName });
      continue;
    }

    const targetDir = path.join(customSkillsDir, inspected.skillName);
    if (!isPathInside(customSkillsDir, targetDir) || targetDir === customSkillsDir) {
      results.push({ status: 'skipped', sourceDir, reason: 'unsafe-skill-name', skillName: inspected.skillName });
      continue;
    }

    if (isPathInside(customSkillsDir, sourceDir)) {
      results.push({ status: 'skipped', sourceDir, reason: 'source-already-custom-skill', skillName: inspected.skillName });
      continue;
    }

    if (await pathExists(targetDir)) {
      if (deps.existingCustomSkillNames?.has(inspected.skillName)) {
        try {
          const existingMeta = await readSkillMeta(targetDir);
          inspected.meta.installed_at = existingMeta?.meta.installed_at || inspected.meta.installed_at;
          inspected.meta.installed_version = inspected.installedVersion;
          inspected.meta.enabled = existingMeta?.meta.enabled !== false;
          await replaceSkillDirectory(sourceDir, targetDir, inspected.metaFileName, inspected.meta);
          results.push({
            status: 'updated',
            skillName: inspected.skillName,
            installedVersion: inspected.installedVersion,
            sourceDir,
            targetDir,
          });
        } catch (error) {
          results.push({
            status: 'skipped',
            sourceDir,
            reason: error instanceof Error ? error.message : String(error),
            skillName: inspected.skillName,
          });
        }
        continue;
      }

      if (!deps.existingCustomSkillNames?.has(inspected.skillName)) {
        results.push({
          status: 'registered',
          skillName: inspected.skillName,
          installedVersion: inspected.installedVersion,
          sourceDir,
          targetDir,
        });
        continue;
      }

      results.push({ status: 'skipped', sourceDir, reason: 'custom-skill-already-exists', skillName: inspected.skillName });
      continue;
    }

    try {
      await copySkillDirectory(sourceDir, targetDir);
      inspected.meta.installed_at = deps.now ? deps.now().toISOString() : new Date().toISOString();
      inspected.meta.installed_version = inspected.installedVersion;
      await fs.writeFile(path.join(targetDir, inspected.metaFileName), JSON.stringify(inspected.meta, null, 2), 'utf-8');
      // Provision ffmpeg on demand if this workspace-authored skill needs it.
      maybeProvisionFfmpegForSkill(targetDir);
      results.push({
        status: 'installed',
        skillName: inspected.skillName,
        installedVersion: inspected.installedVersion,
        sourceDir,
        targetDir,
      });
    } catch (error) {
      await fs.rm(targetDir, { recursive: true, force: true }).catch((): void => undefined);
      results.push({
        status: 'skipped',
        sourceDir,
        reason: error instanceof Error ? error.message : String(error),
        skillName: inspected.skillName,
      });
    }
  }

  if (results.some((result) => result.status === 'installed' || result.status === 'registered' || result.status === 'updated')) {
    deps.clearSkillsCache?.();
    deps.resetAcpSkillManager?.();
  }

  return results;
}
