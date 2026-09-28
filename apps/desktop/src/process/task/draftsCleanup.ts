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

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { mainLog, mainError } from '@process/utils/mainLogger';
import { DRAFTS_DIR_ALIASES, DRAFTS_DIR_NAME } from '@/common/constants';
import { detectFileIntent, matchesDraftPattern, matchesFinalPattern, type FileIntent, type FileIntentSource } from './FileIntentClassifier';

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

/** Ensure the draft directory without sweeping inputs or relocating live dependencies. */
export async function cleanupIntermediateFiles(workspace: string, _options: CleanupIntermediateFilesOptions = {}): Promise<void> {
  if (fsSync.existsSync(workspace)) await fs.mkdir(path.join(workspace, DRAFTS_DIR_NAME), { recursive: true });
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
    const destPath = file.intent === 'draft' ? path.join(draftsDir, path.relative(workspaceRoot, srcPath)) : resolveRootDestination(workspaceRoot, srcPath, file.requestedPath || trackedKey);

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
  // Cancellation stops execution, not retention. Preserve drafts and live dependencies.
  await archiveTurnFiles(workspace, trackedFiles);
  return 0;
}

/**
 * Pattern to match temporary workspace naming convention: <backend>-temp-<timestamp>
 * Matches any workspace ending with -temp- followed by digits (Unix timestamp)
 * Examples: scode-temp-1234567890, sudoclaw-temp-1234567890, claude-temp-1234567890
 */
export const TEMP_WORKSPACE_REGEX = /-temp-\d+$/;

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

/** Cancellation preserves drafts so the next turn can resume the task. */
export async function cleanupDraftsOnCancel(_workspace: string, _removeDraftsFromRoot: boolean = true): Promise<number> {
  return 0;
}
