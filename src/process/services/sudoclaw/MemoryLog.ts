/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MemoryLog — Append-only daily memory log (Kairos pattern)
 *
 * Dual storage:
 *   1. Markdown files at ~/.nexus/sudoclaw/memory/logs/YYYY/MM/YYYY-MM-DD.md (human-readable)
 *   2. SQLite `sudoclaw_memory_log` table (searchable)
 *
 * Design principles:
 *   - Append-only: never rewrite or reorganize logs
 *   - Date rollover: always uses current date for file path
 *   - Consolidation deferred to V2 (daily logs work fine for months without Dream)
 */

import * as fs from 'fs';
import * as path from 'path';
import { mainLog, mainError, mainWarn } from '@process/utils/mainLogger';
import { ensureDirectory } from '@process/utils';
import { getDatabase } from '@process/database/export';
import { SUDOCLAW_DIR } from './SudoclawInstallService';

/** Root directory for memory log markdown files */
export const MEMORY_LOGS_DIR = path.join(SUDOCLAW_DIR, 'memory', 'logs');

/**
 * Format a Date as YYYY-MM-DD string
 */
function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get the markdown file path for a given date.
 * Path structure: MEMORY_LOGS_DIR/YYYY/MM/YYYY-MM-DD.md
 */
function getLogFilePath(date: Date): string {
  const dateStr = formatDateString(date);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return path.join(MEMORY_LOGS_DIR, year, month, `${dateStr}.md`);
}

/**
 * Format an ISO timestamp for display in log bullets
 */
function formatTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

/**
 * Generate a unique ID for a memory log entry
 */
function generateMemoryId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Append a memory entry to both markdown file and SQLite.
 *
 * Writes a timestamped bullet to the day's markdown file and inserts
 * a row into the `sudoclaw_memory_log` table for search.
 *
 * @param entry - The memory text to record
 */
export function append(entry: string): void {
  const now = new Date();
  const dateStr = formatDateString(now);
  const timestamp = formatTimestamp(now);

  // 1. Write to markdown file
  const filePath = getLogFilePath(now);
  const dir = path.dirname(filePath);

  try {
    ensureDirectory(dir);

    const bullet = `- [${timestamp}] ${entry}\n`;

    if (!fs.existsSync(filePath)) {
      // Create file with header for a new day
      const header = `# Memory Log \u2014 ${dateStr}\n\n`;
      fs.writeFileSync(filePath, header + bullet, 'utf-8');
    } else {
      fs.appendFileSync(filePath, bullet, 'utf-8');
    }
  } catch (error) {
    mainError('MemoryLog', `Failed to write markdown log for ${dateStr}:`, error);
    // Continue to try SQLite even if file write fails
  }

  // 2. Insert into SQLite
  try {
    const db = getDatabase();
    const result = db.insertMemoryLog({
      id: generateMemoryId(),
      log_date: dateStr,
      content: entry,
      created_at: Date.now(),
    });

    if (!result.success) {
      mainWarn('MemoryLog', `SQLite insert failed: ${result.error}`);
    }
  } catch (error) {
    mainError('MemoryLog', 'Failed to insert into SQLite:', error);
  }

  mainLog('MemoryLog', `Appended entry for ${dateStr}`);
}

/**
 * Load recent daily logs from markdown files.
 *
 * Reads the last `days` days of log files and returns their content
 * concatenated. Most recent day first.
 *
 * @param days - Number of days to look back (default: 3)
 * @returns Combined markdown content, or empty string if no logs exist
 */
export function getRecentLogs(days = 3): string {
  const logs: string[] = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const filePath = getLogFilePath(date);

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (content) {
          logs.push(content);
        }
      }
    } catch (error) {
      mainWarn('MemoryLog', `Failed to read log file ${filePath}:`, error);
    }
  }

  return logs.join('\n\n');
}

/**
 * Get the file path for today's log (for external inspection/testing)
 */
export function getTodayLogPath(): string {
  return getLogFilePath(new Date());
}
