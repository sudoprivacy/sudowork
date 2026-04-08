/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

describe('sudoclaw/prompts', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('system.ts', () => {
    it('exports SUDOCLAW_SYSTEM_PROMPT with required sections', async () => {
      const { SUDOCLAW_SYSTEM_PROMPT } = await import('@/process/services/sudoclaw/prompts/system');

      expect(SUDOCLAW_SYSTEM_PROMPT).toContain('# SudoClaw Persistent Mode');
      expect(SUDOCLAW_SYSTEM_PROMPT).toContain('## Core Principles');
      expect(SUDOCLAW_SYSTEM_PROMPT).toContain('## Tick Behavior');
      expect(SUDOCLAW_SYSTEM_PROMPT).toContain('## Available Tools');
      expect(SUDOCLAW_SYSTEM_PROMPT).toContain('## AskUser Guidance');
      expect(SUDOCLAW_SYSTEM_PROMPT).toContain('## Daily Memory Log');
    });

    it('mentions all four tools: Sleep, Notify, AskUser, MemoryAppend', async () => {
      const { SUDOCLAW_SYSTEM_PROMPT } = await import('@/process/services/sudoclaw/prompts/system');

      expect(SUDOCLAW_SYSTEM_PROMPT).toContain('Sleep');
      expect(SUDOCLAW_SYSTEM_PROMPT).toContain('Notify');
      expect(SUDOCLAW_SYSTEM_PROMPT).toContain('AskUser');
      expect(SUDOCLAW_SYSTEM_PROMPT).toContain('MemoryAppend');
    });

    it('buildSudoclawSystemPrompt returns base prompt without memory context', async () => {
      const { buildSudoclawSystemPrompt, SUDOCLAW_SYSTEM_PROMPT } = await import(
        '@/process/services/sudoclaw/prompts/system'
      );

      const result = buildSudoclawSystemPrompt();
      expect(result).toBe(SUDOCLAW_SYSTEM_PROMPT);
    });

    it('buildSudoclawSystemPrompt appends memory context when provided', async () => {
      const { buildSudoclawSystemPrompt, SUDOCLAW_SYSTEM_PROMPT } = await import(
        '@/process/services/sudoclaw/prompts/system'
      );

      const memoryContext = '### 2026-04-07\nCompleted data migration task.';
      const result = buildSudoclawSystemPrompt(memoryContext);

      expect(result).toContain(SUDOCLAW_SYSTEM_PROMPT);
      expect(result).toContain('## Recent Memory Context');
      expect(result).toContain(memoryContext);
    });
  });

  describe('memory.ts', () => {
    it('formatMemoryContext returns undefined for empty entries', async () => {
      const { formatMemoryContext } = await import('@/process/services/sudoclaw/prompts/memory');

      expect(formatMemoryContext([])).toBeUndefined();
    });

    it('formatMemoryContext returns undefined for null-ish input', async () => {
      const { formatMemoryContext } = await import('@/process/services/sudoclaw/prompts/memory');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(formatMemoryContext(null as any)).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(formatMemoryContext(undefined as any)).toBeUndefined();
    });

    it('formatMemoryContext formats a single entry', async () => {
      const { formatMemoryContext } = await import('@/process/services/sudoclaw/prompts/memory');

      const entries = [{ date: '2026-04-08', content: 'Set up SudoClaw persistent mode.' }];
      const result = formatMemoryContext(entries);

      expect(result).toBe('### 2026-04-08\nSet up SudoClaw persistent mode.');
    });

    it('formatMemoryContext formats multiple entries separated by blank lines', async () => {
      const { formatMemoryContext } = await import('@/process/services/sudoclaw/prompts/memory');

      const entries = [
        { date: '2026-04-08', content: 'Entry two.' },
        { date: '2026-04-07', content: 'Entry one.' },
      ];
      const result = formatMemoryContext(entries);

      expect(result).toContain('### 2026-04-08');
      expect(result).toContain('### 2026-04-07');
      expect(result).toContain('Entry two.');
      expect(result).toContain('Entry one.');
      // Entries should be separated by a blank line
      expect(result).toContain('\n\n');
    });

    it('getMemoryContext returns undefined (stub until #214)', async () => {
      const { getMemoryContext } = await import('@/process/services/sudoclaw/prompts/memory');

      const result = await getMemoryContext();
      expect(result).toBeUndefined();
    });

    it('DEFAULT_RECENT_LOG_COUNT is 3', async () => {
      const { DEFAULT_RECENT_LOG_COUNT } = await import('@/process/services/sudoclaw/prompts/memory');

      expect(DEFAULT_RECENT_LOG_COUNT).toBe(3);
    });
  });

  describe('index.ts (injection)', () => {
    it('buildSudoclawPresetContext returns prompt without existing context', async () => {
      const { buildSudoclawPresetContext } = await import('@/process/services/sudoclaw/prompts');

      const result = await buildSudoclawPresetContext();

      expect(result).toContain('# SudoClaw Persistent Mode');
      expect(result).toContain('## Tick Behavior');
    });

    it('buildSudoclawPresetContext preserves existing presetContext', async () => {
      const { buildSudoclawPresetContext } = await import('@/process/services/sudoclaw/prompts');

      const existing = 'You are a helpful coding assistant. Always write tests.';
      const result = await buildSudoclawPresetContext(existing);

      // Existing rules should come first
      expect(result.indexOf(existing)).toBeLessThan(result.indexOf('# SudoClaw Persistent Mode'));
      expect(result).toContain(existing);
      expect(result).toContain('# SudoClaw Persistent Mode');
    });

    it('injectSudoclawPrompt sets presetContext on conversation extra', async () => {
      const { injectSudoclawPrompt } = await import('@/process/services/sudoclaw/prompts');

      const extra: { presetContext?: string } = {};
      const result = await injectSudoclawPrompt(extra);

      expect(result).toContain('# SudoClaw Persistent Mode');
      expect(extra.presetContext).toBe(result);
    });

    it('injectSudoclawPrompt preserves existing presetContext', async () => {
      const { injectSudoclawPrompt } = await import('@/process/services/sudoclaw/prompts');

      const existingRules = 'You are a financial analyst assistant.';
      const extra: { presetContext?: string } = { presetContext: existingRules };
      const result = await injectSudoclawPrompt(extra);

      expect(result).toContain(existingRules);
      expect(result).toContain('# SudoClaw Persistent Mode');
    });

    it('injectSudoclawPrompt is idempotent', async () => {
      const { injectSudoclawPrompt } = await import('@/process/services/sudoclaw/prompts');

      const extra: { presetContext?: string } = {};

      // First injection
      const first = await injectSudoclawPrompt(extra);
      // Second injection
      const second = await injectSudoclawPrompt(extra);

      expect(first).toBe(second);
      // Should not contain duplicate SudoClaw headers
      const headerCount = (extra.presetContext!.match(/# SudoClaw Persistent Mode/g) || []).length;
      expect(headerCount).toBe(1);
    });

    it('injectSudoclawPrompt is idempotent with existing presetContext', async () => {
      const { injectSudoclawPrompt } = await import('@/process/services/sudoclaw/prompts');

      const existingRules = 'Custom rules here.';
      const extra: { presetContext?: string } = { presetContext: existingRules };

      await injectSudoclawPrompt(extra);
      const firstResult = extra.presetContext;
      await injectSudoclawPrompt(extra);
      const secondResult = extra.presetContext;

      expect(firstResult).toBe(secondResult);
    });
  });
});
