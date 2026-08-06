import { resolve } from 'path';
import { execSync } from 'child_process';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import UnoCSS from 'unocss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import unoConfig from './uno.config.ts';
import brand from './brand.config.json';

function brandHtmlPlugin() {
  const displayName = brand.displayName.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character];
  });

  return {
    name: 'brand-html',
    transformIndexHtml: (html: string) => html.replaceAll('__BRAND_DISPLAY_NAME__', displayName),
  };
}

// Icon Park transform plugin (replaces webpack icon-park-loader)
function iconParkPlugin() {
  return {
    name: 'vite-plugin-icon-park',
    enforce: 'pre' as const,
    transform(source: string, id: string) {
      if (!id.endsWith('.tsx') || id.includes('node_modules')) return null;
      if (!source.includes('@icon-park/react')) return null;
      const transformedSource = source.replace(/import\s+\{\s+([a-zA-Z, ]*)\s+\}\s+from\s+['"]@icon-park\/react['"](;?)/g, function (str, match) {
        if (!match) return str;
        const components = match.split(',');
        const importComponent = str.replace(match, components.map((key: string) => `${key} as _${key.trim()}`).join(', '));
        const hoc = `import IconParkHOC from '@renderer/components/IconParkHOC';
          ${components.map((key: string) => `const ${key.trim()} = IconParkHOC(_${key.trim()})`).join(';\n')}`;
        return importComponent + ';' + hoc;
      });
      if (transformedSource !== source) return { code: transformedSource, map: null } as { code: string; map: null };
      return null;
    },
  };
}

// Common path aliases for main process and workers
const mainAliases = {
  '@brand': resolve('brand.config.json'),
  '@': resolve('src'),
  '@common': resolve('src/common'),
  '@renderer': resolve('src/renderer'),
  '@process': resolve('src/process'),
  '@worker': resolve('src/worker'),
  '@xterm/headless': resolve('src/shims/xterm-headless.ts'),
};

/**
 * Resolve build-time metadata.
 * CI can override via environment variables; locally we fall back to git.
 */
function getBuildMetadata() {
  const gitExec = (cmd: string, fallback: string): string => {
    try {
      return execSync(cmd, { encoding: 'utf-8' }).trim() || fallback;
    } catch {
      return fallback;
    }
  };

  const date = process.env.BUILD_DATE || gitExec('git log -1 --format=%cs', new Date().toISOString().slice(0, 10));
  const commit = process.env.BUILD_COMMIT || gitExec('git rev-parse --short HEAD', 'unknown');
  const tag = gitExec('git describe --tags --exact-match', '');
  // Use injected tag directly; fall back to date-commit for untagged (temporary) builds
  const version = process.env.BUILD_VERSION || tag || `${date}-${commit}`;

  // Detect nightly: explicit env var, or tag starting with "nightly-"
  let isNightly = process.env.BUILD_IS_NIGHTLY === 'true';
  if (!isNightly) {
    if (/^nightly-/i.test(tag)) isNightly = true;
  }

  return { version, date, commit, isNightly };
}

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === 'development';
  const buildMeta = getBuildMetadata();

  // Shared define constants for build-time injection
  const buildDefines = {
    __BUILD_VERSION__: JSON.stringify(buildMeta.version),
    __BUILD_DATE__: JSON.stringify(buildMeta.date),
    __BUILD_COMMIT__: JSON.stringify(buildMeta.commit),
    __BUILD_IS_NIGHTLY__: JSON.stringify(buildMeta.isNightly),
    // Optional sudowork-server base URL injection. Empty string means "not injected"
    // so the runtime helper falls back to the literal default.
    __SUDOWORK_SERVER_BASE_URL__: JSON.stringify(process.env.BUILD_SERVER_BASE_URL ?? ''),
    // Server-driven endpoint base URLs (system-config). Same convention: empty = not injected.
    __SUDOROUTER_BASE_URL__: JSON.stringify(process.env.BUILD_SUDOROUTER_BASE_URL ?? ''),
    __SKILLHUB_BASE_URL__: JSON.stringify(process.env.BUILD_SKILLHUB_BASE_URL ?? ''),
    __LOG_REPORT_BASE_URL__: JSON.stringify(process.env.BUILD_LOG_REPORT_BASE_URL ?? ''),
    __COS_RELEASE_BASE__: JSON.stringify(process.env.BUILD_COS_RELEASE_BASE ?? ''),
  };

  return {
    main: {
      plugins: [
        // externalizeDepsPlugin replaces our custom getExternalDeps() + pluginExternalizeDynamicImports.
        // 'fix-path' excluded so it gets bundled inline (only 3KB).
        // 'v8-compile-cache' excluded so it can cache all subsequent requires (reduces startup 40-60%).
        externalizeDepsPlugin({
          exclude: ['fix-path', 'v8-compile-cache', 'unified', 'remark-parse', 'remark-gfm', 'mdast-util-from-markdown', 'mdast-util-gfm', 'docx'],
          include: ['nexus-napi'],
        }),
        ...(!isDevelopment
          ? [
              viteStaticCopy({
                structured: false,
                targets: [
                  { src: 'skills/**', dest: 'skills' },
                  { src: 'rules/**', dest: 'rules' },
                  { src: 'assistant/**', dest: 'assistant' },
                  { src: 'src/renderer/assets/logos/**', dest: 'static/images' },
                ],
              }),
            ]
          : []),
      ],
      resolve: { alias: mainAliases, extensions: ['.ts', '.tsx', '.js', '.json'] },
      build: {
        sourcemap: false,
        reportCompressedSize: false,
        rollupOptions: {
          input: {
            index: resolve('src/index.ts'),
          },
          external: ['@lydell/node-pty'],
          onwarn(warning, warn) {
            if (warning.code === 'EVAL') return;
            warn(warning);
          },
        },
      },
      define: { 'process.env.env': JSON.stringify(process.env.env), ...buildDefines },
    },

    preload: {
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: { '@brand': resolve('brand.config.json'), '@': resolve('src'), '@common': resolve('src/common') },
        extensions: ['.ts', '.tsx', '.js', '.json'],
      },
      build: {
        sourcemap: false,
        reportCompressedSize: false,
        rollupOptions: {
          input: {
            index: resolve('src/preload.ts'),
            avatar: resolve('src/preload-avatar.ts'),
          },
        },
      },
    },

    renderer: {
      base: './',
      server: {
        // Port for Vite dev server. On Windows, WinNAT/Hyper-V can reserve ports
        // causing EACCES. launch-dev.js probes for a free port and passes it via
        // VITE_DEV_SERVER_PORT. electron-vite sets ELECTRON_RENDERER_URL to the
        // actual URL, so Electron main process loads the correct origin.
        port: parseInt(process.env.VITE_DEV_SERVER_PORT || '5174', 10),
        // Explicit HMR config so Vite client connects directly to the Vite dev server,
        // not to the WebUI proxy server (which would reject the WebSocket and cause infinite reload)
        hmr: {
          host: 'localhost',
        },
      },
      resolve: {
        alias: {
          '@brand': resolve('brand.config.json'),
          '@': resolve('src'),
          '@common': resolve('src/common'),
          '@renderer': resolve('src/renderer'),
          '@process': resolve('src/process'),
          '@worker': resolve('src/worker'),
          // Force ESM version of streamdown
          streamdown: resolve('node_modules/streamdown/dist/index.js'),
        },
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.css'],
        dedupe: ['react', 'react-dom', 'react-router-dom', '@codemirror/state', '@codemirror/view', '@codemirror/language'],
      },
      plugins: [react(), UnoCSS(unoConfig), iconParkPlugin(), brandHtmlPlugin()],
      build: {
        target: 'es2022',
        sourcemap: isDevelopment,
        minify: !isDevelopment,
        reportCompressedSize: false,
        chunkSizeWarningLimit: 1500,
        cssCodeSplit: true,
        rollupOptions: {
          input: {
            index: resolve('src/renderer/index.html'),
            avatar: resolve('src/renderer/avatar/index.html'),
          },
          external: ['node:crypto', 'crypto'],
        },
      },
      define: {
        'process.env.env': JSON.stringify(process.env.env),
        global: 'globalThis',
        ...buildDefines,
      },
      optimizeDeps: {
        exclude: ['electron'],
        include: [
          'react',
          'react-dom',
          'react-router-dom',
          'react-i18next',
          'i18next',
          '@arco-design/web-react',
          '@icon-park/react',
          'react-markdown',
          'react-syntax-highlighter',
          'react-virtuoso',
          'classnames',
          'swr',
          'eventemitter3',
          'katex',
          'diff2html',
          'remark-gfm',
          'remark-math',
          'remark-breaks',
          'rehype-raw',
          'rehype-katex',
        ],
      },
    },
  };
});
