import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MarkdownView from '@renderer/components/Markdown';
import CodeView from '@renderer/components/CodeView';

const host = vi.hoisted(() => ({ copy: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@renderer/context/ConversationContext', () => ({ useConversationContextSafe: () => undefined }));
vi.mock('@renderer/components/WorkspaceFileLink', () => ({ default: () => null }));
vi.mock('@renderer/components/LocalImageView', () => ({ default: () => null }));
vi.mock('@renderer/utils/platform', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@renderer/utils/clipboard', () => ({ copyText: host.copy }));
vi.mock('@arco-design/web-react', async (original) => ({ ...(await original<object>()), Message: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);

it('keeps large tool inputs complete without constructing thousands of syntax-token nodes', () => {
  const source = 'line of raw tool output\n'.repeat(10000);
  const { container } = render(<CodeView source={source} language='json' />);
  const pre = container.querySelector('pre')!;
  expect(pre.textContent).toBe(source);
  expect(pre.querySelectorAll('*')).toHaveLength(1);
});

async function surface(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector('.markdown-shadow')?.shadowRoot?.querySelector('[data-code-view]')).toBeTruthy());
  return container.querySelector('.markdown-shadow')!.shadowRoot!;
}

it('preserves code fold state and DOM identity while more prose streams', async () => {
  const source = '```js\nconst answer = 42;\n```\n\nWorking';
  const view = render(<MarkdownView>{source}</MarkdownView>);
  const shadow = await surface(view.container);
  const block = shadow.querySelector('[data-code-view]');
  fireEvent.click(shadow.querySelector('button[aria-expanded="true"]')!);
  expect(block?.querySelector('pre')).toBeNull();
  view.rerender(<MarkdownView>{source + ' on the next step'}</MarkdownView>);
  expect(shadow.querySelector('[data-code-view]')).toBe(block);
  expect(block?.querySelector('pre')).toBeNull();
  expect(shadow.textContent).toContain('on the next step');
});

it('displays and copies JSON source without changing large integers, spacing or paths', async () => {
  const raw = '{"id":9007199254740993, "path":"file:///tmp/test", "duplicate":1, "duplicate":2}\n';
  const view = render(<MarkdownView>{'```json\n' + raw + '```'}</MarkdownView>);
  const shadow = await surface(view.container);
  expect(shadow.querySelector('pre')?.textContent).toBe(raw);
  fireEvent.click(shadow.querySelector('button[aria-label="common.copy"]')!);
  await waitFor(() => expect(host.copy).toHaveBeenCalledWith(raw));
});

it('honors hidden copy controls without changing collapse controls', async () => {
  const view = render(<MarkdownView hiddenCodeCopyButton>{'```text\nsource\n```'}</MarkdownView>);
  const shadow = await surface(view.container);
  expect(shadow.querySelector('button[aria-label="common.copy"]')).toBeNull();
  expect(shadow.querySelector('button[aria-expanded="true"]')).toBeTruthy();
});

it('does not normalize literal Windows image examples inside a code fence', async () => {
  const source = '![example](C:\\Users\\example\\image.png)\n';
  const view = render(<MarkdownView>{'```md\n' + source + '```'}</MarkdownView>);
  const shadow = await surface(view.container);
  expect(shadow.querySelector('pre')?.textContent).toBe(source);
});
