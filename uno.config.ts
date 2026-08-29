import { defineConfig, presetWind3 } from 'unocss'

// 最小 UnoCSS 配置；design tokens（CSS 变量）与 transformer 在 Task 4
// 从 Sudowork 摘取时补充，保持与 Sudowork 企业端视觉一致。
export default defineConfig({
  presets: [presetWind3()],
})
