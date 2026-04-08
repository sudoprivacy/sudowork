/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

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

describe('memory prompt', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildMemoryPromptSection', () => {
    it('returns empty string when no logs exist', async () => {
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => false),
        readFileSync: vi.fn(() => ''),
      }));

      // Need to also mock the database since MemoryLog imports it
      vi.doMock('@process/database/export', () => ({
        getDatabase: vi.fn(() => ({
          insertMemoryLog: vi.fn(() => ({ success: true })),
        })),
      }));

      const { buildMemoryPromptSection } = await import('@/process/services/sudoclaw/prompts/memory');
      const result = buildMemoryPromptSection();

      expect(result).toBe('');
    });

    it('wraps logs in memory_logs XML tags', async () => {
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => true),
        readFileSync: vi.fn(() => '# Memory Log\n\n- [ts] Important note'),
      }));

      vi.doMock('@process/database/export', () => ({
        getDatabase: vi.fn(() => ({
          insertMemoryLog: vi.fn(() => ({ success: true })),
        })),
      }));

      const { buildMemoryPromptSection } = await import('@/process/services/sudoclaw/prompts/memory');
      const result = buildMemoryPromptSection(1);

      expect(result).toContain('<memory_logs>');
      expect(result).toContain('</memory_logs>');
      expect(result).toContain('Important note');
    });

    it('defaults to 3 days', async () => {
      const mockExistsSync = vi.fn(() => false);
      vi.doMock('fs', () => ({
        existsSync: mockExistsSync,
        readFileSync: vi.fn(() => ''),
      }));

      vi.doMock('@process/database/export', () => ({
        getDatabase: vi.fn(() => ({
          insertMemoryLog: vi.fn(() => ({ success: true })),
        })),
      }));

      const { buildMemoryPromptSection } = await import('@/process/services/sudoclaw/prompts/memory');
      buildMemoryPromptSection();

      // Should check 3 file paths (default 3 days)
      expect(mockExistsSync).toHaveBeenCalledTimes(3);
    });
  });

  describe('getMemoryPromptInjection', () => {
    it('is a convenience wrapper that returns same result as buildMemoryPromptSection', async () => {
      vi.doMock('fs', () => ({
        existsSync: vi.fn(() => false),
        readFileSync: vi.fn(() => ''),
      }));

      vi.doMock('@process/database/export', () => ({
        getDatabase: vi.fn(() => ({
          insertMemoryLog: vi.fn(() => ({ success: true })),
        })),
      }));

      const { buildMemoryPromptSection, getMemoryPromptInjection } = await import('@/process/services/sudoclaw/prompts/memory');

      expect(getMemoryPromptInjection()).toBe(buildMemoryPromptSection());
    });
  });
});
