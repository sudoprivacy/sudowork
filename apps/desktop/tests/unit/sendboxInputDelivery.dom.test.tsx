import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { InputDelivery } from '@sudowork/contracts/input-delivery';
import SendBox from '@renderer/components/Sendbox';
import type { DomSnippet } from '@renderer/pages/conversation/preview/context';

const host = vi.hoisted(() => ({ send: vi.fn(), flush: vi.fn(), stop: vi.fn(), recall: vi.fn(), setSendBoxHandler: vi.fn(), clearDomSnippets: vi.fn(), domSnippets: [] as DomSnippet[], error: vi.fn() }));
vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ skillHub: {} }));
vi.mock('@renderer/pages/conversation/preview', () => ({ usePreviewContext: () => host }));
vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: () => false, isWebBridgeAvailable: () => false }));
vi.mock('@renderer/utils/emitter', () => ({ addEventListener: () => () => {} }));
vi.mock('@renderer/hooks/useInputFocusRing', () => ({ useInputFocusRing: () => ({}) }));
vi.mock('@renderer/hooks/usePasteService', () => ({ usePasteService: () => ({ onPaste: () => {}, onFocus: () => {} }) }));
vi.mock('@renderer/hooks/useDragUpload', () => ({ useDragUpload: () => ({ isFileDragging: false, dragHandlers: {} }) }));
vi.mock('@renderer/services/FileService', () => ({ allSupportedExts: [] }));
vi.mock('@renderer/pages/guid/components/SkillSelectorPopover', () => ({ default: () => null }));
vi.mock('@renderer/components/ContextMenu', () => ({ default: () => null }));
vi.mock('@renderer/components/SlashCommandMenu', () => ({ default: () => null }));
vi.mock('@arco-design/web-react', () => ({
  Message: { error: host.error, warning: vi.fn() },
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ onClick, disabled, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button aria-label={props['aria-label']} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Input: {
    TextArea: ({
      value,
      onChange,
      onKeyDown,
      onCompositionStartCapture,
      onCompositionEndCapture,
    }: {
      value: string;
      onChange: (value: string) => void;
      onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
      onCompositionStartCapture: React.CompositionEventHandler<HTMLTextAreaElement>;
      onCompositionEndCapture: React.CompositionEventHandler<HTMLTextAreaElement>;
    }) => <textarea value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} onCompositionStartCapture={onCompositionStartCapture} onCompositionEndCapture={onCompositionEndCapture} />,
  },
}));

function Composer({ isRunning = true }: IComposerProps) {
  const [text, setText] = useState('');
  return (
    <SendBox
      value={text}
      onChange={setText}
      loading={isRunning}
      allowSubmitWhileRunning
      isInputDeliveryEnabled
      queuedInputs={isRunning ? [{ id: 'queued', preview: 'pending context', delivery: 'queue' }] : []}
      onSend={(message: string, skills?: string[], delivery?: InputDelivery) => host.send(message, skills, delivery)}
      onStop={host.stop}
      onFlushInput={host.flush}
      onDequeueLast={host.recall}
      defaultMultiLine
      lockMultiLine
    />
  );
}

afterEach(cleanup);
beforeEach(() => {
  host.send.mockReset().mockResolvedValue(undefined);
  host.flush.mockReset().mockResolvedValue(undefined);
  host.stop.mockReset().mockResolvedValue(undefined);
  host.recall.mockReset().mockResolvedValue(undefined);
  host.domSnippets = [];
});

it('uses Enter to steer, Tab to queue and Esc to flush without cancellation', async () => {
  render(<Composer />);
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'steering context' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(host.send).toHaveBeenLastCalledWith('steering context', [], 'steer'));
  await act(async () => {});
  fireEvent.change(input, { target: { value: 'next turn' } });
  fireEvent.keyDown(input, { key: 'Tab' });
  await waitFor(() => expect(host.send).toHaveBeenLastCalledWith('next turn', [], 'queue'));
  fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() => expect(host.flush).toHaveBeenCalledTimes(1));
  expect(host.stop).not.toHaveBeenCalled();
  expect(screen.getByTestId('input-delivery-hint').textContent).toContain('flushHint');
});

it('queues a webpage fragment without text and does not recall over that unsent draft', async () => {
  host.domSnippets = [{ id: 'selected-card', tag: 'article', html: '<article>Selected evidence</article>' }];
  render(<Composer />);
  const input = screen.getByRole('textbox');
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(host.recall).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Tab' });
  await waitFor(() => expect(host.send).toHaveBeenCalledWith('\n\n---\nDOM Snippet (article):\n```html\n<article>Selected evidence</article>\n```', [], 'queue'));
});

it('preserves IME composition and native copy while keeping Ctrl+C cancellation available', async () => {
  render(<Composer />);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '正在输入' } });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.keyDown(input, { key: 'Tab' });
  expect(host.send).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  input.setSelectionRange(0, 2);
  fireEvent.keyDown(input, { key: 'c', ctrlKey: true });
  expect(host.stop).not.toHaveBeenCalled();
  input.setSelectionRange(2, 2);
  fireEvent.keyDown(input, { key: 'c', ctrlKey: true });
  await waitFor(() => expect(host.stop).toHaveBeenCalledTimes(1));
});

it('restores a refused draft without overwriting text typed during admission', async () => {
  let reject!: (error: Error) => void;
  host.send.mockReturnValueOnce(
    new Promise((_resolve, fail) => {
      reject = fail;
    })
  );
  render(<Composer />);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'first draft' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.change(input, { target: { value: 'new typing' } });
  await act(async () => {
    reject(new Error('not admitted'));
  });
  expect(input.value).toBe('new typing\n\nfirst draft');
});

it.each([true, false])('waits for attachment preparation before Esc but lets Ctrl+C cancel immediately (running: %s)', async (isRunning) => {
  let resolve!: () => void;
  host.send.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done;
    })
  );
  render(<Composer isRunning={isRunning} />);
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'queued attachment' } });
  fireEvent.keyDown(input, { key: isRunning ? 'Tab' : 'Enter' });
  fireEvent.keyDown(input, { key: 'Escape' });
  await act(async () => {});
  expect(host.flush).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'c', ctrlKey: true });
  expect(host.stop).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolve();
  });
  expect(host.flush).not.toHaveBeenCalled();
});

interface IComposerProps {
  isRunning?: boolean;
}
