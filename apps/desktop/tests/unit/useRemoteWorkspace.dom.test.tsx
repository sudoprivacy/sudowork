import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDirOrFile } from '@sudowork/host-bridge/ipcBridge';
import type { IResponseMessage } from '@sudowork/common/chatTypes';
import { useRemoteWorkspace } from '@renderer/hooks/useRemoteWorkspace';

const bridge = vi.hoisted(() => ({ read: vi.fn(), listeners: new Set<(message: IResponseMessage) => void>() }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  conversation: {
    getRemoteWorkspace: { invoke: bridge.read },
    responseStream: {
      on: (listener: (message: IResponseMessage) => void) => {
        bridge.listeners.add(listener);
        return () => bridge.listeners.delete(listener);
      },
    },
  },
}));

function response(name: string) {
  return { success: true, data: { files: [{ name, relativePath: name, fullPath: '/' + name, isFile: true, isDir: false }] as IDirOrFile[] } };
}

function deferred() {
  let resolve!: (result: ReturnType<typeof response>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReturnType<typeof response>>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function boundary() {
  const cache = new Map();
  return function Wrapper({ children }: IWrapperProps) {
    return <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>;
  };
}

describe('remote workspace subscription lifetime', () => {
  beforeEach(() => {
    bridge.read.mockReset();
  });
  afterEach(() => {
    cleanup();
    expect(bridge.listeners.size).toBe(0);
    vi.restoreAllMocks();
  });

  it('keeps data and requests in their own SWR cache boundary', async () => {
    const left = deferred();
    const right = deferred();
    bridge.read.mockReturnValueOnce(left.promise).mockReturnValueOnce(right.promise);
    const first = renderHook(() => useRemoteWorkspace('a'), { wrapper: boundary() });
    const second = renderHook(() => useRemoteWorkspace('a'), { wrapper: boundary() });
    await act(async () => {
      left.resolve(response('left'));
      right.resolve(response('right'));
    });
    expect(bridge.read).toHaveBeenCalledTimes(2);
    expect(first.result.current.files?.[0].name).toBe('left');
    expect(second.result.current.files?.[0].name).toBe('right');
  });

  it('clears private data on last unsubscribe and ignores its unfinished read on remount', async () => {
    const old = deferred();
    const fresh = deferred();
    bridge.read.mockResolvedValueOnce(response('private-first')).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const wrapper = boundary();
    const first = renderHook(() => useRemoteWorkspace('a'), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(first.result.current.files?.[0].name).toBe('private-first');
    let pending!: Promise<IDirOrFile[]>;
    await act(async () => {
      pending = first.result.current.refresh();
    });
    first.unmount();
    const second = renderHook(() => useRemoteWorkspace('a'), { wrapper });
    await act(async () => {
      old.resolve(response('private-late'));
      await pending;
    });
    expect(second.result.current.files).toBeUndefined();
    await act(async () => {
      fresh.resolve(response('current-authorized'));
    });
    expect(bridge.read).toHaveBeenCalledTimes(3);
    expect(second.result.current.files?.[0].name).toBe('current-authorized');
  });

  it('keeps the remaining view attached to its own session when the first view switches', async () => {
    const reads = new Map<string, number>();
    bridge.read.mockImplementation(async ({ conversation_id }: { conversation_id: string }) => {
      const count = (reads.get(conversation_id) || 0) + 1;
      reads.set(conversation_id, count);
      return response(conversation_id + '-' + count);
    });
    const view = renderHook(({ firstId }) => ({ first: useRemoteWorkspace(firstId), second: useRemoteWorkspace('a') }), { initialProps: { firstId: 'a' as string | undefined }, wrapper: boundary() });
    await act(async () => {
      await Promise.resolve();
    });
    expect(bridge.read).toHaveBeenCalledTimes(1);
    expect(view.result.current.second.files?.[0].name).toBe('a-1');
    view.rerender({ firstId: 'b' });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      for (const listener of bridge.listeners) listener({ type: 'finish', data: {}, conversation_id: 'a', msg_id: 'a-done' });
    });
    expect(view.result.current.first.files?.[0].name).toBe('b-1');
    expect(view.result.current.second.files?.[0].name).toBe('a-2');
    expect(bridge.listeners.size).toBe(2);
    view.rerender({ firstId: undefined });
    await act(async () => {
      for (const listener of bridge.listeners) listener({ type: 'finish', data: {}, conversation_id: 'a', msg_id: 'a-later' });
    });
    expect(view.result.current.second.files?.[0].name).toBe('a-3');
    expect(bridge.listeners.size).toBe(1);
    expect(bridge.read).toHaveBeenCalledTimes(4);
  });

  it('consumes an invalidation queued while a read fails', async () => {
    const failing = deferred();
    bridge.read.mockResolvedValueOnce(response('before')).mockReturnValueOnce(failing.promise).mockResolvedValueOnce(response('after'));
    const view = renderHook(() => useRemoteWorkspace('a'), { wrapper: boundary() });
    await act(async () => {
      await Promise.resolve();
    });
    let pending!: Promise<IDirOrFile[]>;
    await act(async () => {
      pending = view.result.current.refresh();
    });
    await act(async () => {
      for (const listener of bridge.listeners) listener({ type: 'finish', data: {}, conversation_id: 'a', msg_id: 'queued' });
      failing.reject(new Error('first read failed'));
      await expect(pending).resolves.toEqual(response('after').data.files);
    });
    expect(bridge.read).toHaveBeenCalledTimes(3);
    expect(view.result.current.error).toBeUndefined();
    expect(view.result.current.files?.[0].name).toBe('after');
  });

  it('exposes read failures, retains the last image, and recovers on a later completion', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    bridge.read.mockResolvedValueOnce(response('before')).mockResolvedValueOnce({ success: false, msg: 'unavailable' }).mockResolvedValueOnce(response('after'));
    const view = renderHook(() => useRemoteWorkspace('a'), { wrapper: boundary() });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await expect(view.result.current.refresh()).rejects.toThrow('unavailable');
    });
    expect(view.result.current.error?.message).toBe('unavailable');
    expect(view.result.current.files?.[0].name).toBe('before');
    expect(bridge.read).toHaveBeenCalledTimes(2);
    await act(async () => {
      for (const listener of bridge.listeners) listener({ type: 'finish', data: {}, conversation_id: 'b', msg_id: 'wrong' });
      await Promise.resolve();
    });
    expect(bridge.read).toHaveBeenCalledTimes(2);
    await act(async () => {
      for (const listener of bridge.listeners) listener({ type: 'finish', data: {}, conversation_id: 'a', msg_id: 'done' });
    });
    expect(view.result.current.error).toBeUndefined();
    expect(view.result.current.files?.[0].name).toBe('after');
  });
});

interface IWrapperProps {
  children: React.ReactNode;
}
