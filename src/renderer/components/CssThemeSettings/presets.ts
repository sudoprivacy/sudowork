/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICssTheme } from '@/common/storage';

import discourseHorizonCss from './presets/discourse-horizon.css?raw';
import glitteringInputFieldCss from './presets/glittering-input-field.css?raw';

/**
 * 默认主题 ID / Default theme ID
 * 用于标识默认主题（无自定义 CSS）/ Used to identify the default theme (no custom CSS)
 */
export const DEFAULT_THEME_ID = 'glittering-input-field';

/**
 * 预设 CSS 主题列表 / Preset CSS themes list
 * 这些主题是内置的，用户可以直接选择使用 / These themes are built-in and can be directly used by users
 */
export const PRESET_THEMES: ICssTheme[] = [
  {
    id: 'grid-theme',
    name: 'Grid',
    isPreset: true,
    css: `/* Grid Theme - 网格背景主题 / Grid Background Theme */

/* ==================== Light Mode / 浅色模式 ==================== */
:root {
  /* Primary Colors */
  --color-primary: #165dff;
  --primary: #165dff;
  --color-primary-light-1: #4080ff;
  --color-primary-light-2: #6aa1ff;
  --color-primary-light-3: #94bfff;
  --color-primary-dark-1: #0e42d2;
  --primary-rgb: 22, 93, 255;

  /* Brand Colors */
  --brand: #7583b2;
  --brand-light: #eff0f6;
  --brand-hover: #b5bcd6;
  --color-brand-fill: #7583b2;
  --color-brand-bg: #eff0f6;

  /* AOU Brand Colors */
  --aou-1: #eff0f6;
  --aou-2: #e5e7f0;
  --aou-3: #d1d5e5;
  --aou-4: #b5bcd6;
  --aou-5: #97a0c5;
  --aou-6: #7583b2;
  --aou-7: #596590;
  --aou-8: #3f4868;
  --aou-9: #262c41;
  --aou-10: #0d101c;

  /* Background Colors - warm cream / 暖色调背景 */
  --color-bg-1: #f5f3ee;
  --bg-1: #f5f3ee;
  --color-bg-2: #edeae3;
  --bg-2: #edeae3;
  --color-bg-3: #dedad0;
  --bg-3: #dedad0;
  --color-bg-4: #c8c3b6;
  --bg-4: #c8c3b6;
  --bg-base: #faf8f3;
  --bg-5: #a8a59d;
  --bg-6: #86838c;
  --bg-8: #4e4c54;
  --bg-9: #1d1c22;
  --bg-10: #0c0b10;

  /* Interactive State Colors */
  --bg-hover: #edeae3;
  --bg-active: #dedad0;

  /* Fill Colors */
  --fill: #f5f3ee;
  --color-fill: #f5f3ee;
  --fill-0: #faf8f3;
  --fill-white-to-black: #faf8f3;
  --dialog-fill-0: #faf8f3;
  --inverse: #ffffff;

  /* Text Colors */
  --color-text-1: #1d2129;
  --text-primary: #1d2129;
  --color-text-2: #4e5969;
  --text-secondary: #86909c;
  --color-text-3: #86909c;
  --text-disabled: #c9cdd4;
  --text-0: #000000;
  --text-white: #ffffff;

  /* Border Colors */
  --color-border: #dedad0;
  --color-border-1: #dedad0;
  --color-border-2: #edeae3;
  --border-base: #dedad0;
  --border-light: #edeae3;
  --border-special: var(--bg-3);

  /* Semantic Colors */
  --success: #00b42a;
  --warning: #ff7d00;
  --danger: #f53f3f;
  --info: #165dff;

  /* Message & UI Component Colors */
  --message-user-bg: #e9efff;
  --message-tips-bg: #f0f4ff;
  --workspace-btn-bg: #edeae3;
}

/* Grid background - light mode / 浅色模式网格背景 */
html, body {
  background-color: #faf8f3;
  background-image:
    linear-gradient(rgba(0, 0, 0, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 0, 0, 0.06) 1px, transparent 1px);
  background-size: 40px 40px;
}

/* Make content areas transparent to reveal grid / 使内容区域透明以显示网格 */
.layout-content,
.arco-layout-content,
.arco-layout {
  background-color: transparent;
  background-image: none;
}

/* ==================== Dark Mode / 深色模式 ==================== */
[data-theme='dark'] {
  /* Primary Colors */
  --color-primary: #4d9fff;
  --primary: #4d9fff;
  --color-primary-light-1: #6aa8ff;
  --color-primary-light-2: #87b7ff;
  --color-primary-light-3: #a4c6ff;
  --color-primary-dark-1: #306acc;
  --primary-rgb: 77, 159, 255;

  /* Brand Colors */
  --brand: #a1aacb;
  --brand-light: #3d4150;
  --brand-hover: #6a749b;
  --color-brand-fill: #a1aacb;
  --color-brand-bg: #3d4150;

  /* AOU Brand Colors */
  --aou-1: #2a2a2a;
  --aou-2: #3d4150;
  --aou-3: #525a77;
  --aou-4: #6a749b;
  --aou-5: #838fba;
  --aou-6: #a1aacb;
  --aou-7: #b5bcd6;
  --aou-8: #d1d5e5;
  --aou-9: #e5e7f0;
  --aou-10: #eff0f6;

  /* Background Colors */
  --color-bg-1: #1a1a1a;
  --bg-1: #1a1a1a;
  --color-bg-2: #262626;
  --bg-2: #262626;
  --color-bg-3: #333333;
  --bg-3: #333333;
  --color-bg-4: #404040;
  --bg-4: #404040;
  --bg-base: #0e0e0e;
  --bg-5: #4d4d4d;
  --bg-6: #5a5a5a;
  --bg-8: #737373;
  --bg-9: #a6a6a6;
  --bg-10: #d9d9d9;

  /* Interactive State Colors */
  --bg-hover: #1f1f1f;
  --bg-active: #2d2d2d;

  /* Fill Colors */
  --fill: #1a1a1a;
  --color-fill: #1a1a1a;
  --fill-0: rgba(255, 255, 255, 0.08);
  --fill-white-to-black: #000000;
  --dialog-fill-0: #333333;
  --inverse: #ffffff;

  /* Text Colors */
  --color-text-1: #e5e5e5;
  --text-primary: #e5e5e5;
  --color-text-2: #a6a6a6;
  --text-secondary: #a6a6a6;
  --color-text-3: #737373;
  --text-disabled: #737373;
  --text-0: #ffffff;
  --text-white: #ffffff;

  /* Border Colors */
  --color-border: #333333;
  --color-border-1: #333333;
  --color-border-2: #262626;
  --border-base: #333333;
  --border-light: #262626;
  --border-special: #60677e;

  /* Semantic Colors */
  --success: #23c343;
  --warning: #ff9a2e;
  --danger: #f76560;
  --info: #4d9fff;

  /* Message & UI Component Colors */
  --message-user-bg: #1e2a3a;
  --message-tips-bg: #1a2333;
  --workspace-btn-bg: #1f1f1f;
}

/* Grid background - dark mode / 深色模式网格背景 */
html[data-theme='dark'],
html[data-theme='dark'] body {
  background-color: #0e0e0e;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
  background-size: 40px 40px;
}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'discourse-horizon',
    name: 'Discourse Horizon',
    isPreset: true,
    css: discourseHorizonCss,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'glittering-input-field',
    name: 'Glittering Input Field',
    isPreset: true,
    css: glitteringInputFieldCss,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];
