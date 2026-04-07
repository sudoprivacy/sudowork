/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Workspace management bridge - handles workspace directory rename and drafts operations
 * 工作空间管理桥接 - 处理工作空间目录重命名和草稿箱操作
 */

import { DRAFTS_DIR_NAME } from '@/common/constants';
import { ipcBridge } from '@/common';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getDatabase } from '@process/database';
import WorkerManage from '@process/WorkerManage';
import { mainError, mainLog } from '@process/utils/mainLogger';

/**
 * Validate directory name for cross-platform compatibility
 * 验证目录名在跨平台环境下的合法性
 */
function isValidDirectoryName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  if (name.length > 255) return false;
  if (name === '.' || name === '..') return false;
  // Reserved names on Windows
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name)) return false;
  // Invalid characters (cross-platform safe)
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) return false;
  return true;
}

export function initWorkspaceBridge(): void {
  // Rename workspace physical directory and update all associated conversations
  // 重命名工作空间物理目录并更新所有关联对话
  ipcBridge.workspaceManage.renameDirectory.provider(async ({ conversationId, oldPath, newName }) => {
    try {
      // 1. Validate new name
      if (!isValidDirectoryName(newName)) {
        return { success: false, msg: 'Invalid directory name' };
      }

      const parentDir = path.dirname(oldPath);
      const newPath = path.join(parentDir, newName);

      // 2. Check if target already exists
      if (fsSync.existsSync(newPath)) {
        return { success: false, msg: 'Target directory already exists' };
      }

      // 3. Check source exists
      if (!fsSync.existsSync(oldPath)) {
        return { success: false, msg: 'Source directory not found' };
      }

      // 4. Physically rename the directory
      await fs.rename(oldPath, newPath);
      mainLog('workspaceBridge', `Renamed workspace: ${oldPath} -> ${newPath}`);

      // 5. Update the conversation's extra.workspace in database
      // Note: We do NOT update conversation.name - the conversation title stays the same
      // 注意：不更新 conversation.name —— 会话标题保持不变
      const db = getDatabase();
      const existing = db.getConversation(conversationId);
      if (existing.success && existing.data) {
        const updatedExtra = {
          ...existing.data.extra,
          workspace: newPath,
        };
        db.updateConversation(conversationId, {
          extra: updatedExtra,
        } as any);
      }

      // 6. Kill running agent so it rebuilds with new workspace path on next message
      // Kill 运行中的 Agent，下次发送消息时会使用新路径重建
      try {
        WorkerManage.kill(conversationId);
      } catch {
        // ignore - agent may not be running
      }

      // 7. Ensure .drafts directory exists in new location
      const draftsDir = path.join(newPath, DRAFTS_DIR_NAME);
      await fs.mkdir(draftsDir, { recursive: true });

      return { success: true, data: { newPath } };
    } catch (error) {
      mainError('workspaceBridge', 'Failed to rename workspace directory:', error);
      // Attempt rollback is not needed since fs.rename is atomic on same filesystem
      return { success: false, msg: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // List files in the .drafts directory
  // 列出草稿箱目录中的文件
  ipcBridge.workspaceManage.listDrafts.provider(async ({ workspace }) => {
    try {
      const draftsDir = path.join(workspace, DRAFTS_DIR_NAME);
      if (!fsSync.existsSync(draftsDir)) {
        return [];
      }
      const entries = await fs.readdir(draftsDir, { withFileTypes: true });
      const files = [];
      for (const entry of entries) {
        if (entry.isFile()) {
          const stat = await fs.stat(path.join(draftsDir, entry.name));
          files.push({
            name: entry.name,
            size: stat.size,
            modifiedAt: stat.mtimeMs,
          });
        }
      }
      return files;
    } catch (error) {
      mainError('workspaceBridge', 'Failed to list drafts:', error);
      return [];
    }
  });

  // Delete a specific draft file
  // 删除指定草稿文件
  ipcBridge.workspaceManage.deleteDraft.provider(async ({ workspace, fileName }) => {
    try {
      const filePath = path.join(workspace, DRAFTS_DIR_NAME, fileName);
      await fs.unlink(filePath);
      return { success: true };
    } catch (error) {
      mainError('workspaceBridge', 'Failed to delete draft:', error);
      return { success: false, msg: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Clear all files in the .drafts directory
  // 清空草稿箱
  ipcBridge.workspaceManage.clearDrafts.provider(async ({ workspace }) => {
    try {
      const draftsDir = path.join(workspace, DRAFTS_DIR_NAME);
      if (!fsSync.existsSync(draftsDir)) {
        return { success: true };
      }
      const entries = await fs.readdir(draftsDir);
      for (const entry of entries) {
        await fs.unlink(path.join(draftsDir, entry));
      }
      return { success: true };
    } catch (error) {
      mainError('workspaceBridge', 'Failed to clear drafts:', error);
      return { success: false, msg: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
