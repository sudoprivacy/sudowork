/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { IMessageAcpToolCall } from '@/common/chatLib';
import MessageAcpToolCall from '@/renderer/messages/acp/MessageAcpToolCall';
import { transcriptToMessages } from '@/process/task/acp/transcriptProjection';

// The diff preview click-handlers hook reaches into the app's PreviewProvider —
// orthogonal to the diff DISPLAY we're verifying, so stub it.
vi.mock('@/renderer/hooks/useDiffPreviewHandlers', () => ({
  useDiffPreviewHandlers: () => ({ handleFileClick: () => {}, handleDiffClick: () => {} }),
}));
// MarkdownView renders nothing in jsdom; pass its text through so we can assert
// the tool output actually reaches the markdown renderer.
vi.mock('@/renderer/components/Markdown', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

// Render transcript-reconstructed tool calls through the REAL renderer to prove
// the projection produces exactly the ToolCallUpdate shape the UI consumes —
// the render-side of the messages→view collapse (nexus-2 #84), headless.
function jsonl(...entries: unknown[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n');
}

function firstToolCall(t: string): IMessageAcpToolCall {
  const msgs = transcriptToMessages(t, 'c1');
  const tc = msgs.find((m) => m.type === 'acp_tool_call');
  if (!tc) throw new Error('no tool call projected');
  return tc as IMessageAcpToolCall;
}

describe('reconstructed tool call renders in the real MessageAcpToolCall', () => {
  it('renders a bash tool call: title, completed status, and its output', () => {
    const tc = firstToolCall(
      jsonl(
        { type: 'message', message: { role: 'assistant', blocks: [{ type: 'tool_use', id: 't1', name: 'bash', input: JSON.stringify({ command: 'ls -la' }) }] } },
        { type: 'message', message: { role: 'tool', blocks: [{ type: 'tool_result', tool_use_id: 't1', output: 'total 0 done-output', is_error: false }] } }
      )
    );
    const { container } = render(<MessageAcpToolCall message={tc} />);
    const text = container.textContent ?? '';
    expect(screen.getByText('bash')).toBeTruthy(); // title
    expect(screen.getByText('completed')).toBeTruthy(); // status tag
    expect(text).toContain('done-output'); // tool output (MarkdownView splits nodes)
    expect(text).toContain('ls -la'); // rawInput command
  });

  it('renders a str-replace edit as a file diff (the derived-at-render path)', () => {
    const tc = firstToolCall(jsonl({ type: 'message', message: { role: 'assistant', blocks: [{ type: 'tool_use', id: 't2', name: 'apply_patch', input: JSON.stringify({ file_path: '/w/hello.ts', old_string: 'ALPHA_was_here', new_string: 'BETA_is_here' }) }] } }));
    const { container } = render(<MessageAcpToolCall message={tc} />);
    const text = container.textContent ?? '';
    // the derived diff panel surfaces the file name + both sides of the change
    expect(text).toContain('hello.ts');
    expect(text).toContain('ALPHA_was_here');
    expect(text).toContain('BETA_is_here');
  });
});
