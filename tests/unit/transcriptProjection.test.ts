/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { ToolCallUpdate } from '@/types/acpTypes';
import { transcriptToMessages } from '@/process/task/acp/transcriptProjection';

// Fixture shaped exactly like scode's on-disk transcript.jsonl (verified against
// real ~/.scode sessions): session_meta + user/assistant/tool messages whose
// blocks are text / tool_use / tool_result.
function jsonl(...entries: unknown[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n');
}

const META = { type: 'session_meta', session_id: 's1', model: 'sonnet', workspace_root: '/w', version: 1, created_at_ms: 1, updated_at_ms: 2 };

describe('transcriptToMessages', () => {
  it('skips session_meta and projects a user text turn to a right-positioned bubble', () => {
    const out = transcriptToMessages(jsonl(META, { type: 'message', message: { role: 'user', blocks: [{ type: 'text', text: 'hi there' }] } }), 'c1');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'text', position: 'right', conversation_id: 'c1', content: { content: 'hi there' } });
  });

  it('projects an assistant text turn to a left bubble carrying normalized token usage', () => {
    const out = transcriptToMessages(
      jsonl({
        type: 'message',
        message: {
          role: 'assistant',
          model: 'sonnet',
          blocks: [{ type: 'text', text: 'the answer' }],
          usage: { input_tokens: 10, output_tokens: 5, cost_units: 100, cost_currency: 'sudo_point' },
        },
      }),
      'c1'
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'text',
      position: 'left',
      content: { content: 'the answer', tokenUsage: { totalTokens: 15, inputTokens: 10, outputTokens: 5, costUnits: 100, costCurrency: 'sudo_point' } },
    });
  });

  it('pairs a tool_use with its later tool_result into one completed acp_tool_call', () => {
    const out = transcriptToMessages(
      jsonl({ type: 'message', message: { role: 'assistant', blocks: [{ type: 'tool_use', id: 'tc1', name: 'read_file', input: '{"path":"a.ts"}' }] } }, { type: 'message', message: { role: 'tool', blocks: [{ type: 'tool_result', tool_use_id: 'tc1', output: 'file contents', is_error: false }] } }),
      'c1'
    );
    expect(out).toHaveLength(1);
    const msg = out[0];
    expect(msg.type).toBe('acp_tool_call');
    expect(msg.msg_id).toBe('tc1');
    const update = (msg.content as ToolCallUpdate).update;
    expect(update).toMatchObject({ toolCallId: 'tc1', title: 'read_file', status: 'completed', kind: 'read', rawInput: { path: 'a.ts' } });
    expect(update.content).toEqual([{ type: 'content', content: { type: 'text', text: 'file contents' } }]);
  });

  it('derives a diff content item + edit kind from a str-replace edit (CC-style, by schema not name)', () => {
    const out = transcriptToMessages(
      jsonl(
        { type: 'message', message: { role: 'assistant', blocks: [{ type: 'tool_use', id: 'e1', name: 'apply_patch', input: JSON.stringify({ file_path: '/w/a.ts', old_string: 'const a = 1', new_string: 'const a = 2' }) }] } },
        { type: 'message', message: { role: 'tool', blocks: [{ type: 'tool_result', tool_use_id: 'e1', output: 'edited', is_error: false }] } }
      ),
      'c1'
    );
    expect(out).toHaveLength(1);
    const update = (out[0].content as ToolCallUpdate).update;
    expect(update.kind).toBe('edit');
    // the diff is the primary view; the "edited" success text is NOT appended over it
    expect(update.content).toEqual([{ type: 'diff', path: '/w/a.ts', oldText: 'const a = 1', newText: 'const a = 2' }]);
  });

  it('appends the error text over a diff when an edit fails', () => {
    const out = transcriptToMessages(
      jsonl(
        { type: 'message', message: { role: 'assistant', blocks: [{ type: 'tool_use', id: 'e2', name: 'edit', input: JSON.stringify({ path: 'a.ts', old_string: 'x', new_string: 'y' }) }] } },
        { type: 'message', message: { role: 'tool', blocks: [{ type: 'tool_result', tool_use_id: 'e2', output: 'no match for old_string', is_error: true }] } }
      ),
      'c1'
    );
    const update = (out[0].content as ToolCallUpdate).update;
    expect(update.status).toBe('failed');
    expect(update.content).toEqual([
      { type: 'diff', path: 'a.ts', oldText: 'x', newText: 'y' },
      { type: 'content', content: { type: 'text', text: 'no match for old_string' } },
    ]);
  });

  it('marks a tool_result with is_error as failed', () => {
    const out = transcriptToMessages(
      jsonl({ type: 'message', message: { role: 'assistant', blocks: [{ type: 'tool_use', id: 'tc2', name: 'bash', input: 'not json' }] } }, { type: 'message', message: { role: 'tool', blocks: [{ type: 'tool_result', tool_use_id: 'tc2', output: 'boom', is_error: true }] } }),
      'c1'
    );
    expect(out).toHaveLength(1);
    const update = (out[0].content as ToolCallUpdate).update;
    expect(update.status).toBe('failed');
    // non-JSON input is preserved verbatim under `input`
    expect(update.rawInput).toEqual({ input: 'not json' });
  });

  it('projects a thinking block to a collapsible thought (header = first line)', () => {
    const out = transcriptToMessages(jsonl({ type: 'message', message: { role: 'assistant', blocks: [{ type: 'thinking', thinking: 'first line of reasoning\nmore detail here' }] } }), 'c1');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'thought', position: 'left', content: { subject: 'first line of reasoning', description: 'first line of reasoning\nmore detail here' } });
  });

  it('preserves order across a multi-block assistant turn (thinking, text, tool_use)', () => {
    const out = transcriptToMessages(
      jsonl({
        type: 'message',
        message: {
          role: 'assistant',
          blocks: [
            { type: 'thinking', thinking: 'hmm' },
            { type: 'text', text: 'the answer' },
            { type: 'tool_use', id: 'z', name: 'ls', input: '{}' },
          ],
        },
      }),
      'c1'
    );
    expect(out.map((m) => m.type)).toEqual(['thought', 'text', 'acp_tool_call']);
  });

  it('preserves order across a multi-block assistant turn (text then tool_use)', () => {
    const out = transcriptToMessages(
      jsonl({
        type: 'message',
        message: {
          role: 'assistant',
          blocks: [
            { type: 'text', text: 'let me check' },
            { type: 'tool_use', id: 'tc3', name: 'ls', input: '{}' },
          ],
        },
      }),
      'c1'
    );
    expect(out.map((m) => m.type)).toEqual(['text', 'acp_tool_call']);
    expect((out[1].content as ToolCallUpdate).update.status).toBe('pending'); // no result yet
  });

  it('emits deterministic ids stable across two runs of the same transcript', () => {
    const t = jsonl(META, { type: 'message', message: { role: 'user', blocks: [{ type: 'text', text: 'x' }] } });
    expect(transcriptToMessages(t, 'c1').map((m) => m.id)).toEqual(transcriptToMessages(t, 'c1').map((m) => m.id));
  });

  it('handles the flat (unwrapped) record shape and skips malformed lines', () => {
    const out = transcriptToMessages([JSON.stringify({ role: 'user', blocks: [{ type: 'text', text: 'flat' }] }), 'not json', ''].join('\n'), 'c1');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'text', content: { content: 'flat' } });
  });

  it('returns [] for an empty transcript', () => {
    expect(transcriptToMessages('', 'c1')).toEqual([]);
  });

  it('recovers the real user message from sudowork-injected prompt context', () => {
    const wrapped = '<system-reminder>语言约定…</system-reminder>\n[Assistant Rules - You MUST follow these instructions]\n[File Intent Marking …]\n\n[User Request]\nwhat is 2+2?';
    const out = transcriptToMessages(jsonl({ type: 'message', message: { role: 'user', blocks: [{ type: 'text', text: wrapped }] } }), 'c1');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'text', position: 'right', content: { content: 'what is 2+2?' } });
  });

  it('drops a user block that is pure injected context (no real message)', () => {
    const out = transcriptToMessages(jsonl({ type: 'message', message: { role: 'user', blocks: [{ type: 'text', text: '<system-reminder>Today is X</system-reminder>' }] } }), 'c1');
    expect(out).toEqual([]);
  });
});
