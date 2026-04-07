/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Workspace management bridge
 * Handles workspace directory rename and drafts file operations
 *
 * 工作空间管理桥接层
 * 处理工作空间目录重命名和草稿箱文件操作
 */

import { DRAFTS_DIR_NAME } from '@/common/constants';
import { isValidDirectoryName } from '@/common/utils/pathValidation';
import { ipcBridge } from '@/common';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getDatabase } from '@process/database';
import { mainLog, mainError } from '@process/utils/mainLogger';

export function registerWorkspaceBridge(): void {
  // ============================================================================
  // Drafts operations / 草稿箱操作
  // ============================================================================

  /**
   * List files in drafts directory
   * 列出草稿箱中的文件
   */
  ipcBridge.drafts.listDrafts.provider(async ({ workspace }) => {
    const draftsDir = path.join(workspace, DRAFTS_DIR_NAME);

    try {
      await fs.access(draftsDir);
    } catch {
      return { success: true, data: [] };
    }

    try {
      const entries = await fs.readdir(draftsDir, { withFileTypes: true });
      const files = [];

      for (const entry of entries) {
        if (entry.isFile()) {
          const filePath = path.join(draftsDir, entry.name);
          const stat = await fs.stat(filePath);
          files.push({
            name: entry.name,
            size: stat.size,
            modifiedAt: stat.mtimeMs,
          });
        }
      }

      // Sort by modification time (newest first)
      files.sort((a, b) => b.modifiedAt - a.modifiedAt);

      return { success: true, data: files };
    } catch (error) {
      mainError('workspaceBridge', 'Failed to list drafts:', error);
      return { success: false, error: (error as Error).message, data: [] };
    }
  });

  /**
   * Read a draft file content
   * 读取草稿文件内容
   */
  ipcBridge.drafts.readDraft.provider(async ({ workspace, fileName }) => {
    try {
      const filePath = path.join(workspace, DRAFTS_DIR_NAME, fileName);
      const content = await fs.readFile(filePath, 'utf-8');
      return { success: true, data: { content } };
    } catch (error) {
      mainError('workspaceBridge', 'Failed to read draft:', error);
      return { success: false, error: (error as Error).message, data: { content: '' } };
    }
  });

  /**
   * Delete a specific draft file
   * 删除指定的草稿文件
   */
  ipcBridge.drafts.deleteDraft.provider(async ({ workspace, fileName }) => {
    try {
      const filePath = path.join(workspace, DRAFTS_DIR_NAME, fileName);
      await fs.unlink(filePath);
      mainLog('workspaceBridge', `Draft deleted: ${filePath}`);
      return { success: true };
    } catch (error) {
      mainError('workspaceBridge', 'Failed to delete draft:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Clear all files in drafts directory
   * 清空草稿箱中的所有文件
   */
  ipcBridge.drafts.clearDrafts.provider(async ({ workspace }) => {
    const draftsDir = path.join(workspace, DRAFTS_DIR_NAME);

    try {
      await fs.access(draftsDir);
    } catch {
      return { success: true };
    }

    try {
      const entries = await fs.readdir(draftsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          await fs.unlink(path.join(draftsDir, entry.name));
        }
      }
      mainLog('workspaceBridge', `Drafts cleared for workspace: ${workspace}`);
      return { success: true };
    } catch (error) {
      mainError('workspaceBridge', 'Failed to clear drafts:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // ============================================================================
  // Workspace directory rename / 工作空间目录重命名
  // ============================================================================

  /**
   * Rename workspace directory physically and update all related conversations
   * 物理重命名工作空间目录并更新所有关联的对话
   */
  ipcBridge.workspaceManage.renameDirectory.provider(async ({ oldPath: workspacePath, newName }) => {
    // 1. Validate new name
    if (!isValidDirectoryName(newName)) {
      return { success: false, error: 'Invalid directory name', data: { newPath: '' } };
    }

    const parentDir = path.dirname(workspacePath);
    const newPath = path.join(parentDir, newName);

    // 2. Check if source exists
    if (!fsSync.existsSync(workspacePath)) {
      return { success: false, error: 'Source workspace does not exist', data: { newPath: '' } };
    }

    // 3. Check if target already exists
    if (fsSync.existsSync(newPath)) {
      return { success: false, error: 'Target directory already exists', data: { newPath: '' } };
    }

    try {
      // 4. Physical rename
      await fs.rename(workspacePath, newPath);
      mainLog('workspaceBridge', `Workspace renamed: ${workspacePath} -> ${newPath}`);

      // 5. Update database - batch update all related conversations
      try {
        const db = getDatabase();
        db.updateWorkspacePath(workspacePath, newPath);
        mainLog('workspaceBridge', `Database updated for workspace rename`);
      } catch (dbError) {
        // Database update failed - try to rollback the rename
        mainError('workspaceBridge', 'Database update failed, rolling back rename:', dbError);
        try {
          await fs.rename(newPath, workspacePath);
        } catch (rollbackError) {
          mainError('workspaceBridge', 'Rollback rename also failed:', rollbackError);
        }
        return { success: false, error: 'Failed to update database', data: { newPath: '' } };
      }

      return { success: true, data: { newPath } };
    } catch (error) {
      mainError('workspaceBridge', 'Failed to rename workspace:', error);
      return { success: false, error: (error as Error).message, data: { newPath: '' } };
    }
  });
}
