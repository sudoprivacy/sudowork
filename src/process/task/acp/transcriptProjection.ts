/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chatLib';
import type { ToolCallContentItem, ToolCallUpdate } from '@/types/acpTypes';
import { normalizeScodeUsageForMessage } from '@/process/task/acpUsageReconciliation';

/**
 * Project scode's persisted transcript (`<sessions-dir>/<sid>/transcript.jsonl`)
 * into the renderer's `TMessage[]`, so sudowork can treat the transcript as the
 * single SSOT for a scode conversation's history instead of keeping a full copy
 * in the `messages` table (nexus-2 #84).
 *
 * The transcript is scode's raw record: a `session_meta` entry then `message`
 * entries `{ role, blocks[], model?, usage? }` where a block is `text{ text }` ·
 * `tool_use{ id, name, input }` · `tool_result{ tool_use_id, output, is_error }`.
 * `tool_use.input` is a full JSON string (verified lossless), so — exactly like
 * Claude Code — the rich rendering is DERIVED here from the structured
 * input/output rather than read back from a pre-computed copy: a str-replace
 * edit (`old_string`+`new_string`) becomes a `diff` content item, everything
 * else falls back to its raw input + text output (the generic tool view). Live
 * rendering is unchanged (it replays the ACP stream directly, not this
 * projection). The transcript carries no per-message id, so ids are synthesized
 * deterministically (stable across reloads of the same transcript).
 */

type JsonRecord = Record<string, unknown>;

interface TranscriptMessage {
  role?: string;
  blocks?: JsonRecord[];
  model?: string;
  usage?: unknown;
  _meta?: unknown;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** scode stores tool_use.input as a string; surface parsed JSON when it is one. */
function parseRawInput(input: unknown): Record<string, unknown> | undefined {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input as Record<string, unknown>;
  if (typeof input !== 'string' || input.length === 0) return undefined;
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return { input };
  }
}

function textContentItem(output: string): ToolCallContentItem[] {
  return [{ type: 'content', content: { type: 'text', text: output } }];
}

/**
 * A str-replace edit (`old_string`+`new_string`) → the `diff` content item the
 * renderer turns into a file-diff panel. Detected by SCHEMA, not tool name, so
 * it survives tool renames. Field aliases match scode's `file_path`/`filePath`/
 * `path` (see `extract_file_path_from_tool_input` in sudocode). `null` when the
 * input is not an edit.
 */
function editDiffContent(input: Record<string, unknown> | undefined): ToolCallContentItem[] | null {
  if (!input) return null;
  const oldText = input.old_string;
  const newText = input.new_string;
  if (typeof oldText !== 'string' || typeof newText !== 'string') return null;
  return [{ type: 'diff', path: asString(input.file_path ?? input.filePath ?? input.path), oldText, newText }];
}

function deriveKind(name: string, isEdit: boolean): ToolCallUpdate['update']['kind'] {
  if (isEdit) return 'edit';
  const n = name.toLowerCase();
  if (/write|create|patch|multi_?edit/.test(n)) return 'edit';
  if (/read|glob|grep|search|list|^ls$|cat|find/.test(n)) return 'read';
  return 'execute';
}

/**
 * Parse a transcript's JSONL into `TMessage[]`. Skips `session_meta` and any
 * malformed line. A `tool_result` is folded into the `acp_tool_call` emitted for
 * its `tool_use` (matched by id, by mutating the shared update object), so a
 * tool call surfaces as one message with its rich view + terminal status.
 */
export function transcriptToMessages(jsonl: string, conversationId: string): TMessage[] {
  const messages: TMessage[] = [];
  // toolCallId → the update object already pushed, so a later tool_result completes it.
  const toolUpdates = new Map<string, ToolCallUpdate>();
  let seq = 0;
  const nextId = (): string => `scode-${conversationId}-${seq++}`;
  let sessionId = conversationId;
  // Reconstructed history is complete; the transcript has no per-message id or
  // timestamp, so synthesize a monotonic `createdAt` + a terminal `status` so
  // the renderer's list hook orders + keys these like DB rows (without them the
  // list does not render). Base off `session_meta.created_at_ms` when present.
  let createdBase = 0;
  let order = 0;
  const stamp = (): { status: 'finish'; createdAt: number } => ({ status: 'finish', createdAt: createdBase + order++ });

  const pushToolCall = (msgId: string, update: ToolCallUpdate): void => {
    toolUpdates.set(update.update.toolCallId, update);
    messages.push({ id: nextId(), type: 'acp_tool_call', msg_id: msgId, position: 'left', conversation_id: conversationId, content: update, ...stamp() });
  };

  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: JsonRecord;
    try {
      entry = JSON.parse(trimmed) as JsonRecord;
    } catch {
      continue; // partially-written / malformed line
    }
    if (entry.type === 'session_meta') {
      sessionId = asString(entry.session_id) || sessionId;
      if (typeof entry.created_at_ms === 'number') createdBase = entry.created_at_ms;
      continue;
    }

    const message = (asRecord(entry.message) ?? entry) as TranscriptMessage;
    const role = message.role;
    if (role !== 'user' && role !== 'assistant' && role !== 'tool') continue;

    const blocks = Array.isArray(message.blocks) ? message.blocks : [];
    const usage = role === 'assistant' ? normalizeScodeUsageForMessage(message.usage, message._meta ?? entry._meta) : null;

    for (const rawBlock of blocks) {
      const block = asRecord(rawBlock);
      if (!block) continue;

      if (block.type === 'text') {
        const text = asString(block.text);
        if (!text) continue;
        messages.push({
          id: nextId(),
          type: 'text',
          msg_id: nextId(),
          position: role === 'user' ? 'right' : 'left',
          conversation_id: conversationId,
          ...stamp(),
          content: { content: text, ...(usage ? { tokenUsage: usage } : {}) },
        });
      } else if (block.type === 'tool_use') {
        const toolCallId = asString(block.id) || nextId();
        const rawInput = parseRawInput(block.input);
        const diff = editDiffContent(rawInput);
        pushToolCall(toolCallId, {
          sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId,
            status: 'pending',
            title: asString(block.name) || 'tool',
            kind: deriveKind(asString(block.name), diff !== null),
            ...(rawInput ? { rawInput } : {}),
            ...(diff ? { content: diff } : {}),
          },
        });
      } else if (block.type === 'tool_result') {
        const toolUseId = asString(block.tool_use_id);
        const output = asString(block.output);
        const isError = block.is_error === true;
        const existing = toolUseId ? toolUpdates.get(toolUseId) : undefined;
        if (existing) {
          existing.update.status = isError ? 'failed' : 'completed';
          // Keep a derived diff as the primary view; add the output text only when
          // there's nothing yet, or when it's an error the user must see.
          if (output && (isError || !existing.update.content?.length)) {
            existing.update.content = [...(existing.update.content ?? []), ...textContentItem(output)];
          }
        } else {
          // Orphan result (its tool_use is outside this transcript slice).
          pushToolCall(toolUseId || nextId(), {
            sessionId,
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: toolUseId || nextId(),
              status: isError ? 'failed' : 'completed',
              title: asString(block.tool_name) || 'tool',
              kind: 'execute',
              ...(output ? { content: textContentItem(output) } : {}),
            },
          });
        }
      }
      // unknown block types (thinking, images, …) are dropped from the historical view.
    }
  }

  return messages;
}
