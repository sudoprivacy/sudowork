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

import { DRAFTS_DIR_NAME, FILE_INTENT_MARKERS, COMMENT_SYNTAX_MAP, DRAFT_FILE_PATTERNS, FINAL_FILE_PATTERNS, DRAFT_EXTENSIONS, FINAL_EXTENSIONS } from '@/common/constants';
import { mainLog, mainError } from '@process/utils/mainLogger';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

/**
 * Files/directories that should never be moved
 * 永远不应被移动的文件/目录
 */
const EXCLUDED_NAMES = new Set([DRAFTS_DIR_NAME, '.git', '.gitignore', '.env', '.env.local', 'README.md', 'readme.md', 'LICENSE', 'package.json', 'package-lock.json', 'node_modules', '.DS_Store', 'Thumbs.db']);

/**
 * 检测文件意图标记结果
 * File intent detection result
 */
interface FileIntentResult {
  intent: 'final' | 'draft' | 'unknown';
  reason: string;
  marker?: string; // 检测到的具体标记
  line?: number; // 标记所在行号
}

/**
 * Check if file name matches draft patterns
 * 检查文件名是否匹配草稿模式
 */
export function matchesDraftPattern(fileName: string): boolean {
  const lower = fileName.toLowerCase();

  // Check prefix patterns
  for (const prefix of DRAFT_FILE_PATTERNS.prefixes) {
    if (lower.startsWith(prefix)) {
      return true;
    }
  }

  // Check suffix patterns (before extension)
  const ext = path.extname(lower);
  const baseName = lower.slice(0, lower.length - ext.length);
  for (const suffix of DRAFT_FILE_PATTERNS.suffixes) {
    if (baseName.endsWith(suffix)) {
      return true;
    }
  }

  // Check extension
  if (DRAFT_EXTENSIONS.includes(ext)) {
    return true;
  }

  return false;
}

/**
 * Check if file name matches final patterns
 * 检查文件名是否匹配最终文件模式
 */
function matchesFinalPattern(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  const ext = path.extname(lower);
  const baseName = lower.slice(0, lower.length - ext.length);

  // Check suffix patterns
  for (const suffix of FINAL_FILE_PATTERNS.suffixes) {
    if (baseName.endsWith(suffix)) {
      return true;
    }
  }

  // Check extension
  if (FINAL_EXTENSIONS.includes(ext)) {
    return true;
  }

  return false;
}

/**
 * 检测文件意图标记
 * Detect file intent markers from file content
 *
 * Scans the first 10 lines for comment markers like '@final' or '@draft'
 *
 * @param filePath - 文件路径
 * @param content - 文件内容
 * @returns 意图检测结果
 */
export function detectFileIntent(filePath: string, content: string): FileIntentResult {
  // 1. 获取文件的注释语法
  const ext = path.extname(filePath).toLowerCase();
  const commentPrefix = COMMENT_SYNTAX_MAP[ext] || COMMENT_SYNTAX_MAP.default;

  // 2. 只扫描前10行（标记应该在文件头部）
  const lines = content.split('\n').slice(0, 10);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // HTML/XML comment handling
    if (commentPrefix === '<!--') {
      if (line.startsWith('<!--') && line.endsWith('-->')) {
        const commentContent = line.slice(4, -3).trim();

        // 检测 final 标记
        for (const marker of FILE_INTENT_MARKERS.final) {
          if (commentContent.includes(marker)) {
            return { intent: 'final', reason: `Detected ${marker} marker at line ${i + 1}`, marker, line: i + 1 };
          }
        }

        // 检测 draft 标记
        for (const marker of FILE_INTENT_MARKERS.draft) {
          if (commentContent.includes(marker)) {
            return { intent: 'draft', reason: `Detected ${marker} marker at line ${i + 1}`, marker, line: i + 1 };
          }
        }
      }
    } else {
      // Regular single-line comment: # @final or // @draft
      if (!line.startsWith(commentPrefix)) continue;

      // 提取注释内容（去掉注释符号）
      const commentContent = line.slice(commentPrefix.length).trim();

      // 检测 final 标记
      for (const marker of FILE_INTENT_MARKERS.final) {
        if (commentContent.includes(marker)) {
          return { intent: 'final', reason: `Detected ${marker} marker at line ${i + 1}`, marker, line: i + 1 };
        }
      }

      // 检测 draft 标记
      for (const marker of FILE_INTENT_MARKERS.draft) {
        if (commentContent.includes(marker)) {
          return { intent: 'draft', reason: `Detected ${marker} marker at line ${i + 1}`, marker, line: i + 1 };
        }
      }
    }
  }

  // 无标记 → unknown（默认视为 final）
  return { intent: 'unknown', reason: 'No marker found' };
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
export async function cleanupIntermediateFiles(workspace: string): Promise<void> {
  try {
    const draftsDir = path.join(workspace, DRAFTS_DIR_NAME);

    // Read workspace root entries
    if (!fsSync.existsSync(workspace)) {
      return;
    }

    const entries = await fs.readdir(workspace, { withFileTypes: true });
    const filesToMove: Array<{ name: string; reason: string }> = [];
    const filesToKeep: Array<{ name: string; reason: string }> = [];

    // Track if there are @draft scripts (indicates script execution scenario)
    let hasDraftScripts = false;

    for (const entry of entries) {
      // Skip directories and excluded names
      if (!entry.isFile()) continue;
      if (EXCLUDED_NAMES.has(entry.name)) continue;

      const filePath = path.join(workspace, entry.name);
      let intentResult: FileIntentResult;

      // Try to read file content for marker detection
      let content: string | null = null;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch (readErr) {
        // Binary or locked file - use pattern detection only
        mainLog('draftsCleanup', `Cannot read ${entry.name}, using pattern detection only`);
      }

      // Priority 1: Check for markers in content
      if (content) {
        intentResult = detectFileIntent(filePath, content);
        if (intentResult.intent === 'draft') {
          filesToMove.push({
            name: entry.name,
            reason: `Detected @draft marker at line ${intentResult.line}`,
          });
          hasDraftScripts = true;
          mainLog('draftsCleanup', `[MARKER] ${entry.name}: @draft detected at line ${intentResult.line}, will move to .drafts/`);
          continue;
        } else if (intentResult.intent === 'final') {
          filesToKeep.push({
            name: entry.name,
            reason: `Detected @final marker at line ${intentResult.line}`,
          });
          mainLog('draftsCleanup', `[MARKER] ${entry.name}: @final detected at line ${intentResult.line}, will keep in workspace root`);
          continue;
        }
      }

      // Priority 2: Check final patterns (override draft patterns)
      if (matchesFinalPattern(entry.name)) {
        filesToKeep.push({
          name: entry.name,
          reason: 'Matches final file pattern',
        });
        mainLog('draftsCleanup', `[PATTERN] ${entry.name}: matches final pattern, keeping in workspace root`);
        continue;
      }

      // Priority 3: Check draft patterns
      if (matchesDraftPattern(entry.name)) {
        filesToMove.push({
          name: entry.name,
          reason: 'Matches draft file pattern',
        });
        hasDraftScripts = true;
        mainLog('draftsCleanup', `[PATTERN] ${entry.name}: matches draft pattern, will move to .drafts/`);
        continue;
      }

      // Priority 4: Default - keep in workspace root (safe default)
      filesToKeep.push({
        name: entry.name,
        reason: 'No marker or pattern match, defaulting to final',
      });
      mainLog('draftsCleanup', `[DEFAULT] ${entry.name}: no marker/pattern, treating as final (safe default)`);
    }

    // 如果没有需要移动的文件，直接返回
    if (filesToMove.length === 0) {
      return;
    }

    // Ensure .drafts/ directory exists
    if (!fsSync.existsSync(draftsDir)) {
      await fs.mkdir(draftsDir, { recursive: true });
    }

    // Move draft files
    let movedCount = 0;
    for (const { name, reason } of filesToMove) {
      const srcPath = path.join(workspace, name);
      let destPath = path.join(draftsDir, name);

      // Handle name collision: append timestamp
      if (fsSync.existsSync(destPath)) {
        const ext = path.extname(name);
        const base = path.basename(name, ext);
        destPath = path.join(draftsDir, `${base}_${Date.now()}${ext}`);
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
        const filePath = path.join(workspace, fileName);
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
        const dirPath = path.join(workspace, dirName);
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
  // Files that should NEVER be moved from parent workspace (OpenClaw system files + EXCLUDED_NAMES)
  // 永远不应从父工作空间移动的文件（OpenClaw 系统文件 + EXCLUDED_NAMES）
  const PARENT_EXCLUDED_NAMES = new Set([
    ...EXCLUDED_NAMES,
    // OpenClaw system configuration files
    'AGENTS.md',
    'HEARTBEAT.md',
    'IDENTITY.md',
    'SOUL.md',
    'TOOLS.md',
    'USER.md',
    'memory',
    '.openclaw',
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
