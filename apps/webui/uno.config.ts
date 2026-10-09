/**
 * 摘取自 Sudowork uno.config.ts（Apache-2.0, Copyright 2026 SudoPrivacy），
 * 保持企业端视觉一致（计划 Task 4）；按 WebUI 目录结构调整 content 扫描。
 */
import {
  defineConfig,
  presetMini,
  presetWind3,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'
import { presetExtra } from 'unocss-preset-extra'

// ==================== 语义化文字颜色 / Semantic Text Colors ====================
const textColors = {
  foreground: 'var(--foreground)',
  secondary: 'var(--text-secondary)',
  tertiary: 'var(--text-tertiary)',
}

// ==================== 语义状态色 / Semantic State Colors ====================
const semanticColors = {
  primary: 'var(--primary)',
  success: 'var(--success)',
  'success-soft': 'var(--success-soft)',
  'success-line': 'var(--success-line)',
  warning: 'var(--warning)',
  'warning-soft': 'var(--warning-soft)',
  'warning-line': 'var(--warning-line)',
  danger: 'var(--danger)',
  'danger-soft': 'var(--danger-soft)',
  'danger-line': 'var(--danger-line)',
  info: 'var(--info)',
}

// ==================== 背景色系统 / Background Color System ====================
const backgroundColors = {
  base: 'var(--bg-base)',
  faint: 'var(--bg-faint)',
  subtle: 'var(--bg-subtle)',
  muted: 'var(--bg-muted)',
  control: 'var(--bg-control)',
  emphasis: 'var(--bg-emphasis)',
  strong: 'var(--bg-strong)',
  hover: 'var(--bg-hover)',
  active: 'var(--bg-active)',
  1: 'var(--bg-1)',
  2: 'var(--bg-2)',
  3: 'var(--bg-3)',
  4: 'var(--bg-4)',
  6: 'var(--bg-6)',
}

// ==================== 品牌色 / Brand Colors ====================
const brandColors = {
  brand: 'var(--brand)',
  'brand-light': 'var(--brand-light)',
  'brand-hover': 'var(--brand-hover)',
}

// ==================== AOU 品牌色系 / AOU Brand Colors ====================
const aouColors = {
  aou: {
    1: 'var(--aou-1)',
    2: 'var(--aou-2)',
    3: 'var(--aou-3)',
    4: 'var(--aou-4)',
    5: 'var(--aou-5)',
    6: 'var(--aou-6)',
    7: 'var(--aou-7)',
    8: 'var(--aou-8)',
    9: 'var(--aou-9)',
    10: 'var(--aou-10)',
  },
}

const componentColors = {
  'message-tips': 'var(--message-tips-bg)',
}

export default defineConfig({
  // Scan the shared renderer source (hosted by the additive shared-renderer entry)
  // alongside the module-graph default, so its atomic classes are generated too.
  content: {
    filesystem: ['../../packages/renderer/src/**/*.{ts,tsx}'],
  },
  presets: [presetMini(), presetExtra(), presetWind3()],
  transformers: [transformerVariantGroup(), transformerDirectives({ enforce: 'pre' })],
  rules: [
    [/^text-([1-4])$/, (m) => ({ color: `var(--color-text-${m[1]})` })],
    [/^bg-text-([1-4])$/, (m) => ({ 'background-color': `var(--color-text-${m[1]})` })],
    [/^bg-fill-([0-4])$/, (m) => ({ 'background-color': `var(--color-fill-${m[1]})` })],
    [/^bg-primary-light-([1-4])$/, (m) => ({ 'background-color': `var(--color-primary-light-${m[1]})` })],
    ['bg-popup', { 'background-color': 'var(--color-bg-popup)' }],
    ['text-0', { color: 'var(--text-0)' }],
    ['text-white', { color: 'var(--text-white)' }],
  ],
  preflights: [
    {
      getCSS: () => `
        * {
          color: inherit;
        }
        *, ::before, ::after {
          border-width: 0;
          border-style: solid;
          border-color: var(--border-default);
        }
      `,
    },
  ],
  shortcuts: {
    'f-center': 'flex items-center justify-center',
    'border-light': 'border-[var(--border-light)]',
    'border-default': 'border-[var(--border-default)]',
    'border-tiny': 'border-[var(--border-tiny)]',
    'border-bold': 'border-[var(--border-bold)]',
    'divide-light': 'divide-[var(--border-light)]',
    'divide-tiny': 'divide-[var(--border-tiny)]',
    'bg-guid-agent-bar': 'bg-[var(--color-guid-agent-bar,var(--aou-2))]',
    'scrollbar-hide': '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
    card: 'bg-base rd-3 p-4 cursor-pointer shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-all duration-200 hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)]',
    'category-chip': 'flex-shrink-0 inline-flex items-center justify-center h-28px px-12px rd-16px border border-transparent text-12px leading-18px whitespace-nowrap cursor-pointer transition-colors',
    'category-chip-idle': 'text-secondary hover:bg-fill-2 hover:text-foreground',
    'category-chip-active': 'bg-[rgba(var(--ui-accent-orange-rgb),0.12)] text-[var(--ui-accent-orange)] font-medium',
  },
  theme: {
    colors: {
      ...textColors,
      ...semanticColors,
      ...backgroundColors,
      ...brandColors,
      ...aouColors,
      ...componentColors,
    },
  },
})
