import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { IMessageAcpToolCall } from '@sudowork/common/chatLib';
import MessageAcpToolCall from '@renderer/messages/acp/MessageAcpToolCall';
import ToolContentView from '@renderer/messages/tools/ToolContentView';
import { isToolActive, isToolFinished, normalizeToolState, projectAcpToolContent } from '@renderer/messages/tools/toolPresentation';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@renderer/hooks/useDiffPreviewHandlers', () => ({ useDiffPreviewHandlers: () => ({}) }));
vi.mock('@renderer/components/base/FileChangesPanel', () => ({ default: ({ title }: { title: string }) => <div data-testid='file-diff'>{title}</div> }));
afterEach(cleanup);

it('normalizes ACP and native tool states to the same display vocabulary', () => {
  expect(normalizeToolState('in_progress')).toBe(normalizeToolState('executing'));
  expect(normalizeToolState('completed')).toBe(normalizeToolState('Success'));
  expect(normalizeToolState('failed')).toBe(normalizeToolState('Error'));
  expect(normalizeToolState('cancelled')).toBe(normalizeToolState('Canceled'));
  expect(normalizeToolState('future-state')).toBe('unknown');
  expect(isToolActive('in_progress')).toBe(true);
  expect(isToolActive('Confirming')).toBe(true);
  expect(isToolActive('cancelled')).toBe(false);
  expect(isToolFinished('cancelled')).toBe(true);
  expect(isToolFinished('future-state')).toBe(false);
});

it('renders shell output literally, including markdown-looking characters and large JSON IDs', () => {
  const output = '# literal output\n*not emphasis* | raw pipe\n{"id":9007199254740993}';
  const message: IMessageAcpToolCall = {
    id: 'call',
    type: 'acp_tool_call',
    position: 'left',
    content: { sessionId: 'session', update: { sessionUpdate: 'tool_call', toolCallId: 'call', title: 'Bash', kind: 'execute', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: output } }] } },
  } as IMessageAcpToolCall;
  const { container } = render(<MessageAcpToolCall message={message} />);
  expect(container.querySelector('pre')?.textContent).toBe(output);
  expect(container.querySelector('h1')).toBeNull();
  expect(container.querySelector('em')).toBeNull();
  expect(screen.getByText('tools.status.success')).toBeTruthy();
});

it('retains structured diffs for the shared file-change renderer', () => {
  const projected = projectAcpToolContent([{ type: 'diff', path: 'src/file.rs', oldText: 'old', newText: 'new' }]);
  expect(projected).toEqual([{ kind: 'diff', path: 'src/file.rs', oldText: 'old', newText: 'new' }]);
});

it('labels diffs without a path instead of rendering an empty file title', () => {
  render(<ToolContentView content={{ kind: 'diff', path: '', oldText: 'old', newText: 'new' }} />);
  expect(screen.getByTestId('file-diff').textContent).toBe('tools.unknownFile');
});
