/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Post-cleanup: move intermediate files from workspace root to .drafts/ directory
 * 后置清理：将工作空间根目录中的中间文件自动移动到 .drafts/ 目录
 *
 * This runs after each Agent turn completes, providing a safety net
 * in case the LLM ignores the system prompt and writes intermediate files
 * directly to the workspace root instead of .drafts/.
 */

import { DRAFTS_DIR_ALIASES, DRAFTS_DIR_NAME } from '@/common/constants';
import { mainLog, mainError } from '@process/utils/mainLogger';
import fs from 'fs/promises';
import fsSync from 'fs';
import type { Dirent } from 'fs';
import path from 'path';
import { FileIntentClassifier, detectFileIntent, matchesDraftPattern, matchesFinalPattern, type FileIntent, type FileIntentSource } from './FileIntentClassifier';

/**
 * Files/directories that should never be moved
 * 永远不应被移动的文件/目录
 */
const EXCLUDED_NAMES = new Set([DRAFTS_DIR_NAME, ...DRAFTS_DIR_ALIASES, '.git', '.gitignore', '.env', '.env.local', 'README.md', 'readme.md', 'LICENSE', 'package.json', 'package-lock.json', 'node_modules', '.DS_Store', 'Thumbs.db']);

export { detectFileIntent, matchesDraftPattern, matchesFinalPattern };

export interface TrackedTurnFile {
  actualPath: string;
  path: string;
  requestedPath: string;
  intent: FileIntent;
  reason: string;
  source: FileIntentSource;
  kind: 'create' | 'edit';
  /**
   * Mirror of FileIntentClassification.userInitiated — only set when the
   * draft decision came from an explicit user/operation request (move-to-drafts).
   * archiveTurnFiles uses this to choose archive vs. leave-in-place:
   *   - userInitiated drafts → archive to .drafts/<basename>
   *   - AI-auto drafts (undefined/false) → leave on disk where the model wrote
   *     them, so cross-turn workflows (e.g. multi-turn PPT slide composition)
   *     can still reference them. They're hidden from UI by other surfaces.
   */
  userInitiated?: boolean;
}

export interface CleanupIntermediateFilesOptions {
  protectedFinalPaths?: Iterable<string>;
}

const fileIntentClassifier = new FileIntentClassifier();

function appendTimestamp(filePath: string, attempt: number = 0): string {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const suffix = attempt > 0 ? `_${attempt}` : '';
  return path.join(dir, `${base}_${Date.now()}${suffix}${ext}`);
}

async function moveWithTimestampCollision(srcPath: string, destPath: string): Promise<string> {
  let finalDestPath = destPath;
  let attempt = 0;
  while (fsSync.existsSync(finalDestPath)) {
    finalDestPath = appendTimestamp(destPath, attempt);
    attempt++;
  }
  await fs.rename(srcPath, finalDestPath);
  return finalDestPath;
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveTrackedPath(file: TrackedTurnFile): string {
  return file.path || file.actualPath;
}

function normalizeProtectedPath(workspace: string, protectedPath: string): string | null {
  const trimmedPath = protectedPath.trim();
  if (!trimmedPath) {
    return null;
  }

  const resolvedPath = path.isAbsolute(trimmedPath) ? path.resolve(trimmedPath) : path.resolve(workspace, trimmedPath);
  const relativePath = path.relative(workspace, resolvedPath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath) || relativePath.startsWith(`${DRAFTS_DIR_NAME}${path.sep}`)) {
    return null;
  }

  return relativePath.replace(/\\/g, '/');
}

function resolveRootDestination(workspace: string, filePath: string, requestedPath: string): string {
  const relative = path.isAbsolute(requestedPath) ? path.basename(requestedPath) : requestedPath;
  const normalized = relative.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('../') || normalized.includes('/../')) {
    return path.join(workspace, path.basename(filePath));
  }
  if (normalized.startsWith(`${DRAFTS_DIR_NAME}/`)) {
    return path.join(workspace, path.basename(filePath));
  }
  return path.join(workspace, normalized);
}

function isScriptFile(fileName: string): boolean {
  return ['.py', '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.sh', '.bash', '.zsh', '.rb', '.php', '.lua'].includes(path.extname(fileName).toLowerCase());
}

async function normalizeDraftsAliasDirectories(workspace: string, draftsDir: string, entries: Dirent[]): Promise<number> {
  const aliasEntries = entries.filter((entry) => entry.isDirectory() && DRAFTS_DIR_ALIASES.some((alias) => alias.toLowerCase() === entry.name.toLowerCase()));
  if (aliasEntries.length === 0) {
    return 0;
  }

  await fs.mkdir(draftsDir, { recursive: true });

  let movedCount = 0;
  for (const aliasEntry of aliasEntries) {
    const aliasDir = path.join(workspace, aliasEntry.name);
    const children = await fs.readdir(aliasDir, { withFileTypes: true });

    for (const child of children) {
      const srcPath = path.join(aliasDir, child.name);
      const destPath = path.join(draftsDir, child.name);
      try {
        const finalDestPath = await moveWithTimestampCollision(srcPath, destPath);
        movedCount++;
        mainLog('draftsCleanup', `Moved misplaced drafts alias entry ${aliasEntry.name}/${child.name} to ${path.relative(workspace, finalDestPath)}`);
      } catch (err) {
        mainError('draftsCleanup', `Failed to move misplaced drafts alias entry ${aliasEntry.name}/${child.name}:`, err);
      }
    }

    try {
      const remaining = await fs.readdir(aliasDir);
      if (remaining.length === 0) {
        await fs.rmdir(aliasDir);
        mainLog('draftsCleanup', `Removed empty drafts alias directory ${aliasEntry.name}`);
      }
    } catch (err) {
      mainError('draftsCleanup', `Failed to remove drafts alias directory ${aliasEntry.name}:`, err);
    }
  }

  return movedCount;
}

/**
 * Move draft files from workspace root to .drafts/ directory
 * 将草稿文件从工作空间根目录移动到 .drafts/ 目录
 *
 * NEW LOGIC:
 * 1. Files with @draft marker → Move to .drafts/
 * 2. Files with @final marker → Keep in workspace root
 * 3. Files without marker → Keep in workspace root (default safe strategy)
 * 4. Script execution side effects (package.json/node_modules with @draft scripts) → Move to .drafts/
 *
 * @param workspace - The workspace root path
 */
export async function cleanupIntermediateFiles(workspace: string, options: CleanupIntermediateFilesOptions = {}): Promise<void> {
  try {
    const workspaceRoot = path.resolve(workspace);
    const draftsDir = path.join(workspaceRoot, DRAFTS_DIR_NAME);
    const protectedFinalPaths = new Set(Array.from(options.protectedFinalPaths || []).map((protectedPath) => normalizeProtectedPath(workspaceRoot, protectedPath)).filter((protectedPath): protectedPath is string => protectedPath !== null));

    // Read workspace root entries
    if (!fsSync.existsSync(workspaceRoot)) {
      return;
    }

    const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
    const movedAliasCount = await normalizeDraftsAliasDirectories(workspaceRoot, draftsDir, entries);
    const filesToMove: Array<{ name: string; reason: string }> = [];
    const filesToKeep: Array<{ name: string; reason: string }> = [];

    // Track if there are @draft scripts (indicates script execution scenario)
    let hasDraftScripts = false;

    for (const entry of entries) {
      // Skip directories and excluded names
      if (!entry.isFile()) continue;
      if (EXCLUDED_NAMES.has(entry.name)) continue;

      const filePath = path.join(workspaceRoot, entry.name);
      const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
      if (protectedFinalPaths.has(relativePath)) {
        filesToKeep.push({
          name: entry.name,
          reason: 'Protected current-turn final file',
        });
        mainLog('draftsCleanup', `[CLASSIFY] ${entry.name}: final (Protected current-turn final file), keeping in workspace root`);
        continue;
      }

      // Try to read file content for marker detection
      let content: string | null = null;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch (readErr) {
        // Binary or locked file - use pattern detection only
        mainLog('draftsCleanup', `Cannot read ${entry.name}, using pattern detection only`);
      }

      const classification = fileIntentClassifier.classify({
        filePath,
        requestedPath: entry.name,
        content,
        source: 'cleanup',
      });

      if (classification.intent === 'draft') {
        filesToMove.push({
          name: entry.name,
          reason: classification.reason,
        });
        hasDraftScripts ||= isScriptFile(entry.name);
        mainLog('draftsCleanup', `[CLASSIFY] ${entry.name}: draft (${classification.reason}), will move to .drafts/`);
        continue;
      }

      filesToKeep.push({
        name: entry.name,
        reason: classification.reason,
      });
      mainLog('draftsCleanup', `[CLASSIFY] ${entry.name}: final (${classification.reason}), keeping in workspace root`);
    }

    // 如果没有需要移动的文件，直接返回
    if (filesToMove.length === 0) {
      if (movedAliasCount > 0) {
        mainLog('draftsCleanup', `Cleanup completed: normalized ${movedAliasCount} misplaced drafts alias entr${movedAliasCount === 1 ? 'y' : 'ies'}`);
      }
      return;
    }

    // Ensure .drafts/ directory exists
    if (!fsSync.existsSync(draftsDir)) {
      await fs.mkdir(draftsDir, { recursive: true });
    }

    // Move draft files
    let movedCount = 0;
    for (const { name, reason } of filesToMove) {
      const srcPath = path.join(workspaceRoot, name);
      let destPath = path.join(draftsDir, name);

      // Handle name collision: append timestamp
      if (fsSync.existsSync(destPath)) {
        destPath = appendTimestamp(destPath);
      }

      try {
        await fs.rename(srcPath, destPath);
        movedCount++;
        mainLog('draftsCleanup', `Moved ${name} to ${DRAFTS_DIR_NAME}/ (${reason})`);
      } catch (err) {
        mainError('draftsCleanup', `Failed to move ${name} to drafts:`, err);
      }
    }

    if (movedCount > 0) {
      mainLog('draftsCleanup', `Cleanup completed: moved ${movedCount} draft file(s), kept ${filesToKeep.length} final file(s)`);
    }

    // Script execution side effects cleanup
    // When @draft scripts exist, their execution may have created package.json, node_modules, etc.
    // These should be moved to .drafts/ or deleted
    // Note: These files are in EXCLUDED_NAMES for normal file handling, but we explicitly clean them up here
    if (hasDraftScripts) {
      const sideEffectFiles = ['package.json', 'package-lock.json', 'bun.lockb'];
      const sideEffectDirs = ['node_modules'];

      for (const fileName of sideEffectFiles) {
        const filePath = path.join(workspaceRoot, fileName);
        if (fsSync.existsSync(filePath)) {
          const destPath = path.join(draftsDir, fileName);
          try {
            await fs.rename(filePath, destPath);
            mainLog('draftsCleanup', `Moved script side effect ${fileName} to ${DRAFTS_DIR_NAME}/`);
          } catch (err) {
            mainError('draftsCleanup', `Failed to move ${fileName}:`, err);
          }
        }
      }

      for (const dirName of sideEffectDirs) {
        const dirPath = path.join(workspaceRoot, dirName);
        if (fsSync.existsSync(dirPath)) {
          try {
            await fs.rm(dirPath, { recursive: true, force: true });
            mainLog('draftsCleanup', `Deleted script side effect directory ${dirName}`);
          } catch (err) {
            mainError('draftsCleanup', `Failed to delete ${dirName}:`, err);
          }
        }
      }
    }
  } catch (err) {
    mainError('draftsCleanup', 'Cleanup failed:', err);
  }
}

/**
 * Archive the current turn's tracked files (drafts → .drafts/, finals → root),
 * returning a map of `trackingKey → final absolute path on disk` for every file
 * that still exists after archiving.
 *
 * Callers (e.g. the generated-files marker builder) MUST use these returned
 * paths instead of the pre-archive `actualPath`, because a final file may have
 * been moved out of `.drafts/` and/or renamed by timestamp-collision handling
 * during this call. Files that were skipped (missing on disk, outside the
 * workspace) are intentionally omitted from the map so callers fall back to
 * their recorded path.
 */
export async function archiveTurnFiles(workspace: string, trackedFiles: ReadonlyMap<string, TrackedTurnFile>): Promise<Map<string, string>> {
  const finalPaths = new Map<string, string>();
  if (!fsSync.existsSync(workspace)) {
    return finalPaths;
  }

  const workspaceRoot = path.resolve(workspace);
  const draftsDir = path.join(workspaceRoot, DRAFTS_DIR_NAME);
  let movedDrafts = 0;
  let movedFinals = 0;

  for (const [trackedKey, file] of trackedFiles) {
    const srcPath = path.resolve(resolveTrackedPath(file));
    if (!fsSync.existsSync(srcPath)) {
      continue;
    }
    if (!isPathInside(workspaceRoot, srcPath)) {
      mainLog('draftsCleanup', `[TURN-ARCHIVE] Skipping outside-workspace file ${srcPath}`);
      continue;
    }

    // AI-auto drafts (classifier heuristics, not user-explicit) stay on disk
    // in their original location. Cross-turn workflows (e.g. PPT slide images
    // generated in earlier turns and re-read by build_pptx.py in a later turn)
    // depend on these files remaining accessible. They're hidden from UI
    // surfaces — chat cards / deliverables tab filter to intent='final', and
    // the workspace tree hides INTERMEDIATE_DIR_SEGMENTS.
    if (file.intent === 'draft' && !file.userInitiated) {
      finalPaths.set(trackedKey, srcPath);
      mainLog('draftsCleanup', `[TURN-ARCHIVE] Leaving AI-auto draft in place: ${trackedKey} (${file.reason})`);
      continue;
    }

    const inDrafts = isPathInside(draftsDir, srcPath);
    const destPath =
      file.intent === 'draft'
        ? path.join(draftsDir, path.basename(srcPath))
        : resolveRootDestination(workspaceRoot, srcPath, file.requestedPath || trackedKey);

    const resolvedDestPath = path.resolve(destPath);
    if (srcPath === resolvedDestPath) {
      finalPaths.set(trackedKey, srcPath);
      continue;
    }

    try {
      await fs.mkdir(path.dirname(resolvedDestPath), { recursive: true });
      const finalDestPath = await moveWithTimestampCollision(srcPath, resolvedDestPath);
      finalPaths.set(trackedKey, path.resolve(finalDestPath));
      if (file.intent === 'draft') {
        movedDrafts++;
      } else if (inDrafts || path.dirname(srcPath) !== path.dirname(finalDestPath)) {
        movedFinals++;
      }
      mainLog('draftsCleanup', `[TURN-ARCHIVE] Moved ${trackedKey} to ${path.relative(workspaceRoot, finalDestPath)} (${file.intent}: ${file.reason})`);
    } catch (err) {
      // Move failed — the file is still at its original location.
      finalPaths.set(trackedKey, srcPath);
      mainError('draftsCleanup', `[TURN-ARCHIVE] Failed to move ${trackedKey}:`, err);
    }
  }

  if (movedDrafts > 0 || movedFinals > 0) {
    mainLog('draftsCleanup', `[TURN-ARCHIVE] Completed: moved ${movedDrafts} draft file(s), restored ${movedFinals} final file(s)`);
  }

  return finalPaths;
}

export async function cleanupTrackedDraftsOnCancel(workspace: string, trackedFiles: ReadonlyMap<string, TrackedTurnFile>): Promise<number> {
  if (!fsSync.existsSync(workspace)) {
    return 0;
  }

  const workspaceRoot = path.resolve(workspace);
  let removedCount = 0;

  for (const [trackedKey, file] of trackedFiles) {
    if (file.intent !== 'draft') {
      continue;
    }

    const filePath = path.resolve(resolveTrackedPath(file));
    if (!isPathInside(workspaceRoot, filePath) || !fsSync.existsSync(filePath)) {
      continue;
    }

    try {
      await fs.rm(filePath, { recursive: true, force: true });
      removedCount++;
      mainLog('draftsCleanup', `[CANCEL] Removed current-turn draft: ${trackedKey}`);
    } catch (err) {
      mainError('draftsCleanup', `Failed to remove current-turn draft ${trackedKey}:`, err);
    }
  }

  return removedCount;
}

/**
 * Pattern to match temporary workspace naming convention: <backend>-temp-<timestamp>
 * Matches any workspace ending with -temp- followed by digits (Unix timestamp)
 * Examples: scode-temp-1234567890, sudoclaw-temp-1234567890, claude-temp-1234567890
 */
const TEMP_WORKSPACE_REGEX = /-temp-\d+$/;

/**
 * Check if a directory name is a temporary workspace
 * 检查目录名是否为临时工作空间
 */
function isTempWorkspace(name: string): boolean {
  return TEMP_WORKSPACE_REGEX.test(name);
}

/**
 * Clean up files that were mistakenly written to the parent workspace directory
 * 清理错误写入父工作空间目录的文件
 *
 * When Agent fails and retries, it may write files to the parent workspace
 * instead of the session-specific workspace. This function detects and moves
 * those files to the correct session workspace.
 *
 * @param sessionWorkspace - The session workspace path (e.g., /.../workspace/scode-temp-xxx)
 * @param parentWorkspace - The parent workspace path (e.g., /.../workspace)
 * @param maxAgeMs - Maximum file age to consider (default: 5 minutes)
 */
export async function cleanupMisplacedFiles(sessionWorkspace: string, parentWorkspace: string, maxAgeMs: number = 5 * 60 * 1000): Promise<void> {
  // Files that should NEVER be moved from parent workspace (system files + EXCLUDED_NAMES)
  // 永远不应从父工作空间移动的文件（系统文件 + EXCLUDED_NAMES）
  const PARENT_EXCLUDED_NAMES = new Set([
    ...EXCLUDED_NAMES,
    // Agent system configuration files
    'AGENTS.md',
    'HEARTBEAT.md',
    'IDENTITY.md',
    'SOUL.md',
    'TOOLS.md',
    'USER.md',
    'memory',
    'agent_task',
    // Other common project files that should NOT be excluded (they are user-generated)
  ]);

  try {
    if (!fsSync.existsSync(parentWorkspace) || !fsSync.existsSync(sessionWorkspace)) {
      return;
    }

    const now = Date.now();
    const entries = await fs.readdir(parentWorkspace, { withFileTypes: true });
    const sessionWorkspaceName = path.basename(sessionWorkspace);
    const movedFiles: string[] = [];

    for (const entry of entries) {
      // Skip directories (except if it's a non-session temp directory)
      if (!entry.isFile()) {
        // Check if it's a directory that might be misplaced (like unpacked_docx)
        // Skip temp workspace directories (e.g., scode-temp-xxx, sudoclaw-temp-xxx)
        if (entry.isDirectory() && !PARENT_EXCLUDED_NAMES.has(entry.name) && !isTempWorkspace(entry.name)) {
          const dirPath = path.join(parentWorkspace, entry.name);
          try {
            const stat = await fs.stat(dirPath);
            if (now - stat.mtimeMs < maxAgeMs) {
              // Move recent directory to session workspace
              const destPath = path.join(sessionWorkspace, entry.name);
              if (!fsSync.existsSync(destPath)) {
                await fs.rename(dirPath, destPath);
                movedFiles.push(entry.name);
                mainLog('draftsCleanup', `Moved misplaced directory ${entry.name} from parent to session workspace`);
              }
            }
          } catch {
            // Ignore stat errors
          }
        }
        continue;
      }

      // Skip excluded names and temp workspace directories
      if (PARENT_EXCLUDED_NAMES.has(entry.name) || isTempWorkspace(entry.name)) {
        continue;
      }

      const filePath = path.join(parentWorkspace, entry.name);

      try {
        const stat = await fs.stat(filePath);
        // Only move files created within the last maxAgeMs milliseconds
        if (now - stat.mtimeMs < maxAgeMs) {
          const destPath = path.join(sessionWorkspace, entry.name);

          // Don't overwrite existing files in session workspace
          if (!fsSync.existsSync(destPath)) {
            await fs.rename(filePath, destPath);
            movedFiles.push(entry.name);
            mainLog('draftsCleanup', `Moved misplaced file ${entry.name} from parent to session workspace`);
          }
        }
      } catch {
        // Ignore stat errors for individual files
      }
    }

    if (movedFiles.length > 0) {
      mainLog('draftsCleanup', `Misplaced files cleanup: moved ${movedFiles.length} file(s) to session workspace`);
    }
  } catch (err) {
    mainError('draftsCleanup', 'Misplaced files cleanup failed:', err);
  }
}

/**
 * Clean up draft files when session is cancelled/aborted
 * 会话取消/中止时清理草稿文件
 *
 * This function is called when the user cancels a session.
 * It removes all files in the .drafts/ directory and optionally
 * removes draft files from the workspace root.
 *
 * @param workspace - The workspace root path
 * @param removeDraftsFromRoot - Also remove draft files from workspace root (default: true)
 * @returns Number of files removed
 */
export async function cleanupDraftsOnCancel(workspace: string, removeDraftsFromRoot: boolean = true): Promise<number> {
  let removedCount = 0;

  try {
    const draftsDir = path.join(workspace, DRAFTS_DIR_NAME);

    // 1. Remove all files in .drafts/ directory
    if (fsSync.existsSync(draftsDir)) {
      const draftEntries = await fs.readdir(draftsDir, { withFileTypes: true });

      for (const entry of draftEntries) {
        const entryPath = path.join(draftsDir, entry.name);
        try {
          if (entry.isDirectory()) {
            await fs.rm(entryPath, { recursive: true, force: true });
          } else {
            await fs.unlink(entryPath);
          }
          removedCount++;
          mainLog('draftsCleanup', `[CANCEL] Removed draft file: ${entry.name}`);
        } catch (err) {
          mainError('draftsCleanup', `Failed to remove draft file ${entry.name}:`, err);
        }
      }

      mainLog('draftsCleanup', `[CANCEL] Cleaned up ${removedCount} draft file(s) from .drafts/`);
    }

    // 2. Optionally remove draft files from workspace root
    if (removeDraftsFromRoot && fsSync.existsSync(workspace)) {
      const entries = await fs.readdir(workspace, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (EXCLUDED_NAMES.has(entry.name)) continue;

        // Check if file matches draft pattern
        if (matchesDraftPattern(entry.name)) {
          const filePath = path.join(workspace, entry.name);
          try {
            await fs.unlink(filePath);
            removedCount++;
            mainLog('draftsCleanup', `[CANCEL] Removed draft file from root: ${entry.name}`);
          } catch (err) {
            mainError('draftsCleanup', `Failed to remove draft file ${entry.name}:`, err);
          }
        }
      }
    }

    if (removedCount > 0) {
      mainLog('draftsCleanup', `[CANCEL] Total draft files removed: ${removedCount}`);
    }
  } catch (err) {
    mainError('draftsCleanup', 'Draft cleanup on cancel failed:', err);
  }

  return removedCount;
}
