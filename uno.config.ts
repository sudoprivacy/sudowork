// uno.config.ts
import { resolve } from 'node:path';
import { defineConfig, presetMini, presetWind3, transformerDirectives, transformerVariantGroup } from 'unocss';
import { presetExtra } from 'unocss-preset-extra';

const colors = {
  'card-foreground': 'var(--card-foreground)',
  'popover-foreground': 'var(--popover-foreground)',
  foreground: 'var(--foreground)',
  'foreground-secondary': 'var(--foreground-secondary)',
  'foreground-tertiary': 'var(--foreground-tertiary)',
  'foreground-quaternary': 'var(--foreground-quaternary)',
  'secondary-foreground': 'var(--secondary-foreground)',
  'muted-foreground': 'var(--muted-foreground)',
  'accent-foreground': 'var(--accent-foreground)',
  primary: 'var(--primary)',
  'primary-foreground': 'var(--primary-foreground)',
  brand: 'var(--brand)',
  'brand-foreground': 'var(--brand-foreground)',
  'secondary-brand': 'var(--secondary-brand)',
  'secondary-brand-foreground': 'var(--secondary-brand-foreground)',
  destructive: 'var(--destructive)',
  'destructive-foreground': 'var(--destructive-foreground)',
  link: 'var(--link)',
  'link-foreground': 'var(--link-foreground)',
  warning: 'var(--warning)',
  'warning-foreground': 'var(--warning-foreground)',
  success: 'var(--success)',
  'success-foreground': 'var(--success-foreground)',
  blue: 'var(--blue)',
  'blue-foreground': 'var(--blue-foreground)',
  orange: 'var(--orange)',
  'orange-foreground': 'var(--orange-foreground)',
  violet: 'var(--violet)',
  'violet-foreground': 'var(--violet-foreground)',
};

export default defineConfig({
  presets: [presetMini(), presetExtra(), presetWind3()],
  transformers: [transformerVariantGroup(), transformerDirectives({ enforce: 'pre' })],
  blocklist: [
    // 旧 UnoCSS 颜色接口：硬切后禁止继续生成，等待各功能区域逐步迁移。
    /(?:^|:)[!]?(?:bg-(?:base|faint|subtle|control|emphasis|strong|hover|active|[1-6])|(?:bg|text|border)-(?:danger|info)|text-(?:secondary|tertiary|[0-4])|border-(?:light|default|tiny)|divide-(?:light|tiny)|bg-fill-[0-4]|bg-primary-light-[1-4]|(?:bg|border)-(?:success|warning|danger)-(?:soft|line))(?:\/\d+)?$/,
  ],
  content: {
    // 开发环境扫描完整 Renderer，生产环境只扫描进入模块图的源码。
    filesystem: process.env.NODE_ENV === 'development' ? [resolve(process.cwd(), 'src/renderer/**/*.{ts,tsx}')] : [],
    pipeline: {
      include: [/\.[jt]sx?($|\?)/, /\.vue($|\?)/, /\.css($|\?)/],
      exclude: [/[\\/]node_modules[\\/]/, /\.html($|\?)/],
    },
  },
  rules: [
    // 新规范 Token：背景类只生成 bg-*，避免 text-secondary 等旧 class 被错误复活。
    ['bg-background', { 'background-color': 'var(--background)' }],
    ['bg-card', { 'background-color': 'var(--card)' }],
    ['bg-popover', { 'background-color': 'var(--popover)' }],
    ['bg-secondary', { 'background-color': 'var(--secondary)' }],
    ['bg-muted', { 'background-color': 'var(--muted)' }],
    ['bg-accent', { 'background-color': 'var(--accent)' }],
    ['bg-fill', { 'background-color': 'var(--fill)' }],
    ['bg-fill-default', { 'background-color': 'var(--fill-default)' }],
    ['bg-fill-shallow', { 'background-color': 'var(--fill-shallow)' }],
    ['bg-fill-medium', { 'background-color': 'var(--fill-medium)' }],
    ['bg-fill-deep', { 'background-color': 'var(--fill-deep)' }],
    ['bg-mask', { 'background-color': 'var(--mask)' }],
    ['bg-spotlight', { 'background-color': 'var(--spotlight)' }],
    ['border-border', { 'border-color': 'var(--border)' }],
    ['border-shallow', { 'border-color': 'var(--border-shallow)' }],
    ['border-medium', { 'border-color': 'var(--border-medium)' }],
    ['border-deep', { 'border-color': 'var(--border-deep)' }],
    ['border-input', { 'border-color': 'var(--input)' }],
    ['ring-ring', { '--un-ring-color': 'var(--ring)' }],
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
          border-color: var(--border);
        }
      `,
    },
  ],
  shortcuts: {
    'f-center': 'flex items-center justify-center',
    'scrollbar-hide': '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
    'rounded-md': '[border-radius:var(--radius-md)]',
    'rounded-lg': '[border-radius:var(--radius-lg)]',
    'rounded-xl': '[border-radius:var(--radius-xl)]',
    'shadow-sm': '[box-shadow:var(--shadow-sm)]',
    'shadow-md': '[box-shadow:var(--shadow-md)]',
    'shadow-lg': '[box-shadow:var(--shadow-lg)]',
    'shadow-xl': '[box-shadow:var(--shadow-xl)]',
    'shadow-focus': '[box-shadow:var(--shadow-focus)]',
    card: 'bg-card rd-3 p-4 cursor-pointer shadow-sm transition-all duration-200 hover:-translate-y-px hover:shadow-md',
    'category-chip': 'flex-shrink-0 inline-flex items-center justify-center h-28px px-12px rd-16px border border-transparent text-12px leading-18px whitespace-nowrap cursor-pointer transition-colors',
    'category-chip-idle': 'text-foreground-secondary hover:bg-accent hover:text-foreground',
    'category-chip-active': 'bg-secondary-brand text-brand font-medium',
    'bg-brand-surface': '[background-color:var(--brand-surface)]',
    'bg-warning-surface': '[background-color:var(--warning-surface)]',
  },
  theme: { colors },
});
