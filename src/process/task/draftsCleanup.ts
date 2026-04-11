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

import { DRAFTS_DIR_NAME } from '@/common/constants';
import { mainLog, mainError } from '@process/utils/mainLogger';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

/**
 * File extensions considered as intermediate/temporary files
 * 被视为中间/临时文件的扩展名
 */
const INTERMEDIATE_EXTENSIONS = new Set([
  // Scripts
  '.py',
  '.sh',
  '.bash',
  '.bat',
  '.ps1',
  '.rb',
  '.pl',
  // Temp data
  '.tmp',
  '.temp',
  '.bak',
  '.log',
  // Draft/intermediate markers
  '.draft',
  '.wip',
]);

/**
 * File name patterns that indicate intermediate files
 * 表示中间文件的文件名模式
 */
const INTERMEDIATE_PATTERNS = [/^temp[_-]/i, /^tmp[_-]/i, /[_-]draft\./i, /[_-]temp\./i, /[_-]tmp\./i, /^scratch[_-]/i, /^test_script/i, /^helper[_-]/i, /^step[_-]?\d+/i];

/**
 * Files/directories that should never be moved
 * 永远不应被移动的文件/目录
 */
const EXCLUDED_NAMES = new Set([DRAFTS_DIR_NAME, '.git', '.gitignore', '.env', 'README.md', 'readme.md', 'LICENSE', 'package.json', 'node_modules']);

/**
 * Check if a file is an intermediate file based on its extension and name
 * 根据扩展名和文件名判断是否为中间文件
 */
function isIntermediateFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();

  // Check extension
  if (INTERMEDIATE_EXTENSIONS.has(ext)) {
    return true;
  }

  // Check name patterns
  return INTERMEDIATE_PATTERNS.some((pattern) => pattern.test(fileName));
}

/**
 * Move intermediate files from workspace root to .drafts/ directory
 * 将中间文件从工作空间根目录移动到 .drafts/ 目录
 *
 * Only processes files directly in the workspace root (not recursive).
 * Only moves files that match intermediate file patterns.
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
    const filesToMove: string[] = [];

    for (const entry of entries) {
      // Skip directories, excluded names, and hidden files (except known intermediate ones)
      if (!entry.isFile()) continue;
      if (EXCLUDED_NAMES.has(entry.name)) continue;

      if (isIntermediateFile(entry.name)) {
        filesToMove.push(entry.name);
      }
    }

    if (filesToMove.length === 0) {
      return;
    }

    // Ensure .drafts/ directory exists
    if (!fsSync.existsSync(draftsDir)) {
      await fs.mkdir(draftsDir, { recursive: true });
    }

    // Move files
    let movedCount = 0;
    for (const fileName of filesToMove) {
      const srcPath = path.join(workspace, fileName);
      let destPath = path.join(draftsDir, fileName);

      // Handle name collision: append timestamp
      if (fsSync.existsSync(destPath)) {
        const ext = path.extname(fileName);
        const base = path.basename(fileName, ext);
        destPath = path.join(draftsDir, `${base}_${Date.now()}${ext}`);
      }

      try {
        await fs.rename(srcPath, destPath);
        movedCount++;
      } catch (err) {
        mainError('draftsCleanup', `Failed to move ${fileName} to drafts:`, err);
      }
    }

    if (movedCount > 0) {
      mainLog('draftsCleanup', `Moved ${movedCount} intermediate file(s) to ${DRAFTS_DIR_NAME}/ in ${workspace}`);
    }
  } catch (err) {
    mainError('draftsCleanup', 'Cleanup failed:', err);
  }
}
