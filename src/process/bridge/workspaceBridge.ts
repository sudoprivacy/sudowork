/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Workspace management bridge - handles workspace rename and drafts operations
 * 工作空间管理桥接 - 处理工作空间重命名和草稿箱操作
 */

import { DRAFTS_DIR_NAME, isReservedDraftsDirName } from '@/common/constants';
import { ipcBridge } from '@/common';
import { isValidDirectoryName } from '@/common/utils/pathValidation';
import { getDatabase } from '@process/database';
import WorkerManage from '@process/WorkerManage';
import { mainLog, mainError } from '@process/utils/mainLogger';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

export function initWorkspaceBridge(): void {
  /**
   * Rename workspace directory (physical rename + database update)
   * 重命名工作空间目录（物理重命名 + 数据库更新）
   *
   * This does NOT kill the agent. The frontend should stop the agent first if needed,
   * or handle the workspace path change gracefully.
   * 这不会 kill agent。如果需要，前端应该先停止 agent，或者优雅地处理 workspace 路径变更。
   */
  ipcBridge.workspaceManage.renameDirectory.provider(async ({ oldPath, newName }) => {
    try {
      // 1. Validate new name
      if (!isValidDirectoryName(newName) || isReservedDraftsDirName(newName)) {
        return { success: false, error: 'Invalid directory name' };
      }

      const parentDir = path.dirname(oldPath);
      const newPath = path.join(parentDir, newName);

      // 2. Check target path doesn't exist
      if (fsSync.existsSync(newPath)) {
        return { success: false, error: 'Target directory already exists' };
      }

      // 3. Check source path exists
      if (!fsSync.existsSync(oldPath)) {
        return { success: false, error: 'Source directory not found' };
      }

      // 4. Physical rename
      await fs.rename(oldPath, newPath);
      mainLog('workspaceBridge', `Renamed workspace: ${oldPath} -> ${newPath}`);

      // 5. Update database - find all conversations with this workspace path and update them
      const db = getDatabase();
      const updateResult = db.updateWorkspacePath(oldPath, newPath);
      if (!updateResult.success) {
        // Attempt rollback
        try {
          await fs.rename(newPath, oldPath);
        } catch (rollbackErr) {
          mainError('workspaceBridge', 'Failed to rollback rename:', rollbackErr);
        }
        return { success: false, error: updateResult.error || 'Database update failed' };
      }

      mainLog('workspaceBridge', `Updated ${updateResult.data} conversations in database`);

      // 6. Sync running agents' cached workspace path
      const agentUpdated = WorkerManage.updateActiveAgentWorkspace(oldPath, newPath);
      if (agentUpdated > 0) {
        mainLog('workspaceBridge', `Synced workspace path for ${agentUpdated} active agent(s)`);
      }

      return { success: true, data: { newPath } };
    } catch (error) {
      mainError('workspaceBridge', 'Failed to rename workspace:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Update workspace display name (no physical rename, only DB update)
   * 更新工作空间显示名（不改物理路径，只更新数据库）
   */
  ipcBridge.workspaceManage.updateDisplayName.provider(async ({ workspace, displayName }) => {
    try {
      const trimmed = displayName.trim();
      if (!trimmed) {
        return { success: false, error: 'Display name cannot be empty' };
      }

      const db = getDatabase();
      const result = db.updateWorkspaceDisplayName(workspace, trimmed);
      if (!result.success) {
        return { success: false, error: result.error || 'Database update failed' };
      }

      mainLog('workspaceBridge', `Updated display name for workspace ${workspace} -> "${trimmed}" (${result.data} conversations)`);
      return { success: true };
    } catch (error) {
      mainError('workspaceBridge', 'Failed to update workspace display name:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * List drafts files in workspace
   * 列出工作空间草稿箱中的文件
   */
  ipcBridge.workspaceManage.listDrafts.provider(async ({ workspace }) => {
    try {
      const draftsDir = path.join(workspace, DRAFTS_DIR_NAME);

      if (!fsSync.existsSync(draftsDir)) {
        return { success: true, data: [] };
      }

      const entries = await fs.readdir(draftsDir, { withFileTypes: true });
      const files = await Promise.all(
        entries
          .filter((e) => e.isFile())
          .map(async (e) => {
            const filePath = path.join(draftsDir, e.name);
            const stat = await fs.stat(filePath);
            return {
              name: e.name,
              size: stat.size,
              modifiedAt: stat.mtimeMs,
            };
          })
      );

      // 按文件名正序排列 / Sort by filename in ascending order
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

      return { success: true, data: files };
    } catch (error) {
      mainError('workspaceBridge', 'Failed to list drafts:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Clear all drafts files
   * 清空草稿箱
   */
  ipcBridge.workspaceManage.clearDrafts.provider(async ({ workspace }) => {
    try {
      const draftsDir = path.join(workspace, DRAFTS_DIR_NAME);

      if (!fsSync.existsSync(draftsDir)) {
        return { success: true };
      }

      const entries = await fs.readdir(draftsDir, { withFileTypes: true });
      await Promise.all(
        entries.map((e) => {
          const filePath = path.join(draftsDir, e.name);
          return fs.rm(filePath, { recursive: true, force: true });
        })
      );

      mainLog('workspaceBridge', `Cleared drafts in ${workspace}`);
      return { success: true };
    } catch (error) {
      mainError('workspaceBridge', 'Failed to clear drafts:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Delete a specific draft file
   * 删除指定草稿文件
   */
  ipcBridge.workspaceManage.deleteDraft.provider(async ({ workspace, fileName }) => {
    try {
      const draftsDir = path.join(workspace, DRAFTS_DIR_NAME);
      const filePath = path.join(draftsDir, fileName);

      // Security: ensure the file is within the drafts directory
      const resolvedPath = path.resolve(filePath);
      const resolvedDraftsDir = path.resolve(draftsDir);
      if (!resolvedPath.startsWith(resolvedDraftsDir)) {
        return { success: false, error: 'Invalid file path' };
      }

      await fs.rm(filePath, { force: true });
      return { success: true };
    } catch (error) {
      mainError('workspaceBridge', 'Failed to delete draft:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
