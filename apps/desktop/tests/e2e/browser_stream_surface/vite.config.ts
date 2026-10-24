import path from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import UnoCss from 'unocss/vite';
import sharedUno from '../../../uno.config';
import { browserPageViewAlias } from '../../../../../scripts/browser-view-alias.mjs';

const repository = path.resolve(__dirname, '../../../../..');
const rendererRequire = createRequire(path.join(repository, 'packages/renderer/package.json'));

export default defineConfig({
  root: __dirname,
  publicDir: false,
  plugins: [UnoCss(sharedUno)],
  resolve: { alias: [browserPageViewAlias, { find: /^react$/, replacement: rendererRequire.resolve('react') }, { find: /^react\/jsx-runtime$/, replacement: rendererRequire.resolve('react/jsx-runtime') }, { find: /^react-dom\/client$/, replacement: rendererRequire.resolve('react-dom/client') }] },
  esbuild: { jsx: 'automatic' },
  build: { outDir: process.env.STREAM_VIEWER_OUTDIR || path.join(__dirname, 'dist'), emptyOutDir: false },
});
