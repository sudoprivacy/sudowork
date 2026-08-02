/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TenantConfig } from '@/common/types/tenantConfig';
import SudoworkIcon from '@/renderer/assets/sudowork-icon-dark.svg';
import { useTenantConfig } from '@/renderer/context/TenantConfigContext';
import { useThemeContext } from '@/renderer/context/ThemeContext';

interface IBrandConfig {
  /** 按当前主题挑选的 Logo，未配置时回退到内置图标 */
  logo: string;
}

/**
 * 按当前主题挑选 Logo：暗色模式下优先使用 `logoDark`，未配置时回退到 `logo`，都没有时回退到内置图标。
 */
function resolveThemedLogo(config: Pick<TenantConfig, 'logo' | 'logoDark'>, theme: 'light' | 'dark'): string {
  if (theme === 'dark' && config.logoDark) return config.logoDark;
  return config.logo || SudoworkIcon;
}

/**
 * 派生的品牌展示配置：当前主题下的 Logo，以及未来可能加入的其他品牌派生值
 * （如需要按主题/租户派生的展示名称、色彩等）。
 *
 * 默认跟随实时的租户配置 context。当调用方不能跟随 context时（如登录/注册页），
 * 传入显式的 `config`（如登录前缓存的租户配置）——context 在 `status === 'unauthenticated'`
 * 时会重置为品牌默认值，但这些页面仍需要展示缓存的租户品牌。
 *
 * 必须在 TenantConfigProvider + ThemeProvider 内使用（两个均已在
 * src/renderer/index.ts 全局挂载）。
 */
export function useBrandConfig(config?: Pick<TenantConfig, 'logo' | 'logoDark'>): IBrandConfig {
  const { config: contextConfig } = useTenantConfig();
  const { theme } = useThemeContext();
  return {
    logo: resolveThemedLogo(config ?? contextConfig, theme),
  };
}
