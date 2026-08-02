/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockUseTenantConfig = vi.fn();
const mockUseThemeContext = vi.fn();

vi.mock('@/renderer/context/TenantConfigContext', () => ({
  useTenantConfig: () => mockUseTenantConfig(),
}));
vi.mock('@/renderer/context/ThemeContext', () => ({
  useThemeContext: () => mockUseThemeContext(),
}));

// SudoworkIcon is imported as an asset; Vitest resolves it via the asset transform,
// so its actual value doesn't matter — only that it's a stable non-empty fallback.
import { useBrandConfig } from '@/renderer/hooks/useBrandConfig';
import SudoworkIcon from '@/renderer/assets/sudowork-icon-dark.svg';

describe('useBrandConfig', () => {
  beforeEach(() => {
    mockUseTenantConfig.mockReset();
    mockUseThemeContext.mockReset();
  });

  it('falls back to the bundled icon when the tenant config has no logo', () => {
    mockUseTenantConfig.mockReturnValue({ config: {} });
    mockUseThemeContext.mockReturnValue({ theme: 'light' });

    const { result } = renderHook(() => useBrandConfig());

    expect(result.current.logo).toBe(SudoworkIcon);
  });

  it('uses the light logo from the tenant config context in light mode', () => {
    mockUseTenantConfig.mockReturnValue({ config: { logo: 'logo-light.svg', logoDark: 'logo-dark.svg' } });
    mockUseThemeContext.mockReturnValue({ theme: 'light' });

    const { result } = renderHook(() => useBrandConfig());

    expect(result.current.logo).toBe('logo-light.svg');
  });

  it('prefers logoDark from the tenant config context in dark mode', () => {
    mockUseTenantConfig.mockReturnValue({ config: { logo: 'logo-light.svg', logoDark: 'logo-dark.svg' } });
    mockUseThemeContext.mockReturnValue({ theme: 'dark' });

    const { result } = renderHook(() => useBrandConfig());

    expect(result.current.logo).toBe('logo-dark.svg');
  });

  it('uses an explicit config override instead of the context config', () => {
    mockUseTenantConfig.mockReturnValue({ config: { logo: 'context-logo.svg' } });
    mockUseThemeContext.mockReturnValue({ theme: 'light' });

    const { result } = renderHook(() => useBrandConfig({ logo: 'override-logo.svg' }));

    expect(result.current.logo).toBe('override-logo.svg');
  });

  it('falls back to the bundled icon when an explicit override has no logo', () => {
    mockUseTenantConfig.mockReturnValue({ config: { logo: 'context-logo.svg' } });
    mockUseThemeContext.mockReturnValue({ theme: 'light' });

    const { result } = renderHook(() => useBrandConfig({}));

    expect(result.current.logo).toBe(SudoworkIcon);
  });
});
