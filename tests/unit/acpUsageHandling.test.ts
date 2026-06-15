/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractLatestScodeAssistantUsageFromJsonl, findScodeSessionFile, normalizePromptUsageForMessage, normalizeScodeUsageForMessage } from '@/process/task/acpUsageReconciliation';

describe('normalizePromptUsageForMessage', () => {
  it('keeps PromptResponse usage fields for message token usage', () => {
    expect(
      normalizePromptUsageForMessage({
        totalTokens: 200,
        inputTokens: 150,
        outputTokens: 50,
        cachedReadTokens: 30,
        cachedWriteTokens: 10,
        thoughtTokens: 20,
        contextWindowTokens: 100000,
        estimatedSessionTokens: 5000,
        costUnits: 43700,
        costCurrency: 'sudo_point',
      })
    ).toEqual({
      totalTokens: 200,
      inputTokens: 150,
      outputTokens: 50,
      cachedReadTokens: 30,
      cachedWriteTokens: 10,
      thoughtTokens: 20,
      contextWindowTokens: 100000,
      estimatedSessionTokens: 5000,
      costUnits: 43700,
      costCurrency: 'sudo_point',
    });
  });

  it('rejects PromptResponse usage without totalTokens', () => {
    expect(normalizePromptUsageForMessage({ inputTokens: 100, outputTokens: 50 })).toBeNull();
  });
});

describe('normalizeScodeUsageForMessage', () => {
  it('derives total tokens from SCode snake_case input and output fields', () => {
    expect(
      normalizeScodeUsageForMessage({
        input_tokens: 1370,
        output_tokens: 697,
        cache_read_input_tokens: 39885,
        cache_creation_input_tokens: 12,
        cost_units: 158609,
        cost_currency: 'sudo_point',
      })
    ).toEqual({
      totalTokens: 2067,
      inputTokens: 1370,
      outputTokens: 697,
      cachedReadTokens: 39885,
      cachedWriteTokens: 12,
      costUnits: 158609,
      costCurrency: 'sudo_point',
    });
  });

  it('prefers Sudocode meta cost fields over usage cost fields', () => {
    expect(
      normalizeScodeUsageForMessage(
        {
          total_tokens: 100,
          cost_units: 1,
          cost_currency: 'usd',
        },
        {
          sudocode: {
            costUnits: 43700,
            costCurrency: 'sudo_point',
            contextWindowTokens: 200000,
            estimatedSessionTokens: 3210,
          },
        }
      )
    ).toEqual({
      totalTokens: 100,
      contextWindowTokens: 200000,
      estimatedSessionTokens: 3210,
      costUnits: 43700,
      costCurrency: 'sudo_point',
    });
  });

  it('returns null when no total can be derived', () => {
    expect(normalizeScodeUsageForMessage({ input_tokens: 10 })).toBeNull();
  });
});

describe('extractLatestScodeAssistantUsageFromJsonl', () => {
  it('extracts usage from the latest real SCode message-shaped assistant entry', () => {
    const jsonl = [
      JSON.stringify({
        message: {
          role: 'assistant',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cost_units: 100,
            cost_currency: 'sudo_point',
          },
        },
        type: 'message',
      }),
      'not json',
      JSON.stringify({
        message: {
          blocks: [{ text: 'done', type: 'text' }],
          role: 'assistant',
          usage: {
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 39885,
            cost_currency: 'sudo_point',
            cost_units: 158609,
            input_tokens: 1370,
            output_tokens: 697,
          },
        },
        type: 'message',
      }),
    ].join('\n');

    expect(extractLatestScodeAssistantUsageFromJsonl(jsonl)).toEqual({
      messageId: null,
      usage: {
        totalTokens: 2067,
        inputTokens: 1370,
        outputTokens: 697,
        cachedReadTokens: 39885,
        cachedWriteTokens: 0,
        costUnits: 158609,
        costCurrency: 'sudo_point',
      },
    });
  });

  it('ignores compaction and tool entries without assistant message usage', () => {
    const jsonl = [
      JSON.stringify({ type: 'compaction', usage: { input_tokens: 1, output_tokens: 1 } }),
      JSON.stringify({ message: { role: 'tool' }, type: 'message' }),
    ].join('\n');

    expect(extractLatestScodeAssistantUsageFromJsonl(jsonl)).toBeNull();
  });
});

describe('findScodeSessionFile', () => {
  it('finds nested SCode session files named after the ACP session id', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'scode-session-'));
    const sessionId = 'session-1781507199209-0';
    const sessionDir = path.join(root, '.scode', 'sessions', 'f4975f5977d43141');
    await mkdir(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, `${sessionId}.jsonl`);
    await writeFile(sessionFile, '{}\n');

    await expect(findScodeSessionFile(root, sessionId)).resolves.toBe(sessionFile);
  });
});
