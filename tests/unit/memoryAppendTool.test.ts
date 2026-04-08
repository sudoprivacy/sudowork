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

vi.mock('@process/database/export', () => ({
  getDatabase: vi.fn(() => ({
    insertMemoryLog: vi.fn(() => ({ success: true })),
  })),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-home'),
  },
}));

// Mock fs to prevent actual file operations
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    appendFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

describe('MemoryAppendTool', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('memoryAppendToolDefinition', () => {
    it('has the correct name and schema', async () => {
      const { memoryAppendToolDefinition, MEMORY_APPEND_TOOL_NAME } = await import('@/process/services/sudoclaw/tools/MemoryAppendTool');

      expect(MEMORY_APPEND_TOOL_NAME).toBe('memory_append');
      expect(memoryAppendToolDefinition.name).toBe('memory_append');
      expect(memoryAppendToolDefinition.parameters.required).toContain('entry');
      expect(memoryAppendToolDefinition.parameters.properties.entry.type).toBe('string');
    });
  });

  describe('handleMemoryAppend', () => {
    it('returns success for valid entry', async () => {
      const { handleMemoryAppend } = await import('@/process/services/sudoclaw/tools/MemoryAppendTool');
      const result = handleMemoryAppend({ entry: 'User prefers dark mode' });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Memory saved.');
    });

    it('rejects empty string entry', async () => {
      const { handleMemoryAppend } = await import('@/process/services/sudoclaw/tools/MemoryAppendTool');
      const result = handleMemoryAppend({ entry: '' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('non-empty');
    });

    it('rejects whitespace-only entry', async () => {
      const { handleMemoryAppend } = await import('@/process/services/sudoclaw/tools/MemoryAppendTool');
      const result = handleMemoryAppend({ entry: '   ' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('empty after trimming');
    });

    it('trims entry before saving', async () => {
      const mockInsert = vi.fn(() => ({ success: true }));
      const { getDatabase } = await import('@process/database/export');
      vi.mocked(getDatabase).mockReturnValue({ insertMemoryLog: mockInsert } as ReturnType<typeof getDatabase>);

      const { handleMemoryAppend } = await import('@/process/services/sudoclaw/tools/MemoryAppendTool');
      handleMemoryAppend({ entry: '  trimmed entry  ' });

      expect(mockInsert).toHaveBeenCalledOnce();
      const args = mockInsert.mock.calls[0][0] as { content: string };
      expect(args.content).toBe('trimmed entry');
    });
  });
});
