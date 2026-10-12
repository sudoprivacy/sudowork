import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAppMode: vi.fn(),
  setAppMode: vi.fn(),
}));

vi.mock('@/common/eeclawMode', () => ({
  getAppMode: mocks.getAppMode,
  setAppMode: mocks.setAppMode,
}));

import { markAppModeBridgeReady, useAppMode } from '@/renderer/hooks/useAppMode';

describe('useAppMode', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.getAppMode.mockReset();
    mocks.setAppMode.mockReset();
  });

  it('defers app-mode loading until the initial status bridge is ready', async () => {
    mocks.getAppMode.mockResolvedValue(null);
    const { result, rerender } = renderHook(() => useAppMode());

    expect(mocks.getAppMode).not.toHaveBeenCalled();
    expect(result.current.isModeResolved).toBe(false);

    act(() => {
      markAppModeBridgeReady();
      rerender();
    });

    await waitFor(() => {
      expect(result.current.isModeResolved).toBe(true);
    });
    expect(mocks.getAppMode).toHaveBeenCalledOnce();
    expect(result.current).toMatchObject({ mode: 'c', isEnterprise: false, isSetupNeeded: true });
  });
});
