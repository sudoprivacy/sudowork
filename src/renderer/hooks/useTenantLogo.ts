/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import SudoworkIcon from '@/renderer/assets/sudowork-icon-dark.svg';
import { useThemeContext } from '@/renderer/context/ThemeContext';
import { useTenantStore } from '@/renderer/stores/useTenantStore';

/** 返回当前主题适用的租户 Logo，并在未配置时使用内置图标。 */
export function useTenantLogo(): string {
  const logo = useTenantStore((state) => state.logo);
  const logoDark = useTenantStore((state) => state.logoDark);
  const { theme } = useThemeContext();

  return (theme === 'dark' && logoDark ? logoDark : logo) || SudoworkIcon;
}
