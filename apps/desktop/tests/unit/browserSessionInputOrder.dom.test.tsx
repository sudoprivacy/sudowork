import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { BrowserSessionAction, BrowserSessionState } from '@sudowork/contracts/browser-session';
import BrowserSessionPanel from '@renderer/components/browser/BrowserSessionPanel';

const host = vi.hoisted(() => ({ invoke: vi.fn(), error: vi.fn(), confirm: vi.fn(), info: vi.fn() }));

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
    capabilities: { pageView: true, windowView: false, persistentProfile: true },
    activeTargetId: 'owned-tab',
    tabs: [{ id: 'owned-tab', title: 'Form', url: 'https://example.test/' }],
    error: null,
  };
}
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ browserSession: { invoke: { invoke: (...args: unknown[]) => host.invoke(...args) } } }));
vi.mock('react-i18next', () => {
  const t = (key: string) => key.split('.').at(-1);
  return { useTranslation: () => ({ t }) };
});
vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick, disabled, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button disabled={disabled} onClick={onClick} aria-label={rest['aria-label']}>
      {children}
    </button>
  ),
  Input: ({ value, onChange, onPressEnter, ...rest }: { value: string; onChange: (value: string) => void; onPressEnter?: () => void; 'aria-label'?: string; disabled?: boolean }) => (
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
  Select: () => null,
  Empty: () => null,
  Spin: () => null,
  Modal: { confirm: host.confirm, info: host.info },
  Message: { error: host.error },
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  host.invoke.mockReset();
  host.error.mockReset();
  host.confirm.mockReset();
  host.info.mockReset();
});

it('asks for explicit personal profile selection before connecting and reports unknown launch mode', async () => {
  const stopped = { ...activeSession(), state: 'stopped' as const, capabilities: { ...activeSession().capabilities, existingExtension: true, lifecycle: true } };
  const selected = { sessionId: 'extension-selected-run', profileId: 'selected-profile' };
  host.invoke.mockImplementation(async ({ action }: { action: BrowserSessionAction }) => ({
    success: true,
    data: action.kind === 'connect-existing-extension' ? { session: { ...activeSession(), isHeadless: null, personalExtension: { ...selected, isHeadless: null } } } : { session: stopped, ...(action.kind === 'inspect-existing-extension' ? { existingExtension: selected } : {}) },
  }));
  render(<BrowserSessionPanel conversationId='owned-conversation' />);
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
  expect(screen.getByRole('button', { name: 'return' }).hasAttribute('disabled')).toBe(false);
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

it('preserves click, select-all and Unicode typing before returning control over a slow connection', async () => {
  const session: BrowserSessionState = {
    browserSessionId: 'owned-browser',
    profileId: 'owned-profile',
    state: 'human',
    controlEpoch: 4,
    targetEpoch: 2,
    isController: true,
    isHeadless: true,
    transport: 'extension',
    capabilities: { pageView: true, windowView: false, persistentProfile: true },
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
    if (action.kind === 'return') {
      applied.push('return');
      session.state = 'ai';
      session.isController = false;
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
  fireEvent.click(screen.getByRole('button', { name: 'return' }));
  await act(async () => {
    await Promise.resolve();
  });
  const pendingWrites = host.invoke.mock.calls.map(([request]) => request.action).filter((action) => action.kind === 'input' || action.kind === 'return');
  expect(pendingWrites.map((action) => (action.kind === 'input' ? action.input.kind : action.kind))).toEqual(['click']);
  await act(async () => {
    releaseClick();
  });
  await waitFor(() => expect(applied).toEqual(['click', 'key', 'text', 'return']));
  expect(value).toBe('HUMAN 中文');
  expect(host.error).not.toHaveBeenCalled();
});
