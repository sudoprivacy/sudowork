import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { InputState } from '@sudowork/contracts/input-delivery';
import { useInputDelivery } from '@renderer/hooks/useInputDelivery';

const host = vi.hoisted(() => ({ invoke: vi.fn(), listeners: new Set<(event: { conversation_id: string; state?: InputState; isReset?: boolean }) => void>() }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  conversation: {
    inputControl: { invoke: (...args: unknown[]) => host.invoke(...args) },
    inputQueueUpdate: {
      on: (listener: (event: { conversation_id: string; state?: InputState; isReset?: boolean }) => void) => {
        host.listeners.add(listener);
        return () => host.listeners.delete(listener);
      },
    },
  },
}));
vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
const state = (revision: number): InputState => ({ revision, activeTurnId: null, running: false, paused: false, pending: [] });
afterEach(cleanup);
beforeEach(() => {
  host.invoke.mockReset();
  host.listeners.clear();
});

it('ignores a stale snapshot reply and an old conversation response after navigation', async () => {
  let reply!: (value: unknown) => void;
  host.invoke.mockReturnValueOnce(
    new Promise((resolve) => {
      reply = resolve;
    })
  );
  const { result, rerender, unmount } = renderHook(({ id }) => useInputDelivery(id, true), { initialProps: { id: 'first' } });
  act(() => {
    for (const listener of host.listeners) listener({ conversation_id: 'first', state: state(5) });
  });
  await act(async () => {
    reply({ success: true, data: { isSupported: true, receipt: { state: state(1) } } });
  });
  expect(result.current.state?.revision).toBe(5);
  const pending = new Promise((resolve) => {
    reply = resolve;
  });
  host.invoke.mockReturnValueOnce(pending);
  rerender({ id: 'second' });
  host.invoke.mockResolvedValue({ success: true, data: { isSupported: true, receipt: { state: state(2) } } });
  rerender({ id: 'third' });
  await waitFor(() => expect(result.current.state?.revision).toBe(2));
  await act(async () => {
    reply({ success: true, data: { isSupported: true, receipt: { state: state(99) } } });
  });
  expect(result.current.state?.revision).toBe(2);
  unmount();
  expect(host.listeners.size).toBe(0);
});

it('accepts a fresh engine revision after reconnect resets the projection', async () => {
  host.invoke.mockResolvedValue({ success: true, data: { isSupported: true, receipt: { state: state(20) } } });
  const { result } = renderHook(() => useInputDelivery('session', true));
  await waitFor(() => expect(result.current.state?.revision).toBe(20));
  act(() => {
    for (const listener of host.listeners) listener({ conversation_id: 'session', isReset: true });
  });
  expect(result.current.isSupported).toBe(false);
  act(() => {
    for (const listener of host.listeners) listener({ conversation_id: 'session', state: state(1) });
  });
  expect(result.current.state?.revision).toBe(1);
});
