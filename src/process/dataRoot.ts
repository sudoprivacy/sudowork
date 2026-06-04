/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import { getCachedAppMode } from '@/common/enterpriseDebugConfig';

export type AppMode = 'c' | 'e';

const CONSUMER_DATA_ROOT = '.nexus';
const ENTERPRISE_DATA_ROOT = '.nexus_ent';
const DATA_ROOT_MODE_FILE = 'sudowork-data-root-mode.json';
const DATA_ROOT_MARKER_FILE = '.sudowork-data-root';
const KNOWN_DATA_ROOT_ENTRIES = new Set([DATA_ROOT_MARKER_FILE, '.DS_Store', '.sudowork-env', 'assistants', 'bin', 'config', 'config.yaml', 'downloads', 'electron-path', 'extension-states.json', 'extensions', 'logs', 'mcporter', 'nexus_data', 'nexus_record_store.db', 'nexus_record_store.db-shm', 'nexus_record_store.db-wal', 'nexusd.pid', 'nexusd.ready', 'node', 'skills', 'sudoclaw', 'sudocode', 'sudowork-chat-message.txt', 'sudowork-chat-history', 'sudowork-chat.txt', 'sudowork-config.txt', 'sudowork.db', 'sudowork.db-shm', 'sudowork.db-wal']);

export const getDataRootModeFilePath = (): string => {
  return path.join(app.getPath('userData'), DATA_ROOT_MODE_FILE);
};

export const readPersistedDataRootMode = (): AppMode | null => {
  try {
    const raw = readFileSync(getDataRootModeFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as { mode?: unknown };
    return parsed.mode === 'c' || parsed.mode === 'e' ? parsed.mode : null;
  } catch {
    return null;
  }
};

export const persistDataRootMode = (mode: AppMode): void => {
  const markerPath = getDataRootModeFilePath();
  mkdirSync(path.dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, JSON.stringify({ mode, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
};

export const getCurrentDataRootMode = (): AppMode => {
  return getCachedAppMode() ?? readPersistedDataRootMode() ?? 'c';
};

const getDataRootName = (mode: AppMode): string => {
  return mode === 'e' ? ENTERPRISE_DATA_ROOT : CONSUMER_DATA_ROOT;
};

/**
 * Ensure CLI-safe symlink exists and return the symlink path.
 * On macOS, creates a symlink in home directory to avoid spaces in paths.
 */
const ensureCliSafeSymlink = (targetPath: string, symlinkName: string): string => {
  if (process.platform !== 'darwin') {
    return targetPath;
  }

  const symlinkPath = path.join(app.getPath('home'), symlinkName);

  try {
    const stats = lstatSync(symlinkPath);
    if (stats.isSymbolicLink()) {
      const target = readlinkSync(symlinkPath);
      if (target === targetPath) {
        if (!existsSync(targetPath)) {
          mkdirSync(targetPath, { recursive: true });
        }
        return symlinkPath;
      }
      unlinkSync(symlinkPath);
    } else if (stats.isDirectory()) {
      return targetPath;
    } else {
      unlinkSync(symlinkPath);
    }
  } catch {
    // Symlink does not exist yet.
  }

  try {
    if (!existsSync(targetPath)) {
      mkdirSync(targetPath, { recursive: true });
    }
    symlinkSync(targetPath, symlinkPath);
    return symlinkPath;
  } catch {
    return targetPath;
  }
};

export const getDataPathForMode = (mode: AppMode): string => {
  const dir = getDataRootName(mode);
  const dataPath = path.join(app.getPath('home'), dir);
  return ensureCliSafeSymlink(dataPath, dir);
};

export const getDataPathForCurrentMode = (): string => {
  return getDataPathForMode(getCurrentDataRootMode());
};

export const ensureDataRootInitialized = (mode: AppMode): void => {
  const dataPath = getDataPathForMode(mode);
  const markerPath = path.join(dataPath, DATA_ROOT_MARKER_FILE);

  if (existsSync(markerPath)) {
    try {
      const parsed = JSON.parse(readFileSync(markerPath, 'utf-8')) as { mode?: unknown };
      if (parsed.mode === mode) {
        return;
      }
    } catch {
      // Rewrite invalid markers below.
    }
  } else if (mode === 'e') {
    const unknownEntries = readdirSync(dataPath).filter((entry) => !KNOWN_DATA_ROOT_ENTRIES.has(entry));
    if (unknownEntries.length > 0) {
      throw new Error(`Enterprise data root already exists but is not a Sudowork data root: ${dataPath}`);
    }
  }

  writeFileSync(markerPath, JSON.stringify({ mode, createdAt: new Date().toISOString() }, null, 2), 'utf-8');
};
