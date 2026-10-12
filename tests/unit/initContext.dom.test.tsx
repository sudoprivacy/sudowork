import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InitStatus } from '@/common/ipcBridge';

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  onStatusChange: vi.fn(),
  unsubscribe: vi.fn(),
  statusCallback: undefined as ((status: InitStatus) => void) | undefined,
}));

vi.mock('@/common/ipcBridge', () => ({
  init: {
    getStatus: { invoke: mocks.getStatus },
    onStatusChange: {
      on: mocks.onStatusChange,
    },
  },
}));

import { InitProvider, useInit } from '@/renderer/context/InitContext';

const readyStatus: InitStatus = {
  phase: 'ready',
  message: '初始化完成',
  progress: 100,
};

function InitStatusProbe() {
  const { status, hasResolvedInitialStatus } = useInit();
  return <div data-testid='status'>{`${hasResolvedInitialStatus}:${status.phase}`}</div>;
}

describe('InitProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getStatus.mockReset();
    mocks.onStatusChange.mockReset();
    mocks.unsubscribe.mockReset();
    mocks.statusCallback = undefined;
    mocks.onStatusChange.mockImplementation((callback: (status: InitStatus) => void) => {
      mocks.statusCallback = callback;
      return mocks.unsubscribe;
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('accepts the replayed status when the first provider request never settles', () => {
    mocks.getStatus.mockReturnValue(new Promise(() => {}));

    const { unmount } = render(
      <InitProvider>
        <InitStatusProbe />
      </InitProvider>
    );

    expect(screen.getByTestId('status')).toHaveTextContent('false:pending');

    act(() => {
      mocks.statusCallback?.(readyStatus);
    });

    expect(screen.getByTestId('status')).toHaveTextContent('true:ready');
    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it('retries after a timed-out provider request', async () => {
    mocks.getStatus.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce({ success: true, data: readyStatus });

    render(
      <InitProvider>
        <InitStatusProbe />
      </InitProvider>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5500);
    });

    expect(mocks.getStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('status')).toHaveTextContent('true:ready');
  });

  it('retries an unsuccessful status response', async () => {
    mocks.getStatus.mockResolvedValueOnce({ success: false, msg: 'not ready' }).mockResolvedValueOnce({ success: true, data: readyStatus });

    render(
      <InitProvider>
        <InitStatusProbe />
      </InitProvider>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(mocks.getStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('status')).toHaveTextContent('true:ready');
  });
});
