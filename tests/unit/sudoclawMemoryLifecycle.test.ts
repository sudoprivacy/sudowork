/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('SudoclawMemoryLifecycle', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();

    vi.doMock('@process/utils/mainLogger', () => ({
      mainLog: vi.fn(),
      mainWarn: vi.fn(),
      mainError: vi.fn(),
    }));

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudoclaw-memory-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates archive directory if it does not exist', async () => {
    const { SudoclawMemoryLifecycle } = await import('@/process/services/sudoclaw/SudoclawMemoryLifecycle');
    const lifecycle = new SudoclawMemoryLifecycle({ logsDir: tempDir });

    await lifecycle.runLifecycle();

    expect(fs.existsSync(path.join(tempDir, 'archive'))).toBe(true);

    lifecycle.destroy();
  });

  it('archives files older than threshold', async () => {
    const { SudoclawMemoryLifecycle } = await import('@/process/services/sudoclaw/SudoclawMemoryLifecycle');
    const lifecycle = new SudoclawMemoryLifecycle({
      logsDir: tempDir,
      archiveAfterMonths: 0, // Archive everything for testing
    });

    // Create a test log file
    const logFile = path.join(tempDir, 'test.log');
    fs.writeFileSync(logFile, 'test log content');

    // Make it appear old by setting mtime to 1 month ago
    const oldDate = new Date();
    oldDate.setMonth(oldDate.getMonth() - 1);
    fs.utimesSync(logFile, oldDate, oldDate);

    const result = await lifecycle.runLifecycle();

    expect(result.archivedCount).toBe(1);
    expect(result.bytesFreed).toBeGreaterThan(0);
    expect(fs.existsSync(logFile)).toBe(false);
    // File should be in archive directory (compressed)
    const archiveDir = path.join(tempDir, 'archive');
    const archiveFiles = fs.readdirSync(archiveDir);
    expect(archiveFiles.length).toBeGreaterThan(0);

    lifecycle.destroy();
  });

  it('does not archive recent files', async () => {
    const { SudoclawMemoryLifecycle } = await import('@/process/services/sudoclaw/SudoclawMemoryLifecycle');
    const lifecycle = new SudoclawMemoryLifecycle({
      logsDir: tempDir,
      archiveAfterMonths: 3,
    });

    // Create a recent file
    const logFile = path.join(tempDir, 'recent.log');
    fs.writeFileSync(logFile, 'recent log content');

    const result = await lifecycle.runLifecycle();

    expect(result.archivedCount).toBe(0);
    expect(fs.existsSync(logFile)).toBe(true);

    lifecycle.destroy();
  });

  it('only processes log file extensions', async () => {
    const { SudoclawMemoryLifecycle } = await import('@/process/services/sudoclaw/SudoclawMemoryLifecycle');
    const lifecycle = new SudoclawMemoryLifecycle({
      logsDir: tempDir,
      archiveAfterMonths: 0,
    });

    // Create files with different extensions
    const logFile = path.join(tempDir, 'test.log');
    const jsonFile = path.join(tempDir, 'test.json');
    const imgFile = path.join(tempDir, 'test.png');

    fs.writeFileSync(logFile, 'log');
    fs.writeFileSync(jsonFile, '{}');
    fs.writeFileSync(imgFile, 'image');

    // Make all old
    const oldDate = new Date();
    oldDate.setMonth(oldDate.getMonth() - 1);
    fs.utimesSync(logFile, oldDate, oldDate);
    fs.utimesSync(jsonFile, oldDate, oldDate);
    fs.utimesSync(imgFile, oldDate, oldDate);

    const result = await lifecycle.runLifecycle();

    // .log and .json should be archived, .png should not
    expect(result.archivedCount).toBe(2);
    expect(fs.existsSync(imgFile)).toBe(true);

    lifecycle.destroy();
  });

  it('reports correct statistics', async () => {
    const { SudoclawMemoryLifecycle } = await import('@/process/services/sudoclaw/SudoclawMemoryLifecycle');
    const lifecycle = new SudoclawMemoryLifecycle({ logsDir: tempDir });

    // Create some active files
    fs.writeFileSync(path.join(tempDir, 'active1.log'), 'hello');
    fs.writeFileSync(path.join(tempDir, 'active2.log'), 'world');

    // Ensure archive dir
    fs.mkdirSync(path.join(tempDir, 'archive'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'archive', 'old.log.gz'), 'archived');

    const stats = lifecycle.getStats();

    expect(stats.activeFileCount).toBe(2);
    expect(stats.activeSizeBytes).toBeGreaterThan(0);
    expect(stats.archivedFileCount).toBe(1);
    expect(stats.archivedSizeBytes).toBeGreaterThan(0);

    lifecycle.destroy();
  });

  it('handles missing directories gracefully', async () => {
    const { SudoclawMemoryLifecycle } = await import('@/process/services/sudoclaw/SudoclawMemoryLifecycle');
    const nonExistent = path.join(tempDir, 'does-not-exist', 'logs');
    const lifecycle = new SudoclawMemoryLifecycle({ logsDir: nonExistent });

    // Should not throw
    const result = await lifecycle.runLifecycle();
    expect(result.archivedCount).toBe(0);

    lifecycle.destroy();
  });

  it('singleton functions work correctly', async () => {
    const { initMemoryLifecycle, getMemoryLifecycleInstance, destroyMemoryLifecycle } = await import('@/process/services/sudoclaw/SudoclawMemoryLifecycle');

    expect(getMemoryLifecycleInstance()).toBeNull();

    const instance = initMemoryLifecycle(tempDir);
    expect(getMemoryLifecycleInstance()).toBe(instance);

    destroyMemoryLifecycle();
    expect(getMemoryLifecycleInstance()).toBeNull();
  });
});
