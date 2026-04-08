/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SudoClaw Memory Log Lifecycle Manager
 *
 * Manages the lifecycle of memory logs (conversation history, agent traces):
 * - Auto-archive months older than 3 months
 * - Enforce size limits on active logs
 * - Compress archived logs to save disk space
 * - Provide cleanup utilities
 */

import * as fs from 'fs';
import * as path from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';

// ========== Constants ==========

/** Default archive threshold (months) */
const DEFAULT_ARCHIVE_AFTER_MONTHS = 3;

/** Maximum size of active log directory before warning (bytes) — 500 MB */
const DEFAULT_MAX_ACTIVE_SIZE_BYTES = 500 * 1024 * 1024;

/** Maximum size of a single log file before rotation (bytes) — 50 MB */
const DEFAULT_MAX_LOG_FILE_BYTES = 50 * 1024 * 1024;

/** Archive subdirectory name */
const ARCHIVE_DIR_NAME = 'archive';

/** Log file extension */
const LOG_EXTENSIONS = ['.log', '.json', '.jsonl', '.txt'];

// ========== Types ==========

export interface MemoryLifecycleConfig {
  /** Directory containing memory logs */
  logsDir: string;
  /** Months after which logs are auto-archived (default: 3) */
  archiveAfterMonths?: number;
  /** Maximum size of active logs directory in bytes (default: 500 MB) */
  maxActiveSizeBytes?: number;
  /** Maximum size of a single log file in bytes (default: 50 MB) */
  maxLogFileBytes?: number;
}

export interface LifecycleStats {
  /** Number of active log files */
  activeFileCount: number;
  /** Total size of active logs (bytes) */
  activeSizeBytes: number;
  /** Number of archived log files */
  archivedFileCount: number;
  /** Total size of archived logs (bytes) */
  archivedSizeBytes: number;
  /** Number of files archived in last run */
  lastArchiveCount: number;
  /** Timestamp of last lifecycle run */
  lastRunAt: string | null;
}

export interface ArchiveResult {
  /** Number of files archived */
  archivedCount: number;
  /** Number of files that failed to archive */
  failedCount: number;
  /** Total bytes freed from active directory */
  bytesFreed: number;
  /** Error messages for failed files */
  errors: string[];
}

// ========== Implementation ==========

export class SudoclawMemoryLifecycle {
  private config: Required<MemoryLifecycleConfig>;
  private lastRunAt: string | null = null;
  private lastArchiveCount = 0;
  private archiveTimer: NodeJS.Timeout | null = null;

  constructor(config: MemoryLifecycleConfig) {
    this.config = {
      logsDir: config.logsDir,
      archiveAfterMonths: config.archiveAfterMonths ?? DEFAULT_ARCHIVE_AFTER_MONTHS,
      maxActiveSizeBytes: config.maxActiveSizeBytes ?? DEFAULT_MAX_ACTIVE_SIZE_BYTES,
      maxLogFileBytes: config.maxLogFileBytes ?? DEFAULT_MAX_LOG_FILE_BYTES,
    };
  }

  // ========== Public API ==========

  /**
   * Run the full lifecycle process:
   * 1. Archive old files
   * 2. Compress archived files
   * 3. Check size limits
   */
  async runLifecycle(): Promise<ArchiveResult> {
    mainLog('MemoryLifecycle', `Running lifecycle for ${this.config.logsDir}`);

    const result: ArchiveResult = {
      archivedCount: 0,
      failedCount: 0,
      bytesFreed: 0,
      errors: [],
    };

    try {
      // Ensure directories exist
      this.ensureDirectories();

      // Step 1: Archive old files
      const archiveResult = await this.archiveOldFiles();
      result.archivedCount = archiveResult.archivedCount;
      result.failedCount = archiveResult.failedCount;
      result.bytesFreed = archiveResult.bytesFreed;
      result.errors = archiveResult.errors;

      // Step 2: Compress uncompressed archives
      await this.compressArchives();

      // Step 3: Check and warn about size limits
      this.checkSizeLimits();

      this.lastRunAt = new Date().toISOString();
      this.lastArchiveCount = result.archivedCount;

      mainLog('MemoryLifecycle', `Lifecycle complete: archived=${result.archivedCount}, freed=${formatBytes(result.bytesFreed)}`);
    } catch (err) {
      mainError('MemoryLifecycle', 'Lifecycle run failed', err);
      result.errors.push(err instanceof Error ? err.message : String(err));
    }

    return result;
  }

  /**
   * Schedule automatic lifecycle runs (daily).
   */
  startAutoArchive(intervalMs: number = 24 * 60 * 60 * 1000): void {
    if (this.archiveTimer) return;

    mainLog('MemoryLifecycle', `Auto-archive scheduled every ${Math.round(intervalMs / 3_600_000)}h`);

    // Run immediately, then on interval
    void this.runLifecycle();

    this.archiveTimer = setInterval(() => {
      void this.runLifecycle();
    }, intervalMs);

    if (typeof this.archiveTimer === 'object' && 'unref' in this.archiveTimer) {
      this.archiveTimer.unref();
    }
  }

  /**
   * Stop automatic lifecycle runs.
   */
  stopAutoArchive(): void {
    if (this.archiveTimer) {
      clearInterval(this.archiveTimer);
      this.archiveTimer = null;
      mainLog('MemoryLifecycle', 'Auto-archive stopped');
    }
  }

  /**
   * Get current lifecycle statistics.
   */
  getStats(): LifecycleStats {
    const activeStats = this.getDirectoryStats(this.config.logsDir, false);
    const archiveDir = path.join(this.config.logsDir, ARCHIVE_DIR_NAME);
    const archivedStats = fs.existsSync(archiveDir) ? this.getDirectoryStats(archiveDir, true) : { fileCount: 0, totalBytes: 0 };

    return {
      activeFileCount: activeStats.fileCount,
      activeSizeBytes: activeStats.totalBytes,
      archivedFileCount: archivedStats.fileCount,
      archivedSizeBytes: archivedStats.totalBytes,
      lastArchiveCount: this.lastArchiveCount,
      lastRunAt: this.lastRunAt,
    };
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.stopAutoArchive();
  }

  // ========== Private Methods ==========

  private ensureDirectories(): void {
    fs.mkdirSync(this.config.logsDir, { recursive: true });
    fs.mkdirSync(path.join(this.config.logsDir, ARCHIVE_DIR_NAME), { recursive: true });
  }

  private async archiveOldFiles(): Promise<ArchiveResult> {
    const result: ArchiveResult = {
      archivedCount: 0,
      failedCount: 0,
      bytesFreed: 0,
      errors: [],
    };

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - this.config.archiveAfterMonths);

    const archiveDir = path.join(this.config.logsDir, ARCHIVE_DIR_NAME);

    let files: string[];
    try {
      files = fs.readdirSync(this.config.logsDir);
    } catch {
      return result;
    }

    for (const file of files) {
      // Skip the archive directory itself
      if (file === ARCHIVE_DIR_NAME) continue;

      const filePath = path.join(this.config.logsDir, file);

      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;

        // Check if file extension is a log type
        const ext = path.extname(file).toLowerCase();
        if (!LOG_EXTENSIONS.includes(ext) && ext !== '.gz') continue;

        // Archive if modification time is older than cutoff
        if (stat.mtime < cutoffDate) {
          const destPath = path.join(archiveDir, file);

          // Move file to archive
          fs.renameSync(filePath, destPath);
          result.archivedCount++;
          result.bytesFreed += stat.size;

          mainLog('MemoryLifecycle', `Archived: ${file} (${formatBytes(stat.size)}, modified ${stat.mtime.toISOString()})`);
        }
      } catch (err) {
        result.failedCount++;
        const errMsg = `Failed to archive ${file}: ${err instanceof Error ? err.message : String(err)}`;
        result.errors.push(errMsg);
        mainWarn('MemoryLifecycle', errMsg);
      }
    }

    return result;
  }

  private async compressArchives(): Promise<void> {
    const archiveDir = path.join(this.config.logsDir, ARCHIVE_DIR_NAME);
    if (!fs.existsSync(archiveDir)) return;

    let files: string[];
    try {
      files = fs.readdirSync(archiveDir);
    } catch {
      return;
    }

    for (const file of files) {
      // Skip already compressed files
      if (file.endsWith('.gz')) continue;

      const ext = path.extname(file).toLowerCase();
      if (!LOG_EXTENSIONS.includes(ext)) continue;

      const filePath = path.join(archiveDir, file);
      const gzPath = filePath + '.gz';

      // Skip if compressed version already exists
      if (fs.existsSync(gzPath)) continue;

      try {
        await pipeline(
          createReadStream(filePath),
          createGzip(),
          createWriteStream(gzPath),
        );

        // Remove the original after successful compression
        fs.unlinkSync(filePath);
        mainLog('MemoryLifecycle', `Compressed: ${file}`);
      } catch (err) {
        mainWarn('MemoryLifecycle', `Failed to compress ${file}: ${err instanceof Error ? err.message : String(err)}`);
        // Clean up partial gz file
        try {
          if (fs.existsSync(gzPath)) fs.unlinkSync(gzPath);
        } catch {
          // ignore
        }
      }
    }
  }

  private checkSizeLimits(): void {
    const stats = this.getDirectoryStats(this.config.logsDir, false);

    if (stats.totalBytes > this.config.maxActiveSizeBytes) {
      mainWarn('MemoryLifecycle', `Active logs exceed size limit: ${formatBytes(stats.totalBytes)} > ${formatBytes(this.config.maxActiveSizeBytes)}`);
    }

    // Check individual large files
    try {
      const files = fs.readdirSync(this.config.logsDir);
      for (const file of files) {
        if (file === ARCHIVE_DIR_NAME) continue;
        const filePath = path.join(this.config.logsDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile() && stat.size > this.config.maxLogFileBytes) {
            mainWarn('MemoryLifecycle', `Large log file: ${file} (${formatBytes(stat.size)} > ${formatBytes(this.config.maxLogFileBytes)})`);
          }
        } catch {
          // ignore individual file errors
        }
      }
    } catch {
      // ignore directory read errors
    }
  }

  private getDirectoryStats(dir: string, recursive: boolean): { fileCount: number; totalBytes: number } {
    let fileCount = 0;
    let totalBytes = 0;

    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (!recursive && entry === ARCHIVE_DIR_NAME) continue;
        const entryPath = path.join(dir, entry);
        try {
          const stat = fs.statSync(entryPath);
          if (stat.isFile()) {
            fileCount++;
            totalBytes += stat.size;
          } else if (recursive && stat.isDirectory()) {
            const subStats = this.getDirectoryStats(entryPath, true);
            fileCount += subStats.fileCount;
            totalBytes += subStats.totalBytes;
          }
        } catch {
          // skip inaccessible entries
        }
      }
    } catch {
      // directory might not exist
    }

    return { fileCount, totalBytes };
  }
}

// ========== Singleton ==========

let instance: SudoclawMemoryLifecycle | null = null;

/**
 * Initialize the memory lifecycle singleton with a logs directory.
 */
export function initMemoryLifecycle(logsDir: string): SudoclawMemoryLifecycle {
  if (instance) {
    instance.destroy();
  }
  instance = new SudoclawMemoryLifecycle({ logsDir });
  return instance;
}

/**
 * Get the singleton instance (null if not initialized).
 */
export function getMemoryLifecycleInstance(): SudoclawMemoryLifecycle | null {
  return instance;
}

/**
 * Destroy the singleton instance.
 */
export function destroyMemoryLifecycle(): void {
  instance?.destroy();
  instance = null;
}

// ========== Utility ==========

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}
