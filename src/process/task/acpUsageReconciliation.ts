/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TurnTokenUsage } from '@/common/chatLib';
import type { AcpPromptResponseUsage } from '@/types/acpTypes';
import type { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';

type JsonRecord = Record<string, unknown>;

const SCODE_SESSION_POLL_ATTEMPTS = 24;
const SCODE_SESSION_POLL_INTERVAL_MS = 15_000;

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function readNestedRecord(value: unknown, key: string): JsonRecord | undefined {
  return readRecord(readRecord(value)?.[key]);
}

function pickNumber(record: JsonRecord | undefined, ...keys: string[]): number | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = numberOrUndefined(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function pickString(record: JsonRecord | undefined, ...keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = stringOrUndefined(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function normalizePromptUsageForMessage(usage: Partial<AcpPromptResponseUsage>): TurnTokenUsage | null {
  if (typeof usage.totalTokens !== 'number') return null;
  return {
    totalTokens: usage.totalTokens,
    ...(typeof usage.inputTokens === 'number' && { inputTokens: usage.inputTokens }),
    ...(typeof usage.outputTokens === 'number' && { outputTokens: usage.outputTokens }),
    ...(usage.cachedReadTokens !== undefined && { cachedReadTokens: usage.cachedReadTokens }),
    ...(usage.cachedWriteTokens !== undefined && { cachedWriteTokens: usage.cachedWriteTokens }),
    ...(usage.thoughtTokens !== undefined && { thoughtTokens: usage.thoughtTokens }),
    ...(usage.contextWindowTokens !== undefined && { contextWindowTokens: usage.contextWindowTokens }),
    ...(usage.estimatedSessionTokens !== undefined && { estimatedSessionTokens: usage.estimatedSessionTokens }),
    ...(usage.costUnits !== undefined && { costUnits: usage.costUnits }),
    ...(usage.costCurrency !== undefined && { costCurrency: usage.costCurrency }),
  };
}

export function normalizeScodeUsageForMessage(rawUsage: unknown, rawMeta?: unknown): TurnTokenUsage | null {
  const usage = readRecord(rawUsage);
  if (!usage) return null;

  const meta = readRecord(rawMeta);
  const sudocodeMeta = readNestedRecord(meta, 'sudocode');
  const inputTokens = pickNumber(usage, 'inputTokens', 'input_tokens');
  const outputTokens = pickNumber(usage, 'outputTokens', 'output_tokens');
  let totalTokens = pickNumber(usage, 'totalTokens', 'total_tokens');
  if (totalTokens === undefined && inputTokens !== undefined && outputTokens !== undefined) {
    totalTokens = inputTokens + outputTokens;
  }
  if (totalTokens === undefined) return null;

  const cachedReadTokens = pickNumber(usage, 'cachedReadTokens', 'cache_read_input_tokens', 'cached_read_tokens');
  const cachedWriteTokens = pickNumber(usage, 'cachedWriteTokens', 'cache_creation_input_tokens', 'cached_write_tokens');
  const thoughtTokens = pickNumber(usage, 'thoughtTokens', 'thought_tokens');
  const contextWindowTokens = pickNumber(sudocodeMeta, 'contextWindowTokens') ?? pickNumber(usage, 'contextWindowTokens', 'context_window_tokens');
  const estimatedSessionTokens = pickNumber(sudocodeMeta, 'estimatedSessionTokens') ?? pickNumber(usage, 'estimatedSessionTokens', 'estimated_session_tokens');
  const costUnits = pickNumber(sudocodeMeta, 'costUnits') ?? pickNumber(usage, 'costUnits', 'cost_units');
  const costCurrency = pickString(sudocodeMeta, 'costCurrency') ?? pickString(usage, 'costCurrency', 'cost_currency');

  return {
    totalTokens,
    ...(inputTokens !== undefined && { inputTokens }),
    ...(outputTokens !== undefined && { outputTokens }),
    ...(cachedReadTokens !== undefined && { cachedReadTokens }),
    ...(cachedWriteTokens !== undefined && { cachedWriteTokens }),
    ...(thoughtTokens !== undefined && { thoughtTokens }),
    ...(contextWindowTokens !== undefined && { contextWindowTokens }),
    ...(estimatedSessionTokens !== undefined && { estimatedSessionTokens }),
    ...(costUnits !== undefined && { costUnits }),
    ...(costCurrency !== undefined && { costCurrency }),
  };
}

export interface ScodeUsageEntry {
  messageId: string | null;
  usage: TurnTokenUsage;
}

export function extractLatestScodeAssistantUsageFromJsonl(content: string): ScodeUsageEntry | null {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]) as JsonRecord;
      const message = readRecord(entry.message) ?? entry;
      if (message.role !== 'assistant') continue;

      const usage = normalizeScodeUsageForMessage(message.usage, message._meta ?? entry._meta);
      if (!usage) continue;

      const messageId = stringOrUndefined(message.id) ?? stringOrUndefined(message.msg_id) ?? stringOrUndefined(entry.id) ?? stringOrUndefined(entry.msg_id) ?? null;
      return { messageId, usage };
    } catch {
      // Ignore malformed or partially written JSONL lines.
    }
  }

  return null;
}

export async function findScodeSessionFile(workspace: string, sessionId: string): Promise<string | null> {
  const sessionsRoot = nodePath.join(workspace, '.scode', 'sessions');
  const directCandidates = [nodePath.join(sessionsRoot, sessionId, 'session.jsonl'), nodePath.join(sessionsRoot, `${sessionId}.jsonl`)];

  for (const candidate of directCandidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  let entries;
  try {
    entries = await fs.readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const stack = entries.map((entry) => nodePath.join(sessionsRoot, entry.name));
  while (stack.length > 0) {
    const current = stack.pop()!;
    let stat;
    try {
      stat = await fs.stat(current);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      const children = await fs.readdir(current, { withFileTypes: true }).catch((): Dirent[] => []);
      for (const child of children) stack.push(nodePath.join(current, child.name));
      continue;
    }

    if (stat.isFile() && nodePath.basename(current) === `${sessionId}.jsonl`) {
      return current;
    }
  }

  return null;
}

export const SCODE_LATE_RECONCILIATION_DEFAULTS = {
  attempts: SCODE_SESSION_POLL_ATTEMPTS,
  intervalMs: SCODE_SESSION_POLL_INTERVAL_MS,
};
