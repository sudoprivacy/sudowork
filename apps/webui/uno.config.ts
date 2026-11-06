import {
  defineConfig,
  presetMini,
  presetWind3,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'
import { presetExtra } from 'unocss-preset-extra'
import { presetSudowork } from '../../packages/renderer/uno.preset'

export default defineConfig({
  content: { filesystem: ['../../packages/renderer/src/**/*.{ts,tsx}'] },
  presets: [presetMini(), presetExtra(), presetWind3(), presetSudowork()],
  transformers: [transformerVariantGroup(), transformerDirectives({ enforce: 'pre' })],
})
