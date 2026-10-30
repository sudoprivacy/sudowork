import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserSessionActionSchema } from '@sudowork/contracts/browser-session';
import { LocalBrowserSessions } from '@process/services/browserPanel/LocalBrowserSessions';
import { LocalAgentToolControl } from '@process/services/browserPanel/LocalAgentToolControl';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), close: vi.fn(), start: vi.fn() }));
vi.mock('@process/services/browserPanel/LocalBrowserWorker', () => ({
  LocalBrowserWorker: class {
    isDisconnected = false;
    invoke = mocks.invoke;
    close = mocks.close;
    start = mocks.start;
  },
}));
let state: {
  browserSessionId: string;
  profileId: string;
  state: string;
  controlEpoch: number;
  targetEpoch: number;
  isController: boolean;
  isHumanControlHeld: boolean;
  isHeadless: boolean | null;
  personalExtension?: { sessionId: string; profileId: string; isHeadless: boolean | null };
  transport: string;
  capabilities: { authorizedPageLaunch?: boolean; pageView: boolean; windowView: boolean; persistentProfile: boolean };
  activeTargetId: string | null;
  tabs: { id: string; title: string; url: string }[];
  error: null;
};
const hosts: LocalBrowserSessions[] = [];
const input = { url: 'http://127.0.0.1:8765/review/binding/', cookie: { name: 'review', value: 'a'.repeat(64), url: 'http://127.0.0.1:8765/review/binding/', path: '/review/binding/', httpOnly: true as const, sameSite: 'Strict' as const, expires: Date.now() / 1000 + 1800 } };
function fixture(isConversationCurrent?: (conversationId: string) => Promise<boolean>) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'authorized-browser-page-'));
  const control = new LocalAgentToolControl(() => path.join(root, 'control.json'));
  const host = new LocalBrowserSessions({ root, control, runtime: async () => '/private/python', tools: () => [], onReturn: async () => {}, isConversationCurrent });
  hosts.push(host);
  return { host, control };
}
beforeEach(() => {
  vi.clearAllMocks();
  state = {
    browserSessionId: 'owned',
    profileId: 'profile',
    state: 'stopped',
    controlEpoch: 0,
    targetEpoch: 0,
    isController: false,
    isHumanControlHeld: false,
    isHeadless: true,
    transport: 'cdp',
    capabilities: { authorizedPageLaunch: true, pageView: true, windowView: false, persistentProfile: true },
    activeTargetId: null,
    tabs: [],
    error: null,
  };
  mocks.invoke.mockImplementation(async (action) => {
    if (action.kind === 'start') state = { ...state, state: 'human', isController: true, isHumanControlHeld: true, isHeadless: action.isHeadless, controlEpoch: state.controlEpoch + 1 };
    if (action.kind === 'take') state = { ...state, state: 'human', isController: true, isHumanControlHeld: true, controlEpoch: state.controlEpoch + 1 };
    if (action.kind === 'open-authorized-page') state = { ...state, activeTargetId: 'review', targetEpoch: state.targetEpoch + 1 };
    return { session: structuredClone(state) };
  });
});
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('private browser host review launch', () => {
  it('advertises a native window only for a running local browser with a window', async () => {
    const { host } = fixture();
    expect((await host.invoke('conversation', { kind: 'state' })).session.capabilities.nativeWindow).not.toBe(true);
    await host.openAuthorizedPage('conversation', input);
    expect((await host.invoke('conversation', { kind: 'state' })).session.capabilities.nativeWindow).toBe(true);
    state.isHeadless = true;
    expect((await host.invoke('conversation', { kind: 'state' })).session.capabilities.nativeWindow).toBe(false);
  });
  it('closes a retired account browser before admitting the new account and keeps same-account ownership enforced', async () => {
    let isCurrent = true;
    const { host, control } = fixture(async () => isCurrent);
    await host.openAuthorizedPage('old-account', input);
    await expect(host.prepareUserMessage('new-account')).rejects.toThrow('another conversation');
    expect(mocks.close).not.toHaveBeenCalled();
    isCurrent = false;
    expect(await host.prepareUserMessage('new-account')).toBe(2);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(control.status()).toEqual({ epoch: 2, state: 'ai' });
    expect(mocks.invoke.mock.calls.some(([action]) => action.kind === 'return')).toBe(false);
  });

  it('allows explicit personal Chrome presentation without claiming a known headless browser has a window', async () => {
    const { host } = fixture();
    state.state = 'human';
    state.isHeadless = null;
    state.personalExtension = { sessionId: 'extension-run', profileId: 'selected-profile', isHeadless: null };
    await host.invoke('conversation', { kind: 'inspect-existing-extension' });
    expect((await host.invoke('conversation', { kind: 'state' })).session.capabilities.nativeWindow).toBe(true);
    state.isHeadless = true;
    expect((await host.invoke('conversation', { kind: 'state' })).session.capabilities.nativeWindow).toBe(false);
  });

  it('keeps new-account prompts blocked when the old browser cannot confirm shutdown', async () => {
    const { host, control } = fixture(async () => false);
    await host.openAuthorizedPage('old-account', input);
    mocks.close.mockRejectedValueOnce(new Error('Shutdown failed'));
    await expect(host.prepareUserMessage('new-account')).rejects.toThrow('did not confirm shutdown');
    expect(control.status()).toMatchObject({ state: 'error', owner: 'old-account' });
  });
  it('starts visible Chrome only after the existing engine pause is acknowledged', async () => {
    const { host, control } = fixture();
    let release!: (ticket: { sessionId: string; pauseEpoch: number }) => void;
    const paused = new Promise<{ sessionId: string; pauseEpoch: number }>((resolve) => {
      release = resolve;
    });
    const pauseTools = vi.fn(() => paused);
    control.register('actor', { ready: async () => {}, connection: { hasActiveSession: true, isToolPauseSupported: true, pauseTools, resumeTools: async () => {} } });
    const pending = host.openAuthorizedPage('conversation', input);
    await vi.waitFor(() => expect(pauseTools).toHaveBeenCalledTimes(1));
    expect(mocks.invoke.mock.calls.some(([action]) => action.kind === 'start')).toBe(false);
    release({ sessionId: 'actor', pauseEpoch: 1 });
    const result = await pending;
    expect(result).toEqual({ surface: 'native', conversationId: 'conversation' });
    expect(JSON.stringify(result)).not.toContain(input.cookie.value);
    expect(mocks.invoke).toHaveBeenCalledWith({ kind: 'start', isHeadless: false, transport: 'cdp' });
    expect(mocks.invoke).toHaveBeenCalledWith(expect.objectContaining({ kind: 'open-authorized-page', url: input.url, cookie: input.cookie, controlEpoch: 1, targetEpoch: 0 }));
    expect(mocks.invoke).toHaveBeenCalledWith({ kind: 'show-window', targetId: 'review', controlEpoch: 1, targetEpoch: 1 });
    expect(mocks.invoke.mock.calls.some(([action]) => action.kind === 'take')).toBe(false);
    expect(control.status()).toMatchObject({ state: 'human', owner: 'conversation' });
  });

  it('reuses an existing headless profile and returns its authenticated viewer surface', async () => {
    const { host } = fixture();
    state.state = 'ai';
    const result = await host.openAuthorizedPage('conversation', input);
    expect(result.surface).toBe('viewer');
    expect(mocks.invoke.mock.calls.some(([action]) => ['start', 'restart'].includes(action.kind))).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledWith(expect.objectContaining({ kind: 'take' }));
  });

  it('refuses old runtimes and transports; only explicit review navigation can switch control', async () => {
    const { host, control } = fixture();
    delete state.capabilities.authorizedPageLaunch;
    await expect(host.openAuthorizedPage('conversation', input)).rejects.toThrow('reviewRuntimeUnavailable');
    state.capabilities.authorizedPageLaunch = true;
    state.state = 'human';
    state.transport = 'extension';
    await expect(host.openAuthorizedPage('conversation', input)).rejects.toThrow('reviewTransportUnsupported');
    state.state = 'stopped';
    state.transport = 'cdp';
    await control.take('foreign', async () => {});
    await expect(host.invoke('conversation', { kind: 'start', isHeadless: false, transport: 'cdp' })).rejects.toThrow();
    expect(mocks.invoke.mock.calls.some(([action]) => ['start', 'open-authorized-page'].includes(action.kind))).toBe(false);
    await expect(host.openAuthorizedPage('conversation', input)).resolves.toEqual({ surface: 'native', conversationId: 'conversation' });
    expect(control.status()).toMatchObject({ state: 'human', owner: 'conversation', epoch: 2 });
    expect(BrowserSessionActionSchema.safeParse({ kind: 'open-authorized-page', ...input, controlEpoch: 0, targetEpoch: 0 }).success).toBe(false);
  });
});
