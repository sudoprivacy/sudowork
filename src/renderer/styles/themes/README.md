# Theme System 主题系统

## Architecture Overview 架构概览

The theme system has two dimensions: light/dark mode and CSS themes. A shared base
variable layer provides defaults; CSS themes override it on top.
主题系统分两个维度：明暗模式与 CSS 主题。共享的 base 变量层提供默认值，CSS 主题在其上叠加覆盖。

### Two Dimensions 两个维度

1. **Light/Dark Mode 明暗模式** (`theme`)
   - Controlled by `useTheme` hook
   - Values: `'light'` | `'dark'`
   - Controls: `[data-theme]` attribute on `<html>` and `arco-theme` attribute on `<body>`
   - 由 `useTheme` Hook 控制
   - 取值：`'light'` | `'dark'`
   - 控制：`<html>` 的 `[data-theme]` 属性和 `<body>` 的 `arco-theme` 属性

2. **CSS Theme CSS 主题** (`css.activeThemeId`)
   - Managed by `CssThemeSettings` + `themeCssSync`; injected as a `<style>` at the end of `<head>`
   - Each theme is a self-contained set of CSS variables that overrides the base layer
   - 由 `CssThemeSettings` + `themeCssSync` 管理；以 `<style>` 注入到 `<head>` 末尾
   - 每个主题是一套自包含的 CSS 变量，覆盖 base 层

### Base Variable Layer 基底变量层

`color-schemes/default.css` is the **base variable layer** (not a switchable scheme): it is
statically imported into the bundle, defines the full `:root` (light) and `[data-theme='dark']`
variable set, and serves as the first-paint fallback plus the default for any variable a CSS
theme does not override.
`color-schemes/default.css` 是 **base 变量层**（不再是可切换的配色方案）：它被静态打包进 bundle，
定义完整的 `:root`（亮色）与 `[data-theme='dark']`（暗色）变量集，作为首屏兜底以及 CSS 主题未覆盖变量的默认值。

### File Structure 文件结构

```
styles/themes/
├── index.css                 # Entry point 入口文件
├── base.css                  # Theme-independent base styles 主题无关的基础样式
└── color-schemes/
    └── default.css           # Base variable layer 基底变量层（light + dark）
```

## How to Adjust Base Variables 如何调整基底变量

Edit `color-schemes/default.css`. Keep both the `:root` (light) and `[data-theme='dark']`
blocks in sync. To ship a distinct look, add a CSS theme via the CSS theme settings instead
— it overrides the base layer at runtime.
编辑 `color-schemes/default.css`，并保持 `:root`（亮色）与 `[data-theme='dark']`（暗色）两块同步。
若要提供不同外观，请通过 CSS 主题设置新增一个 CSS 主题——它会在运行时覆盖 base 层。

## CSS Variable Naming Convention CSS 变量命名规范

### Brand Colors 品牌色

- `--aou-1` to `--aou-10`: Brand color palette (1=lightest, 10=darkest)
- `--aou-1` 到 `--aou-10`：品牌色调色板（1=最浅，10=最深）

### Background Colors 背景色

- `--bg-base`: Main background 主背景
- `--bg-1`: Secondary background 次级背景
- `--bg-2`: Tertiary background 三级背景
- `--bg-3`: Border/divider 边框/分隔线
- `--bg-hover`: Hover state 悬停状态
- `--bg-active`: Active/pressed state 激活/按下状态

### Text Colors 文字色

- `--text-primary`: Primary text 主要文字
- `--text-secondary`: Secondary text 次要文字
- `--text-disabled`: Disabled text 禁用文字

### Semantic Colors 语义色

- `--primary`: Primary action color 主要操作色
- `--success`: Success state 成功状态
- `--warning`: Warning state 警告状态
- `--danger`: Danger state 危险状态

### Brand-specific Colors 品牌专用色

- `--brand`: Main brand color 主品牌色
- `--brand-light`: Light brand background 浅色品牌背景
- `--brand-hover`: Brand hover state 品牌悬停状态

### Component-specific Colors 组件专用色

- `--message-user-bg`: User message background 用户消息背景
- `--message-tips-bg`: Tips message background 提示消息背景
- `--workspace-btn-bg`: Workspace button background 工作区按钮背景

## Best Practices 最佳实践

1. **Always define both light and dark variants** for each color scheme
   每个配色方案都要定义浅色和暗色两个变体

2. **Maintain consistent lightness progression** in brand color scales (1→10)
   保持品牌色阶的明度递进一致性（1→10）

3. **Test in both light and dark modes** before finalizing
   在确定前测试浅色和暗色两种模式

4. **Use semantic names** for component-specific colors
   组件专用色使用语义化命名

5. **Keep background colors neutral** (grays) to maintain readability
   保持背景色中性（灰色系）以维持可读性

## Current Status 当前状态

- ✅ Base variable layer in place (light + dark) base 变量层就绪（亮色 + 暗色）
- ✅ CSS themes override the base layer at runtime CSS 主题在运行时覆盖 base 层
