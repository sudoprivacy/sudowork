import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ context: vi.fn(), sessions: vi.fn(), agents: vi.fn(), listeners: new Set<() => void>() }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ externalProviders: { context: { invoke: mocks.context }, sessions: { invoke: mocks.sessions }, agents: { invoke: mocks.agents } } }));
vi.mock('@renderer/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u', enterprise_code: 'o' }, isGuest: false }) }));
vi.mock('@renderer/utils/emitter', () => ({
  addEventListener: (_name: string, listener: () => void) => {
    mocks.listeners.add(listener);
    return () => {
      mocks.listeners.delete(listener);
    };
  },
}));
import { useExternalHistory } from '@renderer/pages/external-agents/useExternalHistory';
import { useExternalDirectory } from '@renderer/pages/external-agents/useExternalDirectory';

function Consumer() {
  useExternalHistory();
  useExternalDirectory();
  return null;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.listeners.clear();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  mocks.context.mockResolvedValue({ success: true, data: { isAvailable: true, identity: 'moss-u' } });
  mocks.sessions.mockResolvedValue({ success: true, data: [] });
  mocks.agents.mockResolvedValue({ success: true, data: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

it('coalesces mounted readers and global refresh bursts without refetching the directory', async () => {
  render(
    <>
      <Consumer />
      <Consumer />
    </>
  );
  await act(async () => {});
  expect(mocks.context).toHaveBeenCalledTimes(1);
  expect(mocks.sessions).toHaveBeenCalledTimes(1);
  expect(mocks.agents).toHaveBeenCalledTimes(1);
  await act(async () => {
    for (let i = 0; i < 10; i++) for (const listener of mocks.listeners) listener();
  });
  expect(mocks.sessions).toHaveBeenCalledTimes(2);
  expect(mocks.agents).toHaveBeenCalledTimes(1);
});

it('does not poll history or refresh in a hidden document and refreshes once on return', async () => {
  render(
    <>
      <Consumer />
      <Consumer />
    </>
  );
  await act(async () => {});
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(90000);
    for (const listener of mocks.listeners) listener();
  });
  expect(mocks.sessions).toHaveBeenCalledTimes(1);
  expect(mocks.context).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(mocks.sessions).toHaveBeenCalledTimes(2);
  expect(mocks.agents).toHaveBeenCalledTimes(2);
});
