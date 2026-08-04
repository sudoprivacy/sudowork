/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTenantLogo } from '@/renderer/hooks/useTenantLogo';
import SudoworkIcon from '@/renderer/assets/sudowork-icon-dark.svg';
import { useTenantStore } from '@/renderer/stores/useTenantStore';

const mockUseThemeContext = vi.fn();

vi.mock('@/renderer/context/ThemeContext', () => ({
  useThemeContext: () => mockUseThemeContext(),
}));

describe('useTenantLogo', () => {
  beforeEach(() => {
    mockUseThemeContext.mockReset();
    useTenantStore.setState({ logo: undefined, logoDark: undefined });
  });

  it('falls back to the bundled icon when no logo is configured', () => {
    mockUseThemeContext.mockReturnValue({ theme: 'light' });
    const { result } = renderHook(() => useTenantLogo());
    expect(result.current).toBe(SudoworkIcon);
  });

  it('uses the regular logo in light mode', () => {
    useTenantStore.setState({ logo: 'logo-light.svg', logoDark: 'logo-dark.svg' });
    mockUseThemeContext.mockReturnValue({ theme: 'light' });
    const { result } = renderHook(() => useTenantLogo());
    expect(result.current).toBe('logo-light.svg');
  });

  it('prefers the dark logo in dark mode', () => {
    useTenantStore.setState({ logo: 'logo-light.svg', logoDark: 'logo-dark.svg' });
    mockUseThemeContext.mockReturnValue({ theme: 'dark' });
    const { result } = renderHook(() => useTenantLogo());
    expect(result.current).toBe('logo-dark.svg');
  });

  it('falls back to the regular logo in dark mode when logoDark is absent', () => {
    useTenantStore.setState({ logo: 'logo-light.svg', logoDark: undefined });
    mockUseThemeContext.mockReturnValue({ theme: 'dark' });
    const { result } = renderHook(() => useTenantLogo());
    expect(result.current).toBe('logo-light.svg');
  });

  it('reacts to a successful remote tenant update without remounting', () => {
    mockUseThemeContext.mockReturnValue({ theme: 'light' });
    const { result } = renderHook(() => useTenantLogo());

    act(() => {
      useTenantStore.getState().applyRemoteConfig({ logo: 'https://example.com/remote-logo.png' });
    });

    expect(result.current).toBe('https://example.com/remote-logo.png');
  });
});
