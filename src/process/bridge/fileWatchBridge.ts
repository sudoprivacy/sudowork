/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import { ipcBridge } from '@/common';

// 存储所有文件监听器 / Store all file watchers
const watchers = new Map<string, fs.FSWatcher>();

// 初始化文件监听桥接，负责 start/stop 所有 watcher / Initialize file watch bridge to manage start/stop of watchers
export function initFileWatchBridge(): void {
  // 开始监听文件 / Start watching file
  ipcBridge.fileWatch.startWatch.provider(({ filePath }) => {
    try {
      // 如果已经在监听，先停止 / Stop existing watcher if any
      if (watchers.has(filePath)) {
        watchers.get(filePath)?.close();
        watchers.delete(filePath);
      }

      // 创建文件监听器，并处理 rename 后 watcher 失效问题
      // On macOS/Linux, atomic writes (tmp → rename) invalidate the watched inode.
      // When 'rename' fires on a file watcher, we re-create the watcher after a short
      // delay so subsequent writes are still detected.
      const createWatcher = () => {
        const watcher = fs.watch(filePath, (eventType) => {
          ipcBridge.fileWatch.fileChanged.emit({ filePath, eventType });

          // 文件被原子替换后旧 inode 失效，延迟重建 watcher 以继续监听新 inode
          if (eventType === 'rename') {
            setTimeout(() => {
              if (!watchers.has(filePath)) return; // 已被 stopWatch 清理，不再重建
              try {
                watchers.get(filePath)?.close();
                watchers.set(filePath, createWatcher());
              } catch {
                // 文件暂时不存在（写入中），忽略，等待下次事件
                watchers.delete(filePath);
              }
            }, 100);
          }
        });

        watcher.on('error', () => {
          // watcher 出错（文件被删除等），静默清理
          watchers.delete(filePath);
        });

        return watcher;
      };

      watchers.set(filePath, createWatcher());

      return Promise.resolve({ success: true });
    } catch (error) {
      // 目标路径暂不存在（如 .tasks/ 尚未创建），静默返回，不打印错误
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return Promise.resolve({ success: false, msg: 'ENOENT' });
      }
      console.error('[FileWatch] Failed to start watching:', error);
      return Promise.resolve({ success: false, msg: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // 停止监听文件 / Stop watching file
  ipcBridge.fileWatch.stopWatch.provider(({ filePath }) => {
    try {
      if (watchers.has(filePath)) {
        watchers.get(filePath)?.close();
        watchers.delete(filePath);
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({ success: false, msg: 'No watcher found for this file' });
    } catch (error) {
      console.error('[FileWatch] Failed to stop watching:', error);
      return Promise.resolve({ success: false, msg: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // 停止所有监听 / Stop all watchers
  ipcBridge.fileWatch.stopAllWatches.provider(() => {
    try {
      watchers.forEach((watcher) => {
        watcher.close();
      });
      watchers.clear();
      return Promise.resolve({ success: true });
    } catch (error) {
      console.error('[FileWatch] Failed to stop all watches:', error);
      return Promise.resolve({ success: false, msg: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
}
