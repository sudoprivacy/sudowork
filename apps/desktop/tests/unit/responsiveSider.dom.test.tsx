import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useResponsiveSider } from '@renderer/hooks/useResponsiveSider';

function viewport(isNarrow: boolean) {
  let onChange: ((event: MediaQueryListEvent) => void) | undefined;
  const query = {
    matches: isNarrow,
    addEventListener: vi.fn((_type, listener) => {
      onChange = listener;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query)
  );
  return {
    query,
    resize(isNowNarrow: boolean) {
      query.matches = isNowNarrow;
      act(() => onChange?.({ matches: isNowNarrow } as MediaQueryListEvent));
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('responsive sidebar', () => {
  it('starts collapsed at phone width and permits opening the menu', () => {
    viewport(true);
    const { result, rerender } = renderHook(({ pathname }) => useResponsiveSider(pathname), { initialProps: { pathname: '/guid' } });
    expect(result.current.isCollapsed).toBe(true);
    act(() => result.current.setIsCollapsed(false));
    expect(result.current.isCollapsed).toBe(false);
    rerender({ pathname: '/conversation/session-1' });
    expect(result.current.isCollapsed).toBe(true);
  });

  it('collapses on resize and preserves the choice when widening', () => {
    const screen = viewport(false);
    const { result, unmount } = renderHook(() => useResponsiveSider('/guid'));
    expect(result.current.isCollapsed).toBe(false);
    screen.resize(true);
    expect(result.current.isCollapsed).toBe(true);
    screen.resize(false);
    expect(result.current.isCollapsed).toBe(true);
    act(() => result.current.setIsCollapsed(false));
    expect(result.current.isCollapsed).toBe(false);
    unmount();
    expect(screen.query.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('preserves a desktop menu choice across navigation', () => {
    viewport(false);
    const { result, rerender } = renderHook(({ pathname }) => useResponsiveSider(pathname), { initialProps: { pathname: '/guid' } });
    act(() => result.current.setIsCollapsed(true));
    rerender({ pathname: '/conversation/session-1' });
    expect(result.current.isCollapsed).toBe(true);
  });
});
