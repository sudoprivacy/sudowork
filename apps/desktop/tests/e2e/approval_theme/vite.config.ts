import path from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import UnoCss from 'unocss/vite';
import desktop from '../../../uno.config';
import webui from '../../../../webui/uno.config';

const rendererRequire = createRequire(path.resolve(__dirname, '../../../../../packages/renderer/package.json'));
export default defineConfig({
  root: __dirname,
  publicDir: false,
  plugins: [UnoCss(process.env.APPROVAL_THEME_HOST === 'webui' ? webui : desktop)],
  resolve: {
    alias: [
      { find: '@sudowork/host-bridge/ipcBridge', replacement: path.join(__dirname, 'bridge.ts') },
      { find: /^react$/, replacement: rendererRequire.resolve('react') },
      { find: /^react\/jsx-runtime$/, replacement: rendererRequire.resolve('react/jsx-runtime') },
      { find: /^react-dom\/client$/, replacement: rendererRequire.resolve('react-dom/client') },
    ],
  },
  esbuild: { jsx: 'automatic' },
});
