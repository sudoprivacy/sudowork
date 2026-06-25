// uno.config.ts
import { resolve } from 'node:path';
import { defineConfig, presetMini, presetWind3, transformerDirectives, transformerVariantGroup } from 'unocss';
import { presetExtra } from 'unocss-preset-extra';

// ==================== 语义化文字颜色 / Semantic Text Colors ====================
// 用途：正文、标题等文字内容（推荐用于文本）
// Usage: Body text, headings, etc. (Recommended for text)
const textColors = {
  // 前景色 / Foreground colors（正文文字，区别于 text-primary 橙色主操作色）
  foreground: 'var(--foreground)', // text-foreground - 主要前景/正文
  secondary: 'var(--text-secondary)', // text-secondary - 次要前景
  tertiary: 'var(--text-tertiary)', // text-tertiary - 三级前景/提示
};

// ==================== 语义状态色 / Semantic State Colors ====================
// 用途：状态提示、按钮、标签等
// Usage: Status indicators, buttons, tags, etc.
const semanticColors = {
  primary: 'var(--primary)', // bg-primary, text-primary, border-primary
  success: 'var(--success)', // bg-success, text-success (实色:文字/图标/圆点)
  'success-soft': 'var(--success-soft)', // bg-success-soft (浅底)
  'success-line': 'var(--success-line)', // border-success-line (描边)
  warning: 'var(--warning)', // bg-warning, text-warning
  'warning-soft': 'var(--warning-soft)',
  'warning-line': 'var(--warning-line)',
  danger: 'var(--danger)', // bg-danger, text-danger
  'danger-soft': 'var(--danger-soft)',
  'danger-line': 'var(--danger-line)',
  info: 'var(--info)', // bg-info, text-info
};

// ==================== 背景色系统 / Background Color System ====================
// 用途：仅用于背景、容器等布局元素（bg-*）。
// Usage: backgrounds / containers only (bg-*).
// ⚠️ 这些是背景色，请勿当边框用 —— 边框统一走语义 token：
//    border-light 快捷方式（浅边框），或 border-[var(--border-default)] / border-[var(--border-light)]。
//    UnoCSS 颜色命名空间共享，border-1 / border-base 等技术上能解析，但指向的是「背景色」而非边框色，属误用。
// ⚠️ These are background colors — do NOT use as borders. For borders use the semantic
//    shortcut border-light (lighter border), or border-[var(--border-default|light)].
// 📝 text-1 到 text-4 通过自定义规则支持，指向 Arco 的 --color-text-*
// text-1 to text-4 are supported via custom rules, pointing to Arco's --color-text-*
const backgroundColors = {
  base: 'var(--bg-base)', // bg-base - 主背景
  1: 'var(--bg-1)', // bg-1 - 次级背景
  2: 'var(--bg-2)', // bg-2 - 三级背景
  3: 'var(--bg-3)', // bg-3
  4: 'var(--bg-4)', // bg-4
  6: 'var(--bg-6)', // bg-6
  hover: 'var(--bg-hover)', // bg-hover - 悬停背景
  active: 'var(--bg-active)', // bg-active - 激活背景
};

// ==================== 品牌色 / Brand Colors ====================
const brandColors = {
  brand: 'var(--brand)',
  'brand-light': 'var(--brand-light)',
  'brand-hover': 'var(--brand-hover)',
};

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
};

// ==================== UI 组件专用颜色 / UI Component Specific Colors ====================
const componentColors = {
  'message-tips': 'var(--message-tips-bg)',
};

export default defineConfig({
  presets: [presetMini(), presetExtra(), presetWind3()],
  transformers: [transformerVariantGroup(), transformerDirectives({ enforce: 'pre' })],
  content: {
    // filesystem 全量扫描仅 dev 用于消除 FOUC(让首次 uno.css 即含全部 utility);
    // 生产置空走 pipeline(模块图),避免死文件 class 混入产物。
    // 绝对路径绕开 @unocss/vite filesystem glob 的 cwd=config.root(=src/renderer)问题。
    filesystem: process.env.NODE_ENV === 'development' ? [resolve(process.cwd(), 'src/renderer/**/*.{ts,tsx}')] : [],
    pipeline: {
      // Use RegExp instead of glob strings so patterns match against absolute
      // module IDs regardless of the Vite root directory.  electron-vite sets
      // the renderer root to src/renderer/, which causes glob patterns like
      // 'src/**/*.tsx' to resolve to the non-existent src/renderer/src/ path.
      include: [/\.[jt]sx?($|\?)/, /\.vue($|\?)/, /\.css($|\?)/],
      exclude: [/[\\/]node_modules[\\/]/, /\.html($|\?)/],
    },
  },
  // 自定义规则 / Custom rules
  rules: [
    // Arco Design 官方文字颜色 text-1 到 text-4
    // Arco Design official text colors: text-1, text-2, text-3, text-4
    [/^text-([1-4])$/, ([, d]: RegExpExecArray) => ({ color: `var(--color-text-${d})` })],

    // Arco Design 官方填充色 fill-1 到 fill-4
    // Arco Design official fill colors: bg-fill-1, bg-fill-2, bg-fill-3, bg-fill-4
    [/^bg-fill-([1-4])$/, ([, d]: RegExpExecArray) => ({ 'background-color': `var(--color-fill-${d})` })],

    // Arco Design 官方浅色系 primary-light-1 到 -light-4(link 无引用已移除;success/warning/danger 走语义 token)
    [/^bg-primary-light-([1-4])$/, ([, d]: RegExpExecArray) => ({ 'background-color': `var(--color-primary-light-${d})` })],

    // Arco Design 对话框/弹出层专用背景色
    // Arco Design popup/dialog background color: bg-popup
    ['bg-popup', { 'background-color': 'var(--color-bg-popup)' }],

    // 项目自定义颜色 / Project custom colors
    ['bg-dialog-fill-0', { 'background-color': 'var(--dialog-fill-0)' }],
    ['text-0', { color: 'var(--text-0)' }],
    ['text-white', { color: 'var(--text-white)' }],
    ['bg-fill-0', { 'background-color': 'var(--fill-0)' }],
  ],
  // Preflights - Global base styles 全局基础样式
  preflights: [
    {
      getCSS: () => `
        * {
          /* Set default text color to follow theme 所有元素默认使用主题文字颜色 */
          color: inherit;
        }
        *, ::before, ::after {
          /* Tailwind 同款 border reset：清零默认宽度、统一 solid，并给一个默认主题边框色。
             默认色很关键：任何「有宽度但没指定颜色」的边框（裸 border / 无效色类）
             都会回退到柔和的 --border-default，而不是刺眼的 currentColor（黑）。
             Tailwind-style reset: zero width, solid style, and a default themed border color
             so any width-without-color border falls back to --border-default, not currentColor. */
          border-width: 0;
          border-style: solid;
          border-color: var(--border-default);
        }
      `,
    },
  ],
  // 基础配置
  shortcuts: {
    'f-center': 'flex items-center justify-center',
    'border-light': 'border-[var(--border-light)]', // 浅边框 / lighter border（搭配 border / border-b）
    'divide-light': 'divide-[var(--border-light)]', // 浅分割线 / lighter divider color（搭配 divide-y / divide-x）
    'scrollbar-hide': 'scrollbar-width-none [&::-webkit-scrollbar]:hidden',
    'item-card': 'bg-fill-0 rd-12px p-4 cursor-pointer shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-all duration-200 hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)]',
    // 分类筛选 chip：结构 + 两种互斥状态（idle / active），避免 hover 与选中态冲突
    'category-chip': 'flex-shrink-0 inline-flex items-center justify-center h-28px px-12px rd-16px border border-transparent text-12px leading-18px whitespace-nowrap cursor-pointer transition-colors',
    'category-chip-idle': 'text-secondary hover:bg-fill-2 hover:text-foreground',
    'category-chip-active': 'bg-[rgba(var(--ui-accent-orange-rgb),0.12)] text-[var(--ui-accent-orange)] font-medium',
  },
  theme: {
    colors: {
      // 合并所有颜色配置 Merge all color configurations
      ...textColors,
      ...semanticColors,
      ...backgroundColors,
      ...brandColors,
      ...aouColors,
      ...componentColors,
    },
  },
});
