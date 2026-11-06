import { resolve } from 'node:path';
import { defineConfig, presetMini, presetWind3, transformerDirectives, transformerVariantGroup } from 'unocss';
import { presetExtra } from 'unocss-preset-extra';
import { presetSudowork } from '../../packages/renderer/uno.preset';

export default defineConfig({
  presets: [presetMini(), presetExtra(), presetWind3(), presetSudowork()],
  transformers: [transformerVariantGroup(), transformerDirectives({ enforce: 'pre' })],
  content: {
    // filesystem 全量扫描仅 dev 用于消除 FOUC(让首次 uno.css 即含全部 utility);
    // 生产置空走 pipeline(模块图),避免死文件 class 混入产物。
    // 绝对路径绕开 @unocss/vite filesystem glob 的 cwd=config.root(=src/renderer)问题。
    filesystem: process.env.NODE_ENV === 'development' ? [resolve(process.cwd(), '../../packages/renderer/src/**/*.{ts,tsx}'), resolve(process.cwd(), '../../packages/ontology-ai/src/**/*.{ts,tsx}'), resolve(process.cwd(), '../../packages/ontology-ui/src/**/*.{ts,tsx}')] : [],
    pipeline: {
      // Use RegExp instead of glob strings so patterns match against absolute
      // module IDs regardless of the Vite root directory.  electron-vite sets
      // the renderer root to src/renderer/, which causes glob patterns like
      // 'src/**/*.tsx' to resolve to the non-existent src/renderer/src/ path.
      include: [/\.[jt]sx?($|\?)/, /\.vue($|\?)/, /\.css($|\?)/],
      exclude: [/[\\/]node_modules[\\/]/, /\.html($|\?)/],
    },
  },
});
