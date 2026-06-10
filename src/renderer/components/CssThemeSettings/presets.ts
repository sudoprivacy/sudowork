/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICssTheme } from '@/common/storage';

import defaultThemeCss from '@/renderer/styles/themes/default-theme.css?raw';

/**
 * 默认主题 ID / Default theme ID
 * 用于标识内置默认主题 / Used to identify the built-in default theme
 */
export const DEFAULT_THEME_ID = 'default-theme';

/**
 * 预设 CSS 主题列表 / Preset CSS themes list
 * 当前仅内置唯一的默认主题 / Currently only the single built-in default theme
 */
export const PRESET_THEMES: ICssTheme[] = [
  {
    id: DEFAULT_THEME_ID,
    name: 'Default',
    isPreset: true,
    css: defaultThemeCss,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];
