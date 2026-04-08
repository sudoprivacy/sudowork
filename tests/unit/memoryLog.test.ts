/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

// Mock dependencies before importing the module under test
vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainError: vi.fn(),
  mainWarn: vi.fn(),
}));

vi.mock('@process/utils', () => ({
  ensureDirectory: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-home'),
  },
}));

describe('MemoryLog', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T14:30:00.000Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('append', () => {
    it('creates a new markdown file with header when none exists', async () => {
      const mockWriteFileSync = vi.fn();
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => false),
        writeFileSync: mockWriteFileSync,
        appendFileSync: vi.fn(),
        readFileSync: vi.fn(() => ''),
      }));

      const mockInsert = vi.fn(() => ({ success: true }));
      vi.doMock('@process/database/export', () => ({
        getDatabase: vi.fn(() => ({ insertMemoryLog: mockInsert })),
      }));

      const { append } = await import('@/process/services/sudoclaw/MemoryLog');
      append('Test memory entry');

      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      const [filePath, content] = mockWriteFileSync.mock.calls[0] as [string, string, string];
      expect(filePath).toContain('2026-04-08.md');
      expect(filePath).toContain(path.join('2026', '04'));
      expect(content).toContain('# Memory Log');
      expect(content).toContain('2026-04-08');
      expect(content).toContain('Test memory entry');
    });

    it('appends to existing markdown file', async () => {
      const mockAppendFileSync = vi.fn();
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => true),
        writeFileSync: vi.fn(),
        appendFileSync: mockAppendFileSync,
        readFileSync: vi.fn(() => ''),
      }));

      const mockInsert = vi.fn(() => ({ success: true }));
      vi.doMock('@process/database/export', () => ({
        getDatabase: vi.fn(() => ({ insertMemoryLog: mockInsert })),
      }));

      const { append } = await import('@/process/services/sudoclaw/MemoryLog');
      append('Another memory entry');

      expect(mockAppendFileSync).toHaveBeenCalledOnce();
      const [, content] = mockAppendFileSync.mock.calls[0] as [string, string];
      expect(content).toContain('Another memory entry');
      expect(content).toMatch(/^- \[/); // Starts with bullet and timestamp
    });

    it('inserts into SQLite via getDatabase', async () => {
      const mockInsert = vi.fn(() => ({ success: true }));
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => true),
        writeFileSync: vi.fn(),
        appendFileSync: vi.fn(),
        readFileSync: vi.fn(() => ''),
      }));
      vi.doMock('@process/database/export', () => ({
        getDatabase: vi.fn(() => ({ insertMemoryLog: mockInsert })),
      }));

      const { append } = await import('@/process/services/sudoclaw/MemoryLog');
      append('SQLite test entry');

      expect(mockInsert).toHaveBeenCalledOnce();
      const args = mockInsert.mock.calls[0][0] as { id: string; log_date: string; content: string; created_at: number };
      expect(args.id).toMatch(/^mem_/);
      expect(args.log_date).toBe('2026-04-08');
      expect(args.content).toBe('SQLite test entry');
      expect(args.created_at).toBeTypeOf('number');
    });
  });

  describe('getRecentLogs', () => {
    it('returns empty string when no log files exist', async () => {
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => false),
        readFileSync: vi.fn(() => ''),
        writeFileSync: vi.fn(),
        appendFileSync: vi.fn(),
      }));
      vi.doMock('@process/database/export', () => ({
        getDatabase: vi.fn(() => ({ insertMemoryLog: vi.fn(() => ({ success: true })) })),
      }));

      const { getRecentLogs } = await import('@/process/services/sudoclaw/MemoryLog');
      const result = getRecentLogs(3);

      expect(result).toBe('');
    });

    it('reads and concatenates multiple days of logs', async () => {
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => true),
        readFileSync: vi.fn((filePath: string) => {
          const p = String(filePath);
          if (p.includes('2026-04-08')) return '# Memory Log \u2014 2026-04-08\n\n- [ts] Entry today';
          if (p.includes('2026-04-07')) return '# Memory Log \u2014 2026-04-07\n\n- [ts] Entry yesterday';
          if (p.includes('2026-04-06')) return '# Memory Log \u2014 2026-04-06\n\n- [ts] Entry two days ago';
          return '';
        }),
        writeFileSync: vi.fn(),
        appendFileSync: vi.fn(),
      }));
      vi.doMock('@process/database/export', () => ({
        getDatabase: vi.fn(() => ({ insertMemoryLog: vi.fn(() => ({ success: true })) })),
      }));

      const { getRecentLogs } = await import('@/process/services/sudoclaw/MemoryLog');
      const result = getRecentLogs(3);

      expect(result).toContain('Entry today');
      expect(result).toContain('Entry yesterday');
      expect(result).toContain('Entry two days ago');
    });

    it('defaults to 3 days', async () => {
      const mockExistsSync = vi.fn(() => false);
      vi.doMock('fs', () => ({
        existsSync: mockExistsSync,
        readFileSync: vi.fn(() => ''),
        writeFileSync: vi.fn(),
        appendFileSync: vi.fn(),
      }));
      vi.doMock('@process/database/export', () => ({
        getDatabase: vi.fn(() => ({ insertMemoryLog: vi.fn(() => ({ success: true })) })),
      }));

      const { getRecentLogs } = await import('@/process/services/sudoclaw/MemoryLog');
      getRecentLogs();

      // Should check 3 file paths (today, yesterday, day before)
      expect(mockExistsSync).toHaveBeenCalledTimes(3);
    });
  });

  describe('getTodayLogPath', () => {
    it('returns correct path for today', async () => {
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => false),
        readFileSync: vi.fn(() => ''),
        writeFileSync: vi.fn(),
        appendFileSync: vi.fn(),
      }));
      vi.doMock('@process/database/export', () => ({
        getDatabase: vi.fn(() => ({ insertMemoryLog: vi.fn(() => ({ success: true })) })),
      }));

      const { getTodayLogPath } = await import('@/process/services/sudoclaw/MemoryLog');
      const result = getTodayLogPath();

      expect(result).toContain('2026-04-08.md');
      expect(result).toContain(path.join('2026', '04'));
    });
  });
});
