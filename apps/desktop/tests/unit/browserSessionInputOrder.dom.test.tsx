import { Blob as NodeBlob } from 'node:buffer';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { BrowserSessionAction, BrowserSessionState } from '@sudowork/contracts/browser-session';
import BrowserSessionPanel from '@renderer/components/browser/BrowserSessionPanel';
import { isElectronDesktop } from '@renderer/utils/platform';

const host = vi.hoisted(() => ({ invoke: vi.fn(), stop: vi.fn(), error: vi.fn(), confirm: vi.fn(), info: vi.fn(), stream: vi.fn() }));

vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: vi.fn(() => false) }));

// Pixel decoding is exercised by the real React/Chrome workflow. This seam
// observes which target the host integration actually hands to that decoder.
vi.mock('@renderer/components/browser/WindowStreamSurface', () => ({
  default: ({ stream, ...props }: { stream: { targetEpoch: number } }) => {
    host.stream(stream, props);
    return <div data-testid='streamed-window'>{stream.targetEpoch}</div>;
  },
}));

function activeSession(): BrowserSessionState {
  return {
    browserSessionId: 'owned-browser',
    profileId: 'owned-profile',
    state: 'human',
    controlEpoch: 4,
    targetEpoch: 2,
    isController: true,
    isHeadless: true,
    transport: 'extension',
    capabilities: { conversationControl: true, pageView: true, windowView: false, persistentProfile: true },
    activeTargetId: 'owned-tab',
    tabs: [{ id: 'owned-tab', title: 'Form', url: 'https://example.test/' }],
    error: null,
  };
}
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ browserSession: { invoke: { invoke: (...args: unknown[]) => host.invoke(...args) } }, conversation: { stop: { invoke: (...args: unknown[]) => host.stop(...args) } } }));
vi.mock('react-i18next', () => {
  const t = (key: string) => key.split('.').at(-1);
  return { useTranslation: () => ({ t }) };
});
vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick, disabled, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button disabled={disabled} onClick={onClick} aria-label={rest['aria-label']} aria-pressed={rest['aria-pressed']}>
      {children}
    </button>
  ),
  Input: Object.assign(
    ({ value, onChange, onPressEnter, ...rest }: { value: string; onChange: (value: string) => void; onPressEnter?: () => void; 'aria-label'?: string; disabled?: boolean }) => (
      <input
        aria-label={rest['aria-label']}
        value={value}
        disabled={rest.disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onPressEnter?.();
        }}
      />
    ),
    {
      TextArea: ({
        value,
        onChange,
        ...rest
      }: {
        value: string;
        onChange: (value: string) => void;
        'aria-label'?: string;
        onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
        onCompositionStart?: React.CompositionEventHandler<HTMLTextAreaElement>;
        onCompositionEnd?: React.CompositionEventHandler<HTMLTextAreaElement>;
      }) => <textarea aria-label={rest['aria-label']} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={rest.onKeyDown} onCompositionStart={rest.onCompositionStart} onCompositionEnd={rest.onCompositionEnd} />,
    }
  ),
  Select: ({ options, value, onChange, ...rest }: { options: { value: string | number; label: string }[]; value: string | number; onChange: (value: string) => void; 'aria-label'?: string; disabled?: boolean }) => (
    <select aria-label={rest['aria-label']} disabled={rest.disabled} value={value} onChange={(event) => onChange(event.target.value)}>
      {options?.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Empty: () => null,
  Collapse: Object.assign(({ children }: { children: React.ReactNode }) => <div>{children}</div>, {
    Item: ({ header, children }: { header: React.ReactNode; children: React.ReactNode }) => (
      <details>
        <summary>{header}</summary>
        {children}
      </details>
    ),
  }),
  Spin: () => null,
  Modal: { confirm: host.confirm, info: host.info },
  Message: { error: host.error },
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  host.invoke.mockReset();
  host.stop.mockReset();
  host.error.mockReset();
  host.confirm.mockReset();
  host.info.mockReset();
  host.stream.mockReset();
  vi.mocked(isElectronDesktop).mockReturnValue(false);
});

it('shows the existing local Chrome target without opening another application window', async () => {
  vi.mocked(isElectronDesktop).mockReturnValue(true);
  const opened = vi.spyOn(window, 'open').mockReturnValue(null);
  const session = { ...activeSession(), transport: 'cdp' as const, isHeadless: false, capabilities: { ...activeSession().capabilities, nativeWindow: true } };
  host.invoke.mockImplementation(async () => ({ success: true, data: { session } }));
  render(<BrowserSessionPanel conversationId='owned-conversation' />);
  fireEvent.click(await screen.findByRole('button', { name: 'openNative' }));
  await waitFor(() => expect(host.invoke).toHaveBeenCalledWith({ conversationId: 'owned-conversation', action: { kind: 'select-tab', targetId: 'owned-tab', controlEpoch: 4, targetEpoch: 2 } }));
  expect(opened).not.toHaveBeenCalled();
});

it('keeps a remote browser in a separate viewer tab even on a Desktop host', async () => {
  vi.mocked(isElectronDesktop).mockReturnValue(true);
  const opened = vi.spyOn(window, 'open').mockReturnValue(null);
  const session = activeSession();
  host.invoke.mockImplementation(async () => ({ success: true, data: { session } }));
  render(<BrowserSessionPanel conversationId='owned-conversation' />);
  fireEvent.click(await screen.findByRole('button', { name: 'openViewer' }));
  expect(opened).toHaveBeenCalledWith(expect.stringContaining('#/browser-viewer/owned-conversation'), '_blank', 'noopener');
  expect(host.invoke.mock.calls.some(([input]) => input.action.kind === 'select-tab')).toBe(false);
});

it('waits for acknowledged control before showing the local browser', async () => {
  vi.mocked(isElectronDesktop).mockReturnValue(true);
  let session = { ...activeSession(), state: 'ai' as BrowserSessionState['state'], isController: false, isHeadless: false, capabilities: { ...activeSession().capabilities, nativeWindow: true } };
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => {
    if (action.kind === 'take') session = { ...session, state: 'human', isController: true, controlEpoch: 5 };
    return { success: true, data: { session } };
  });
  render(<BrowserSessionPanel conversationId='owned-conversation' />);
  fireEvent.click(await screen.findByRole('button', { name: 'openNative' }));
  await waitFor(() => expect(host.invoke).toHaveBeenCalledWith({ conversationId: 'owned-conversation', action: { kind: 'select-tab', targetId: 'owned-tab', controlEpoch: 5, targetEpoch: 2 } }));
  expect(host.invoke.mock.calls.findIndex(([input]) => input.action.kind === 'take')).toBeLessThan(host.invoke.mock.calls.findIndex(([input]) => input.action.kind === 'select-tab'));
});

it('acknowledges live drag only after the checked input reply for the attached viewer', async () => {
  const base = activeSession();
  const session = { ...base, isHeadless: false, capabilities: { ...base.capabilities, windowView: true, windowStream: true, liveDragInput: true } };
  let attachedViewer: string | undefined;
  let acknowledge: (() => void) | undefined;
  let isRejected = false;
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => {
    if (action.kind === 'attach') attachedViewer = action.viewerId;
    if (action.kind === 'input') {
      if (isRejected) return { success: false, msg: 'stale_browser_operation' };
      return new Promise((resolve) => {
        acknowledge = () => resolve({ success: true, data: { session } });
      });
    }
    return { success: true, data: { session, ...(action.kind === 'window-stream' ? { stream: { protocol: 'rfb', isViewOnly: true, password: 'fixture-only', socketPath: '/ws/browser/owned-conversation' } } : {}) } };
  });
  render(<BrowserSessionPanel conversationId='owned-conversation' isViewer />);
  await waitFor(() => expect(host.stream).toHaveBeenCalled());
  const [stream, props] = host.stream.mock.calls.at(-1)!;
  expect(stream.viewerId).toBe(attachedViewer);
  expect(props.isLiveDragSupported).toBe(true);
  await act(async () => props.onReady({ width: 1280, height: 900 }));
  const input = { kind: 'drag-stream', phase: 'begin', gestureId: crypto.randomUUID(), sequence: 0, viewerId: attachedViewer, x: 100, y: 200 };
  let isAcknowledged = false;
  const pending = props.onInput(input).then(() => {
    isAcknowledged = true;
  });
  await waitFor(() => expect(acknowledge).toBeTypeOf('function'));
  expect(isAcknowledged).toBe(false);
  expect(host.invoke.mock.calls.at(-1)?.[0]).toMatchObject({ action: { kind: 'input', surface: 'window', controlEpoch: 4, targetEpoch: 2, input } });
  await act(async () => {
    acknowledge!();
    await pending;
  });
  expect(isAcknowledged).toBe(true);
  isRejected = true;
  await expect(props.onInput({ ...input, phase: 'move', sequence: 1 })).rejects.toThrow();
  expect(host.error).toHaveBeenCalledTimes(1);
});

it('drains owned live input during a mode change while fresh-frame readiness is false', async () => {
  vi.stubGlobal('navigator', { maxTouchPoints: 1 });
  const base = activeSession();
  const session = { ...base, isHeadless: false, capabilities: { ...base.capabilities, dragInput: true, windowView: true, windowStream: true, liveDragInput: true } };
  const actions: BrowserSessionAction[] = [];
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => {
    actions.push(action);
    return { success: true, data: { session, ...(action.kind === 'window-stream' ? { stream: { protocol: 'rfb', isViewOnly: true, password: 'fixture-only', socketPath: '/ws/browser/owned-conversation' } } : {}) } };
  });
  render(<BrowserSessionPanel conversationId='owned-conversation' isViewer />);
  await waitFor(() => expect(host.stream).toHaveBeenCalled());
  const [stream, props] = host.stream.mock.calls.at(-1)!;
  await act(async () => props.onReady({ width: 1280, height: 900 }));
  fireEvent.click(screen.getByRole('button', { name: 'touchGesture' }));
  const input = { kind: 'drag-stream', phase: 'cancel', gestureId: crypto.randomUUID(), sequence: 2, viewerId: stream.viewerId, x: 100, y: 200 };
  await act(async () => props.onInput(input));
  expect(actions.filter((action) => action.kind === 'input')).toEqual([{ kind: 'input', input, surface: 'window', controlEpoch: 4, targetEpoch: 2 }]);
  await expect(props.onInput({ ...input, phase: 'move', sequence: 3 })).rejects.toThrow();
  expect(actions.filter((action) => action.kind === 'input')).toHaveLength(1);
  expect(host.error).not.toHaveBeenCalled();
});

it('discards a late stream response after navigation and opens the current target', async () => {
  const base = activeSession();
  let session = { ...base, isHeadless: false, capabilities: { ...base.capabilities, windowView: true, windowStream: true } };
  let deliverOldStream: (() => void) | undefined;
  const stream = { protocol: 'rfb', isViewOnly: true, password: 'fixture-only', socketPath: '/ws/browser/owned-conversation' };
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => {
    if (action.kind === 'window-stream' && action.targetEpoch === 2) {
      const oldSession = session;
      return new Promise((resolve) => {
        deliverOldStream = () => resolve({ success: true, data: { session: oldSession, stream } });
      });
    }
    if (action.kind === 'back') session = { ...session, targetEpoch: 3, tabs: [{ ...session.tabs[0], url: 'https://example.test/previous' }] };
    return { success: true, data: { session, ...(action.kind === 'window-stream' ? { stream } : {}), ...(action.kind === 'frame' ? { frame: { data: 'eA==', width: 100, height: 100, controlEpoch: session.controlEpoch, targetEpoch: session.targetEpoch } } : {}) } };
  });
  render(<BrowserSessionPanel conversationId='owned-conversation' isViewer />);
  await waitFor(() => expect(deliverOldStream).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: 'back' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'address' })).toHaveProperty('value', 'https://example.test/previous'));
  await act(async () => deliverOldStream?.());
  expect(host.stream.mock.calls.some(([value]) => value.targetEpoch === 2)).toBe(false);
  await waitFor(() => expect(screen.getByTestId('streamed-window').textContent).toBe('3'), { timeout: 2000 });
});

it('keeps the same browser when opening the full window separately and switching back to its page', async () => {
  const base = activeSession();
  const session = { ...base, isHeadless: false, capabilities: { ...base.capabilities, windowView: true } };
  const actions: BrowserSessionAction[] = [];
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => {
    actions.push(action);
    return { success: true, data: { session, ...(action.kind === 'frame' ? { frame: { data: 'eA==', width: 100, height: 100, surface: action.surface, controlEpoch: 4, targetEpoch: 2 } } : {}) } };
  });
  const panel = render(<BrowserSessionPanel conversationId='owned-conversation' />);
  const page = await screen.findByAltText('page');
  await waitFor(() => expect(page.getAttribute('src')).toMatch(/^data:/));
  expect(actions.filter((action) => action.kind === 'frame').every((action) => action.surface === 'page')).toBe(true);
  expect(screen.queryByRole('combobox', { name: 'viewMode' })).toBeNull();
  panel.unmount();

  render(<BrowserSessionPanel conversationId='owned-conversation' isViewer />);
  const windowImage = await screen.findByAltText('page');
  await waitFor(() => expect(windowImage.getAttribute('src')).toMatch(/^data:/));
  expect(actions.filter((action) => action.kind === 'attach').at(-1)).toMatchObject({ surface: 'window' });
  fireEvent.change(screen.getByRole('combobox', { name: 'viewMode' }), { target: { value: 'page' } });
  await waitFor(() => expect(actions.filter((action) => action.kind === 'attach').at(-1)).toMatchObject({ surface: 'page' }));
  await waitFor(() => expect(windowImage.getAttribute('src')).toMatch(/^data:/));
  expect(actions.some((action) => ['start', 'restart', 'take', 'return', 'navigate', 'connect-existing-extension'].includes(action.kind))).toBe(false);
  expect(host.error).not.toHaveBeenCalled();
});

it('discards an unfinished touch gesture when switching modes and waits for a fresh frame', async () => {
  vi.stubGlobal('navigator', { maxTouchPoints: 1 });
  const base = activeSession();
  const session = { ...base, capabilities: { ...base.capabilities, dragInput: true } };
  const actions: BrowserSessionAction[] = [];
  const frame = { data: 'eA==', width: 100, height: 100, controlEpoch: 4, targetEpoch: 2 };
  let isFrameHeld = false;
  let releaseFrame: (() => void) | undefined;
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => {
    if (action.kind === 'input') actions.push(action);
    if (action.kind === 'frame' && isFrameHeld) {
      return new Promise((resolve) => {
        releaseFrame = () => resolve({ success: true, data: { session, frame } });
      });
    }
    return { success: true, data: { session, ...(action.kind === 'frame' ? { frame } : {}) } };
  });
  render(<BrowserSessionPanel conversationId='owned-conversation' />);
  const image = await screen.findByAltText('page');
  await waitFor(() => expect(image.getAttribute('src')).toMatch(/^data:/));
  fireEvent.load(image);
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100, toJSON: () => ({}) });
  Object.defineProperty(image, 'setPointerCapture', { value: vi.fn(), configurable: true });
  const touch = (type: string, x: number, id: number) => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 20 });
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'touch' } });
    fireEvent(image, event);
  };
  const gesture = screen.getByRole('button', { name: 'touchGesture' });
  expect(gesture.getAttribute('aria-pressed')).toBe('false');
  touch('pointerdown', 10, 1);
  touch('pointermove', 80, 1);
  isFrameHeld = true;
  fireEvent.click(gesture);
  expect(gesture.getAttribute('aria-pressed')).toBe('true');
  touch('pointerup', 80, 1);
  expect(actions).toEqual([]);
  expect(image.getAttribute('src')).toBeNull();
  expect(gesture).toHaveProperty('disabled', true);
  await waitFor(() => expect(releaseFrame).toBeTypeOf('function'));
  await act(async () => {
    isFrameHeld = false;
    releaseFrame?.();
  });
  await waitFor(() => expect(image.getAttribute('src')).toMatch(/^data:/));
  fireEvent.load(image);
  expect(gesture).toHaveProperty('disabled', false);
  touch('pointerdown', 10, 2);
  touch('pointermove', 80, 2);
  touch('pointerup', 80, 2);
  await waitFor(() => expect(actions).toHaveLength(1));
  expect(actions[0]).toMatchObject({ kind: 'input', input: { kind: 'drag' }, controlEpoch: 4, targetEpoch: 2 });
  if (actions[0].kind === 'input' && actions[0].input.kind === 'drag') {
    expect(actions[0].input.points[0]).toEqual({ x: 10, y: 20 });
    expect(actions[0].input.points.at(-1)).toEqual({ x: 80, y: 20 });
  }
  expect(host.error).not.toHaveBeenCalled();
});

it('begins the clipboard write in the user gesture before the remote selection arrives', async () => {
  const base = activeSession();
  const session = { ...base, capabilities: { ...base.capabilities, selectionRead: true, clipboardText: true, dragInput: true } };
  let deliver!: (value: unknown) => void;
  const selection = new Promise((resolve) => {
    deliver = resolve;
  });
  let written = '';
  class SelectionClipboardItem {
    data: Record<string, Promise<Blob>>;
    constructor(data: Record<string, Promise<Blob>>) {
      this.data = data;
    }
  }
  const clipboard = {
    write: vi.fn(async (items: SelectionClipboardItem[]) => {
      written = await (await items[0].data['text/plain']).text();
    }),
  };
  vi.stubGlobal('ClipboardItem', SelectionClipboardItem);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { clipboard });
  const actions: BrowserSessionAction[] = [];
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => {
    actions.push(action);
    if (action.kind === 'input' && action.input.kind === 'copy-selection') return selection;
    return { success: true, data: { session, ...(action.kind === 'frame' ? { frame: { data: 'eA==', width: 100, height: 100, controlEpoch: session.controlEpoch, targetEpoch: session.targetEpoch } } : {}) } };
  });
  render(<BrowserSessionPanel conversationId='owned-conversation' />);
  const image = await screen.findByAltText('page');
  await waitFor(() => expect(image.getAttribute('src')).toMatch(/^data:/));
  fireEvent.load(image);
  fireEvent.click(screen.getByRole('button', { name: 'copySelection' }));
  expect(clipboard.write).toHaveBeenCalledOnce();
  expect(written).toBe('');
  await waitFor(() => expect(actions.filter((action) => action.kind === 'input')).toHaveLength(1));
  await act(async () => {
    deliver({ success: true, data: { session, selection: { text: 'Selected 中文 phrase', isAvailable: true } } });
  });
  await waitFor(() => expect(written).toBe('Selected 中文 phrase'));
  expect(actions.filter((action) => action.kind === 'input')).toEqual([{ kind: 'input', input: { kind: 'copy-selection' }, surface: 'page', controlEpoch: 4, targetEpoch: 2 }]);
  expect(host.stop).not.toHaveBeenCalled();
  expect(actions.some((action) => action.kind === 'take' || action.kind === 'return')).toBe(false);
});

it('rejects clipboard text for an old tab after a permission delay and accepts a fresh edit in the new tab', async () => {
  const base = activeSession();
  let session = { ...base, capabilities: { ...base.capabilities, clipboardText: true, dragInput: true }, tabs: [...base.tabs, { id: 'other-tab', title: 'Other', url: 'https://example.test/other' }] };
  let read!: (value: string) => void;
  const clipboard = {
    readText: vi.fn(
      () =>
        new Promise<string>((resolve) => {
          read = resolve;
        })
    ),
  };
  vi.stubGlobal('navigator', { clipboard });
  const inputs: BrowserSessionAction[] = [];
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => {
    if (action.kind === 'select-tab') session = { ...session, activeTargetId: action.targetId, targetEpoch: session.targetEpoch + 1 };
    if (action.kind === 'input') inputs.push(action);
    return { success: true, data: { session, ...(action.kind === 'frame' ? { frame: { data: 'eA==', width: 100, height: 100, controlEpoch: session.controlEpoch, targetEpoch: session.targetEpoch } } : {}) } };
  });
  render(<BrowserSessionPanel conversationId='owned-conversation' />);
  const image = await screen.findByAltText('page');
  await waitFor(() => expect(image.getAttribute('src')).toMatch(/^data:/));
  fireEvent.load(image);
  fireEvent.click(screen.getByRole('button', { name: 'pasteClipboard' }));
  expect(clipboard.readText).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Other' }));
  await waitFor(() => expect((screen.getByLabelText('address') as HTMLInputElement).value).toBe('https://example.test/other'));
  await waitFor(() => expect(image.getAttribute('src')).toMatch(/^data:/));
  fireEvent.load(image);
  await act(async () => {
    read('STALE_CLIPBOARD_FOR_PREVIOUS_TAB');
  });
  await waitFor(() => expect(host.error).toHaveBeenCalled());
  expect(inputs).toEqual([]);
  fireEvent.change(screen.getByLabelText('text'), { target: { value: 'Fresh 中文\nnew tab' } });
  fireEvent.click(screen.getByRole('button', { name: 'insert' }));
  await waitFor(() => expect(inputs).toHaveLength(1));
  expect(inputs).toEqual([{ kind: 'input', input: { kind: 'paste', text: 'Fresh 中文\nnew tab' }, surface: 'page', controlEpoch: 4, targetEpoch: 3 }]);
});

it('pastes Windows clipboard newlines as one trusted multiline input operation', async () => {
  const base = activeSession();
  const session = { ...base, capabilities: { ...base.capabilities, clipboardText: true } };
  vi.stubGlobal('navigator', { clipboard: { readText: vi.fn(async () => 'First 中文\r\nSecond line ✓') } });
  const inputs: BrowserSessionAction[] = [];
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => {
    if (action.kind === 'input') inputs.push(action);
    return { success: true, data: { session, ...(action.kind === 'frame' ? { frame: { data: 'eA==', width: 100, height: 100, controlEpoch: 4, targetEpoch: 2 } } : {}) } };
  });
  render(<BrowserSessionPanel conversationId='owned-conversation' />);
  const image = await screen.findByAltText('page');
  await waitFor(() => expect(image.getAttribute('src')).toMatch(/^data:/));
  fireEvent.load(image);
  fireEvent.click(screen.getByRole('button', { name: 'pasteClipboard' }));
  await waitFor(() => expect(inputs).toHaveLength(1));
  expect(inputs).toEqual([{ kind: 'input', input: { kind: 'paste', text: 'First 中文\nSecond line ✓' }, surface: 'page', controlEpoch: 4, targetEpoch: 2 }]);
  expect(host.stop).not.toHaveBeenCalled();
});

it('keeps IME confirmation and newlines local, then inserts the completed multiline text once', async () => {
  const base = activeSession();
  const session = { ...base, capabilities: { ...base.capabilities, clipboardText: true } };
  const inputs: BrowserSessionAction[] = [];
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => {
    if (action.kind === 'input') inputs.push(action);
    return { success: true, data: { session, ...(action.kind === 'frame' ? { frame: { data: 'eA==', width: 100, height: 100, controlEpoch: 4, targetEpoch: 2 } } : {}) } };
  });
  render(<BrowserSessionPanel conversationId='owned-conversation' />);
  const image = await screen.findByAltText('page');
  await waitFor(() => expect(image.getAttribute('src')).toMatch(/^data:/));
  fireEvent.load(image);
  const editor = screen.getByLabelText('text');
  fireEvent.compositionStart(editor);
  fireEvent.change(editor, { target: { value: '中文输入' } });
  fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
  fireEvent.compositionEnd(editor);
  fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, keyCode: 229 });
  fireEvent.keyDown(editor, { key: 'Enter', metaKey: true, isComposing: true });
  fireEvent.keyDown(editor, { key: 'Enter' });
  fireEvent.change(editor, { target: { value: '中文输入\nSecond line ✓' } });
  await act(async () => {});
  expect(inputs).toEqual([]);
  fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(inputs).toHaveLength(1));
  expect(inputs).toEqual([{ kind: 'input', input: { kind: 'paste', text: '中文输入\nSecond line ✓' }, surface: 'page', controlEpoch: 4, targetEpoch: 2 }]);
  expect((editor as HTMLTextAreaElement).value).toBe('');
});

it('pans the enlarged view locally and sends mapped input only after explicitly returning to interaction', async () => {
  const session = activeSession();
  const inputs: unknown[] = [];
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => {
    if (action.kind === 'input') inputs.push(action.input);
    return { success: true, data: { session, ...(action.kind === 'frame' ? { frame: { data: 'eA==', width: 1280, height: 720, controlEpoch: 4, targetEpoch: 2 } } : {}) } };
  });
  render(<BrowserSessionPanel conversationId='owned-conversation' />);
  const image = await screen.findByAltText('page');
  await waitFor(() => expect(image.getAttribute('src')).toMatch(/^data:/));
  Object.defineProperties(image, { naturalWidth: { value: 1280 }, naturalHeight: { value: 720 }, setPointerCapture: { value: vi.fn() } });
  fireEvent.load(image);
  fireEvent.change(screen.getByRole('combobox', { name: 'imageZoom' }), { target: { value: '1' } });
  expect(image.style.width).toBe('1280px');
  expect(image.style.pointerEvents).toBe('none');
  const viewport = screen.getByLabelText('imageViewport');
  const pointer = (target: HTMLElement, type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    fireEvent(target, event);
  };
  pointer(viewport, 'pointerdown', 300, 200);
  pointer(viewport, 'pointermove', 100, 150);
  pointer(viewport, 'pointerup', 100, 150);
  expect(viewport.scrollLeft).toBe(200);
  expect(viewport.scrollTop).toBe(50);
  // Guard the SDK send callback as well as CSS: synthetic/stale events cannot
  // turn a local pan, wheel or keystroke into a remote browser operation.
  pointer(image, 'pointerdown', 200, 100);
  pointer(image, 'pointerup', 200, 100);
  fireEvent.wheel(image, { deltaY: 100 });
  fireEvent.keyDown(image, { key: 'Enter' });
  await act(async () => {});
  expect(inputs).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'interactPage' }));
  expect(image.style.pointerEvents).toBe('auto');
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ x: -200, y: -50, width: 1280, height: 720, left: -200, top: -50, right: 1080, bottom: 670, toJSON: () => ({}) });
  pointer(image, 'pointerdown', 100, 150);
  pointer(image, 'pointerup', 100, 150);
  await waitFor(() => expect(inputs).toEqual([{ kind: 'click', x: 300, y: 200 }]));
  expect(host.invoke.mock.calls.some(([request]) => ['start', 'navigate', 'take'].includes(request.action.kind))).toBe(false);
});

it('asks for explicit personal profile selection before connecting and reports unknown launch mode', async () => {
  const stopped = { ...activeSession(), state: 'stopped' as const, capabilities: { ...activeSession().capabilities, existingExtension: true, lifecycle: true } };
  const selected = { sessionId: 'extension-selected-run', profileId: 'selected-profile' };
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => ({
    success: true,
    data: action.kind === 'connect-existing-extension' ? { session: { ...activeSession(), isHeadless: null, personalExtension: { ...selected, isHeadless: null } } } : { session: stopped, ...(action.kind === 'inspect-existing-extension' ? { existingExtension: selected } : {}) },
  }));
  render(<BrowserSessionPanel conversationId='owned-conversation' />);
  fireEvent.click(await screen.findByText('browserSource'));
  fireEvent.click(await screen.findByRole('button', { name: 'personalConnect' }));
  await waitFor(() => expect(host.confirm).toHaveBeenCalledOnce());
  expect(host.invoke.mock.calls.some(([request]) => request.action.kind === 'connect-existing-extension')).toBe(false);
  await act(async () => {
    await host.confirm.mock.calls[0][0].onOk();
  });
  expect(host.invoke.mock.calls.find(([request]) => request.action.kind === 'connect-existing-extension')?.[0].action).toEqual({ kind: 'connect-existing-extension', ...selected });
  expect(await screen.findByText('modeUnknown')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'stop' })).toBeNull();
  expect(screen.getByRole('button', { name: 'personalDisconnect' }).hasAttribute('disabled')).toBe(false);
});

it('lets the host recover a stopped personal reference without a retained human controller', async () => {
  const recovered: BrowserSessionState = {
    ...activeSession(),
    state: 'stopped',
    isController: false,
    isHumanControlHeld: false,
    isHeadless: null,
    personalExtension: { sessionId: 'old-run', profileId: 'same-personal-profile', isHeadless: null },
    capabilities: { ...activeSession().capabilities, existingExtension: true, lifecycle: false },
    error: 'browser_restart_requires_observation',
  };
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => ({ success: true, data: { session: action.kind === 'disconnect-existing-extension' ? { ...recovered, personalExtension: null, isController: true, isHumanControlHeld: true, error: null } : recovered } }));
  render(<BrowserSessionPanel conversationId='owned-conversation' />);
  const disconnect = await screen.findByRole('button', { name: 'personalDisconnect' });
  expect(disconnect.hasAttribute('disabled')).toBe(false);
  fireEvent.click(disconnect);
  expect(host.invoke.mock.calls.some(([request]) => request.action.kind === 'disconnect-existing-extension')).toBe(false);
  await act(async () => {
    await host.confirm.mock.calls[0][0].onOk();
  });
  const sent = host.invoke.mock.calls.find(([request]) => request.action.kind === 'disconnect-existing-extension')?.[0].action;
  expect(sent).toEqual({ kind: 'disconnect-existing-extension', controlEpoch: recovered.controlEpoch, targetEpoch: recovered.targetEpoch });
  expect(screen.queryByRole('button', { name: 'personalDisconnect' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'return' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'take' })).toBeNull();
});

it('recovers after a lifecycle transition and reads frame state without reattaching every tick', async () => {
  const session = activeSession();
  const actions: string[] = [];
  let states = 0;
  let frames = 0;
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => {
    actions.push(action.kind);
    if (action.kind === 'state') {
      states++;
      if (states === 1) {
        return { success: true, data: { session: { ...session, state: 'pausing', activeTargetId: null, capabilities: { ...session.capabilities, pageView: false } } } };
      }
    }
    if (action.kind === 'frame') frames++;
    return {
      success: true,
      data: {
        session,
        ...(action.kind === 'frame' ? { frame: { data: 'eA==', width: 100, height: 100, controlEpoch: session.controlEpoch, targetEpoch: session.targetEpoch } } : {}),
      },
    };
  });
  render(<BrowserSessionPanel conversationId='owned-conversation' />);
  await waitFor(() => expect(frames).toBeGreaterThanOrEqual(3), { timeout: 2000 });
  expect(states).toBe(2);
  expect(actions.filter((kind) => kind === 'attach')).toHaveLength(1);
  expect(actions.slice(0, 5)).toEqual(['state', 'state', 'attach', 'frame', 'frame']);
});

it('preserves click, select-all and Unicode typing over a slow connection without a second handoff UI', async () => {
  const session: BrowserSessionState = {
    browserSessionId: 'owned-browser',
    profileId: 'owned-profile',
    state: 'human',
    controlEpoch: 4,
    targetEpoch: 2,
    isController: true,
    isHeadless: true,
    transport: 'extension',
    capabilities: { conversationControl: true, pageView: true, windowView: false, persistentProfile: true },
    activeTargetId: 'owned-tab',
    tabs: [{ id: 'owned-tab', title: 'Form', url: 'https://example.test/' }],
    error: null,
  };
  let releaseClick!: () => void;
  const clickDelivery = new Promise<void>((resolve) => {
    releaseClick = resolve;
  });
  const applied: string[] = [];
  let value = 'AI_BEFORE';
  let isSelected = false;
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => {
    if (action.kind === 'input') {
      if (action.input.kind === 'click') {
        await clickDelivery;
        isSelected = false;
      }
      if (action.input.kind === 'key' && action.input.key === 'SelectAll') isSelected = true;
      if (action.input.kind === 'text') {
        await clickDelivery;
        value = isSelected ? action.input.text : action.input.text + value;
      }
      applied.push(action.input.kind);
    }
    return { success: true, data: { session: { ...session }, ...(action.kind === 'frame' ? { frame: { data: 'eA==', width: 100, height: 100, controlEpoch: 4, targetEpoch: 2 } } : {}) } };
  });
  render(<BrowserSessionPanel conversationId='owned-conversation' />);
  const image = await screen.findByAltText('page');
  await waitFor(() => expect(image.getAttribute('src')).toMatch(/^data:/));
  fireEvent.load(image);
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100, toJSON: () => ({}) });
  Object.defineProperty(image, 'setPointerCapture', { value: vi.fn(), configurable: true });
  for (const type of ['pointerdown', 'pointerup']) {
    const event = new MouseEvent(type, { bubbles: true, clientX: 20, clientY: 20 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    fireEvent(image, event);
  }
  await waitFor(() => expect(host.invoke.mock.calls.some(([request]) => request.action.kind === 'input')).toBe(true));
  fireEvent.keyDown(image, { key: 'a', ctrlKey: true });
  fireEvent.change(screen.getByRole('textbox', { name: 'text' }), { target: { value: 'HUMAN 中文' } });
  fireEvent.click(screen.getByRole('button', { name: 'insert' }));
  expect(screen.queryByRole('button', { name: 'return' })).toBeNull();
  await act(async () => {
    await Promise.resolve();
  });
  const pendingWrites = host.invoke.mock.calls.map(([request]) => request.action).filter((action) => action.kind === 'input' || action.kind === 'return');
  expect(pendingWrites.map((action) => (action.kind === 'input' ? action.input.kind : action.kind))).toEqual(['click']);
  await act(async () => {
    releaseClick();
  });
  await waitFor(() => expect(applied).toEqual(['click', 'key', 'text']));
  expect(value).toBe('HUMAN 中文');
  expect(host.error).not.toHaveBeenCalled();
});

it('uses the existing interrupt for a page gesture and never replays it after the barrier', async () => {
  const session = { ...activeSession(), state: 'ai' as BrowserSessionState['state'], isController: false };
  const inputs: unknown[] = [];
  let acknowledge!: () => void;
  host.stop.mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = () => {
          session.state = 'human';
          session.isController = true;
          session.controlEpoch++;
          resolve({ success: true });
        };
      })
  );
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => {
    if (action.kind === 'input') inputs.push(action.input);
    return { success: true, data: { session: { ...session }, ...(action.kind === 'frame' ? { frame: { data: 'eA==', width: 100, height: 100, controlEpoch: session.controlEpoch, targetEpoch: session.targetEpoch } } : {}) } };
  });
  render(<BrowserSessionPanel conversationId='owned-conversation' />);
  const image = await screen.findByAltText('page');
  await waitFor(() => expect(image.getAttribute('src')).toMatch(/^data:/));
  fireEvent.load(image);
  const viewport = screen.getByLabelText('imageViewport');
  fireEvent.pointerDown(viewport, { button: 0 });
  expect(host.stop).toHaveBeenCalledWith({ conversation_id: 'owned-conversation' });
  expect(inputs).toEqual([]);
  fireEvent.pointerDown(viewport, { button: 0 });
  expect(host.stop).toHaveBeenCalledOnce();
  await act(async () => {
    acknowledge();
  });
  await waitFor(() => expect(image.getAttribute('src')).toMatch(/^data:/));
  fireEvent.load(image);
  expect(inputs).toEqual([]);
  expect(screen.queryByRole('button', { name: 'return' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'take' })).toBeNull();
  expect(host.invoke.mock.calls.some(([request]) => ['take', 'return', 'navigate', 'start'].includes(request.action.kind))).toBe(false);
});
