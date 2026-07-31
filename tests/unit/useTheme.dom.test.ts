import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const configStorageGet = vi.fn();
const configStorageSet = vi.fn();

vi.mock('@/common/storage', () => ({
  ConfigStorage: {
    get: (...args: unknown[]) => configStorageGet(...args),
    set: (...args: unknown[]) => configStorageSet(...args),
  },
}));

describe('useTheme', () => {
  beforeEach(() => {
    vi.resetModules();
    configStorageGet.mockReset();
    configStorageSet.mockReset();
    configStorageGet.mockResolvedValue('dark');
    configStorageSet.mockResolvedValue(undefined);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.body.removeAttribute('arco-theme');
  });

  it('同步应用缓存主题，并在切换时同步项目与 Arco 主题', async () => {
    localStorage.setItem('__sudowork_theme', 'dark');

    const { default: useTheme } = await import('@/renderer/hooks/useTheme');

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.body.getAttribute('arco-theme')).toBe('dark');

    const { result } = renderHook(() => useTheme());
    await waitFor(() => expect(result.current[0]).toBe('dark'));

    await act(async () => {
      await result.current[2]('light');
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.body.getAttribute('arco-theme')).toBe('light');
    expect(configStorageSet).toHaveBeenCalledWith('theme', 'light');
  });
});
