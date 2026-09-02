/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { ipcBridge } from '@/common';
import { mainError, mainWarn, mainLog } from '@process/utils/mainLogger';

// ─────────────────────────────────────────────────────────────────────────────
// Single-file watchers
// ─────────────────────────────────────────────────────────────────────────────
const watchers = new Map<string, fs.FSWatcher>();

// ─────────────────────────────────────────────────────────────────────────────
// Directory watchers (inotify-style, recursive when supported)
//
// - macOS / Windows: native `recursive: true` in fs.watch
// - Linux: recursion is not supported natively, so we walk the tree and attach
//   one watcher per directory.  New subdirectories are wired up on the fly.
// ─────────────────────────────────────────────────────────────────────────────
interface DirWatchEntry {
  watchId: string;
  dirPath: string;
  recursive: boolean;
  // Per-directory fs.FSWatcher instances keyed by absolute path
  subWatchers: Map<string, fs.FSWatcher>;
  // Ignore patterns for noisy paths (e.g. node_modules, .git)
  ignored: RegExp[];
  // Debounce timer so we don't spam the renderer with many events
  emitTimer: NodeJS.Timeout | null;
  pendingEvents: Array<{ eventType: string; changedPath: string }>;
}

const dirWatches = new Map<string, DirWatchEntry>();

const IS_RECURSIVE_SUPPORTED = process.platform === 'darwin' || process.platform === 'win32';

const DEFAULT_IGNORE_PATTERNS: RegExp[] = [/(^|[\\/])node_modules([\\/]|$)/, /(^|[\\/])\.git([\\/]|$)/, /(^|[\\/])\.DS_Store$/];

const DEBOUNCE_MS = 120;

function shouldIgnore(fullPath: string, ignored: RegExp[]): boolean {
  return ignored.some((re) => re.test(fullPath));
}

function flushPending(entry: DirWatchEntry) {
  if (!entry.pendingEvents.length) return;

  // Collapse to at most one emit per debounce window, passing the most recent
  // changed path so the renderer can log it for debugging.
  const last = entry.pendingEvents[entry.pendingEvents.length - 1];
  entry.pendingEvents = [];

  ipcBridge.fileWatch.dirChanged.emit({
    watchId: entry.watchId,
    dirPath: entry.dirPath,
    eventType: last.eventType,
    changedPath: last.changedPath,
  });
}

function scheduleEmit(entry: DirWatchEntry, eventType: string, changedPath: string) {
  entry.pendingEvents.push({ eventType, changedPath });
  if (entry.emitTimer) return;
  entry.emitTimer = setTimeout(() => {
    entry.emitTimer = null;
    flushPending(entry);
  }, DEBOUNCE_MS);
}

/**
 * Walk a directory tree and attach one watcher per directory.
 *
 * This is the Linux fallback for recursive watching. It skips ignored
 * directories (node_modules, .git, etc.) to keep the inotify watch count
 * reasonable on large projects.
 */
async function walkAndWatch(entry: DirWatchEntry, rootDir: string): Promise<void> {
  const stack: string[] = [rootDir];
  const MAX_WATCHERS_PER_ENTRY = 2048; // inotify soft cap to stay well below the system limit

  while (stack.length > 0) {
    const dir = stack.pop() as string;

    if (entry.subWatchers.size >= MAX_WATCHERS_PER_ENTRY) {
      mainWarn('FileWatch', `Directory watch hit the ${MAX_WATCHERS_PER_ENTRY} sub-watcher cap at ${entry.dirPath}; further subdirectories will be ignored.`);
      break;
    }

    if (shouldIgnore(dir, entry.ignored)) continue;
    if (entry.subWatchers.has(dir)) continue;

    try {
      attachDirWatcher(entry, dir);

      const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const dirent of dirents) {
        if (!dirent.isDirectory()) continue;
        const sub = path.join(dir, dirent.name);
        if (shouldIgnore(sub, entry.ignored)) continue;
        stack.push(sub);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'EACCES') {
        mainWarn('FileWatch', `Failed to walk directory ${dir}:`, error);
      }
    }
  }
}

function attachDirWatcher(entry: DirWatchEntry, dir: string): void {
  if (entry.subWatchers.has(dir)) return;

  try {
    const watcher = fs.watch(dir, { persistent: true }, (eventType, filename) => {
      const changedPath = filename ? path.join(dir, filename.toString()) : dir;
      if (shouldIgnore(changedPath, entry.ignored)) return;
      scheduleEmit(entry, eventType, changedPath);

      // A new directory may have appeared — attach a watcher for it too.
      // Linux fallback only: on macOS/Windows the root watcher is recursive.
      if (!IS_RECURSIVE_SUPPORTED && filename) {
        fs.promises
          .stat(changedPath)
          .then((stat) => {
            if (stat.isDirectory() && !entry.subWatchers.has(changedPath) && !shouldIgnore(changedPath, entry.ignored)) {
              void walkAndWatch(entry, changedPath);
            }
          })
          .catch(() => {
            /* path may have been deleted already; ignore */
          });
      }
    });

    watcher.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // Directory was removed — detach and forget.
        entry.subWatchers.get(dir)?.close();
        entry.subWatchers.delete(dir);
        return;
      }
      mainWarn('FileWatch', `Watcher error on ${dir}:`, err);
    });

    entry.subWatchers.set(dir, watcher);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOSPC') {
      mainError('FileWatch', `inotify watch count exhausted while attaching to ${dir}. Consider raising fs.inotify.max_user_watches or disabling recursive watching.`);
    } else if (code !== 'ENOENT') {
      mainWarn('FileWatch', `Failed to attach watcher to ${dir}:`, error);
    }
  }
}

function destroyDirWatch(entry: DirWatchEntry): void {
  if (entry.emitTimer) {
    clearTimeout(entry.emitTimer);
    entry.emitTimer = null;
  }
  for (const watcher of entry.subWatchers.values()) {
    try {
      watcher.close();
    } catch {
      /* noop */
    }
  }
  entry.subWatchers.clear();
}

// Initialize 文件监听桥接，负责 start/stop 所有 watcher / Initialize file watch bridge to manage start/stop of watchers
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
      const createWatcher = () => {
        const watcher = fs.watch(filePath, (eventType) => {
          ipcBridge.fileWatch.fileChanged.emit({ filePath, eventType });

          if (eventType === 'rename') {
            setTimeout(() => {
              if (!watchers.has(filePath)) return;
              try {
                watchers.get(filePath)?.close();
                watchers.set(filePath, createWatcher());
              } catch {
                watchers.delete(filePath);
              }
            }, 100);
          }
        });

        watcher.on('error', () => {
          watchers.delete(filePath);
        });

        return watcher;
      };

      watchers.set(filePath, createWatcher());

      return Promise.resolve({ success: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return Promise.resolve({ success: false, msg: 'ENOENT' });
      }
      mainError('FileWatch', 'Failed to start watching:', error);
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
      mainError('FileWatch', 'Failed to stop watching:', error);
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
      // Also tear down any remaining directory watches to free resources.
      for (const entry of dirWatches.values()) {
        destroyDirWatch(entry);
      }
      dirWatches.clear();
      return Promise.resolve({ success: true });
    } catch (error) {
      mainError('FileWatch', 'Failed to stop all watches:', error);
      return Promise.resolve({ success: false, msg: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // ── 目录监听 / Directory watching (inotify-style) ───────────────────────────
  ipcBridge.fileWatch.startWatchDir.provider(async ({ dirPath, recursive = true }) => {
    try {
      // Reject obviously invalid paths early.
      const abs = path.resolve(dirPath);
      if (!abs || abs === os.homedir() || abs === '/' || abs === path.parse(abs).root) {
        return { success: false, msg: 'Refusing to watch root or home directory' };
      }

      try {
        const stat = await fs.promises.stat(abs);
        if (!stat.isDirectory()) {
          return { success: false, msg: 'Not a directory' };
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return { success: false, msg: 'ENOENT' };
        }
        throw error;
      }

      const watchId = randomUUID();
      const entry: DirWatchEntry = {
        watchId,
        dirPath: abs,
        recursive,
        subWatchers: new Map(),
        ignored: DEFAULT_IGNORE_PATTERNS,
        emitTimer: null,
        pendingEvents: [],
      };

      if (recursive && IS_RECURSIVE_SUPPORTED) {
        // macOS / Windows: one native recursive watcher does the job.
        try {
          const watcher = fs.watch(abs, { recursive: true, persistent: true }, (eventType, filename) => {
            const changedPath = filename ? path.join(abs, filename.toString()) : abs;
            if (shouldIgnore(changedPath, entry.ignored)) return;
            scheduleEmit(entry, eventType, changedPath);
          });
          watcher.on('error', (err) => {
            mainWarn('FileWatch', `Recursive watcher error on ${abs}:`, err);
          });
          entry.subWatchers.set(abs, watcher);
        } catch (error) {
          mainWarn('FileWatch', `Native recursive watch unavailable for ${abs}, falling back to manual walk:`, error);
          await walkAndWatch(entry, abs);
        }
      } else if (recursive) {
        // Linux: walk the tree and attach a watcher per directory.
        await walkAndWatch(entry, abs);
      } else {
        attachDirWatcher(entry, abs);
      }

      dirWatches.set(watchId, entry);
      mainLog('FileWatch', `Started directory watch id=${watchId} dir=${abs} recursive=${recursive} subWatchers=${entry.subWatchers.size}`);

      return { success: true, data: { watchId } };
    } catch (error) {
      mainError('FileWatch', 'Failed to start directory watch:', error);
      return { success: false, msg: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcBridge.fileWatch.stopWatchDir.provider(({ watchId }) => {
    try {
      const entry = dirWatches.get(watchId);
      if (!entry) {
        return Promise.resolve({ success: false, msg: 'No watcher found for this id' });
      }
      destroyDirWatch(entry);
      dirWatches.delete(watchId);
      return Promise.resolve({ success: true });
    } catch (error) {
      mainError('FileWatch', 'Failed to stop directory watch:', error);
      return Promise.resolve({ success: false, msg: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
}
