#!/usr/bin/env node

/**
 * Bundle openclaw runtime into a single aggregated JS file using esbuild.
 *
 * Reduces the thousands of files in node_modules/ down to one `openclaw.mjs`
 * plus only the native addon directories that cannot be bundled.
 *
 * Usage:
 *   node scripts/bundle-openclaw.js <package-dir>
 *
 * The script:
 *   1. Discovers native addons (.node files) and marks them external
 *   2. Bundles dist/entry.js (or dist/entry.mjs) + all JS deps into openclaw.mjs
 *   3. Cleans node_modules/ to keep only native binding directories
 *   4. Writes bundle-manifest.json for downstream validation
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Packages that use dynamic require/import or optional native bindings.
 *  These are externalized so esbuild doesn't try to resolve them at bundle time. */
const KNOWN_OPTIONAL_EXTERNALS = [
  // LLM / AI
  'node-llama-cpp',
  // Media
  'ffmpeg-static',
  '@discordjs/opus',
  'node-opus',
  'opusscript',
  'sodium',
  'sodium-native',
  'libsodium-wrappers',
  'tweetnacl',
  'erlpack',
  'bufferutil',
  'utf-8-validate',
  'zlib-sync',
  'cpu-features',
  // Playwright / Chromium
  'playwright',
  'playwright-core',
  'chromium-bidi',
  'chromium-bidi/lib/cjs/bidiMapper/BidiMapper',
  'chromium-bidi/lib/cjs/cdp/CdpConnection',
  // Native / platform
  'koffi',
  // Sharp platform variants
  '@img/sharp-darwin-arm64',
  '@img/sharp-darwin-x64',
  '@img/sharp-linux-arm',
  '@img/sharp-linux-arm64',
  '@img/sharp-linux-s390x',
  '@img/sharp-linux-x64',
  '@img/sharp-linuxmusl-arm64',
  '@img/sharp-linuxmusl-x64',
  '@img/sharp-wasm32',
  '@img/sharp-win32-ia32',
  '@img/sharp-win32-x64',
  // Node-pty platform variants
  '@lydell/node-pty-darwin-arm64',
  '@lydell/node-pty-darwin-x64',
  '@lydell/node-pty-linux-arm64',
  '@lydell/node-pty-linux-x64',
  '@lydell/node-pty-win32-x64',
  // Clipboard platform variants
  '@mariozechner/clipboard-darwin-arm64',
  '@mariozechner/clipboard-darwin-x64',
  '@mariozechner/clipboard-linux-arm64-gnu',
  '@mariozechner/clipboard-linux-x64-gnu',
  '@mariozechner/clipboard-win32-x64-msvc',
  // Canvas platform variants
  '@napi-rs/canvas-darwin-arm64',
  '@napi-rs/canvas-darwin-x64',
  '@napi-rs/canvas-linux-arm64-gnu',
  '@napi-rs/canvas-linux-arm64-musl',
  '@napi-rs/canvas-linux-x64-gnu',
  '@napi-rs/canvas-linux-x64-musl',
  '@napi-rs/canvas-win32-x64-msvc',
  // Davey platform variants
  '@snazzah/davey-darwin-arm64',
  '@snazzah/davey-darwin-x64',
  '@snazzah/davey-linux-arm64-gnu',
  '@snazzah/davey-linux-x64-gnu',
  '@snazzah/davey-win32-x64-msvc',
];

/** Node.js built-in modules (with and without node: prefix) */
function getNodeBuiltins() {
  const builtins = [
    'assert', 'assert/strict', 'async_hooks', 'buffer', 'child_process',
    'cluster', 'console', 'constants', 'crypto', 'dgram',
    'diagnostics_channel', 'dns', 'dns/promises', 'domain', 'events',
    'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
    'inspector/promises', 'module', 'net', 'os', 'path', 'path/posix',
    'path/win32', 'perf_hooks', 'process', 'punycode', 'querystring',
    'readline', 'readline/promises', 'repl', 'sea', 'sqlite', 'stream',
    'stream/consumers', 'stream/promises', 'stream/web', 'string_decoder',
    'sys', 'test', 'test/reporters', 'timers', 'timers/promises', 'tls',
    'trace_events', 'tty', 'url', 'util', 'util/types', 'v8', 'vm',
    'wasi', 'worker_threads', 'zlib',
  ];
  const result = [];
  for (const b of builtins) {
    result.push(b, `node:${b}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countFiles(dir) {
  let count = 0;
  if (!fs.existsSync(dir)) return 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else count++;
    }
  };
  walk(dir);
  return count;
}

/** Find native addon packages by scanning for .node files in node_modules */
function discoverNativeExternals(pkgDir) {
  const nmDir = path.join(pkgDir, 'node_modules');
  if (!fs.existsSync(nmDir)) return [];

  const nativePackages = new Set();

  const walk = (dir, depth) => {
    if (depth > 4) return; // Don't recurse too deep
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('@')) {
          // Scoped package - go one level deeper
          walk(full, depth);
        } else if (entry.name !== '.package-lock.json') {
          walk(full, depth + 1);
        }
      } else if (entry.name.endsWith('.node')) {
        // Determine the package name from the path
        const rel = path.relative(nmDir, full);
        const parts = rel.split(path.sep);
        const pkgName = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
        nativePackages.add(pkgName);
      }
    }
  };

  walk(nmDir, 0);
  return [...nativePackages];
}

/** Get directories that should be kept in node_modules (native addons only) */
function getNativeModuleDirs(pkgDir, nativeExternals) {
  const nmDir = path.join(pkgDir, 'node_modules');
  const keepDirs = new Set();

  for (const ext of nativeExternals) {
    const extPath = path.join(nmDir, ext);
    if (fs.existsSync(extPath)) {
      keepDirs.add(ext);
      // For scoped packages, also keep the scope directory
      if (ext.startsWith('@')) {
        keepDirs.add(ext.split('/')[0]);
      }
    }
  }

  return keepDirs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const pkgDir = process.argv[2];
  if (!pkgDir || !fs.existsSync(pkgDir)) {
    console.error('Usage: node scripts/bundle-openclaw.js <package-dir>');
    process.exit(1);
  }

  const resolvedPkgDir = path.resolve(pkgDir);
  const nmDir = path.join(resolvedPkgDir, 'node_modules');

  // Find entry point
  const entryJs = path.join(resolvedPkgDir, 'dist', 'entry.js');
  const entryMjs = path.join(resolvedPkgDir, 'dist', 'entry.mjs');
  const entryPoint = fs.existsSync(entryJs) ? entryJs : fs.existsSync(entryMjs) ? entryMjs : null;

  if (!entryPoint) {
    console.error('[bundle-openclaw] No dist/entry.js or dist/entry.mjs found');
    process.exit(1);
  }

  const outputFile = path.join(resolvedPkgDir, 'openclaw.mjs');
  const filesBefore = countFiles(resolvedPkgDir);
  console.log(`[bundle-openclaw] Files before bundling: ${filesBefore}`);

  // Discover native externals
  const nativeExternals = discoverNativeExternals(resolvedPkgDir);
  console.log(`[bundle-openclaw] Native externals: ${nativeExternals.join(', ') || '(none)'}`);

  // Build complete externals list
  const allExternals = [
    ...getNodeBuiltins(),
    ...KNOWN_OPTIONAL_EXTERNALS,
    ...nativeExternals,
  ];
  // Deduplicate
  const externalSet = new Set(allExternals);
  const externals = [...externalSet];

  console.log('[bundle-openclaw] Running esbuild...');
  console.log(`[bundle-openclaw]   Entry: ${entryPoint}`);
  console.log(`[bundle-openclaw]   Output: ${outputFile}`);
  console.log(`[bundle-openclaw]   Externals: ${externals.length} patterns`);

  // Load esbuild - try local project first, then require
  let esbuild;
  const localEsbuild = path.join(__dirname, '..', 'node_modules', 'esbuild');
  try {
    if (fs.existsSync(localEsbuild)) {
      console.log(`[bundle-openclaw] Using esbuild from: ${localEsbuild}`);
      esbuild = require(localEsbuild);
    } else {
      esbuild = require('esbuild');
    }
  } catch (err) {
    console.error(`[bundle-openclaw] Failed to load esbuild: ${err.message}`);
    process.exit(1);
  }

  // Catch-all plugin: externalize any bare specifier that esbuild can't resolve.
  // This prevents future breakage from new optional dependencies.
  const catchAllExternalPlugin = {
    name: 'catch-all-external',
    setup(build) {
      // Track what we auto-externalize for logging
      const autoExternalized = new Set();

      build.onResolve({ filter: /.*/ }, (args) => {
        // Only intercept unresolvable bare specifiers (not relative/absolute paths)
        if (args.path.startsWith('.') || args.path.startsWith('/') || /^[A-Za-z]:/.test(args.path)) {
          return null; // Let esbuild handle relative/absolute paths
        }
        // Let esbuild try to resolve it first - we only catch failures
        return null;
      });

      // Use onResolve with a lower priority (higher filter specificity) as fallback
      // Actually, esbuild doesn't have priority - use the onEnd to log warnings
      // Instead, we use a resolve callback that returns external for known-problematic patterns
      build.onResolve({ filter: /^[^./]/ }, async (args) => {
        // Skip if already in our external list (esbuild handles those)
        if (externalSet.has(args.path)) return null;

        // Try to let esbuild resolve it normally first
        try {
          const result = await build.resolve(args.path, {
            kind: args.kind,
            resolveDir: args.resolveDir,
            importer: args.importer,
          });
          if (result.errors.length === 0) {
            return null; // Resolution succeeded, let esbuild bundle it
          }
        } catch {
          // Resolution failed
        }

        // Auto-externalize unresolvable bare specifiers
        if (!autoExternalized.has(args.path)) {
          autoExternalized.add(args.path);
          console.log(`[bundle-openclaw] Auto-externalizing unresolvable: ${args.path}`);
        }
        return { path: args.path, external: true };
      });
    },
  };

  // Banner to provide __dirname/__filename/require for ESM
  const banner = [
    "import { fileURLToPath as __bundled_fileURLToPath } from 'node:url';",
    "import { dirname as __bundled_dirname_fn } from 'node:path';",
    "import { createRequire as __bundled_createRequire } from 'node:module';",
    'const __bundled_dirname = __bundled_dirname_fn(__bundled_fileURLToPath(import.meta.url));',
    'const __bundled_filename = __bundled_fileURLToPath(import.meta.url);',
    'const require = __bundled_createRequire(import.meta.url);',
  ].join('\n');

  try {
    const result = await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: outputFile,
      target: 'node20',
      sourcemap: 'external',
      treeShaking: true,
      external: externals,
      banner: { js: banner },
      define: {
        '__dirname': '__bundled_dirname',
        '__filename': '__bundled_filename',
      },
      plugins: [catchAllExternalPlugin],
      logLevel: 'warning',
      // Allow esbuild to handle errors gracefully
      logOverride: {
        'import-is-undefined': 'silent',
      },
    });

    if (result.errors.length > 0) {
      console.error('[bundle-openclaw] esbuild reported errors:');
      for (const err of result.errors) {
        console.error(`  ${err.text}`);
      }
      throw new Error('esbuild build failed with errors');
    }

    if (result.warnings.length > 0) {
      console.log(`[bundle-openclaw] esbuild warnings: ${result.warnings.length}`);
      for (const w of result.warnings.slice(0, 10)) {
        console.log(`  ${w.text}`);
      }
      if (result.warnings.length > 10) {
        console.log(`  ... and ${result.warnings.length - 10} more`);
      }
    }
  } catch (err) {
    console.error(`[bundle-openclaw] esbuild build failed: ${err.message}`);
    throw err;
  }

  // Verify output was created
  if (!fs.existsSync(outputFile)) {
    throw new Error('esbuild did not produce output file');
  }

  const outputSize = fs.statSync(outputFile).size;
  console.log(`[bundle-openclaw] Bundle created: ${outputFile} (${(outputSize / 1024 / 1024).toFixed(1)} MB)`);

  // Clean up node_modules - keep only native binding directories
  console.log('[bundle-openclaw] Cleaning node_modules (keeping native addons only)...');
  const keepDirs = getNativeModuleDirs(resolvedPkgDir, [...nativeExternals, ...KNOWN_OPTIONAL_EXTERNALS]);

  if (fs.existsSync(nmDir)) {
    const topEntries = fs.readdirSync(nmDir, { withFileTypes: true });
    let removedCount = 0;

    for (const entry of topEntries) {
      const entryName = entry.name;
      const fullPath = path.join(nmDir, entryName);

      if (entryName === '.package-lock.json') {
        fs.unlinkSync(fullPath);
        removedCount++;
        continue;
      }

      if (entryName.startsWith('@')) {
        // Scoped package directory
        if (!keepDirs.has(entryName)) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          removedCount++;
        } else {
          // Keep only the specific packages we need within the scope
          const scopedEntries = fs.readdirSync(fullPath, { withFileTypes: true });
          for (const scopedEntry of scopedEntries) {
            const scopedName = `${entryName}/${scopedEntry.name}`;
            if (!keepDirs.has(scopedName) && !nativeExternals.includes(scopedName) && !KNOWN_OPTIONAL_EXTERNALS.includes(scopedName)) {
              fs.rmSync(path.join(fullPath, scopedEntry.name), { recursive: true, force: true });
              removedCount++;
            }
          }
        }
      } else if (!keepDirs.has(entryName)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        removedCount++;
      }
    }

    console.log(`[bundle-openclaw] Removed ${removedCount} directories from node_modules`);
  }

  // Write bundle manifest
  const filesAfter = countFiles(resolvedPkgDir);
  const manifest = {
    bundled: true,
    entry: 'openclaw.mjs',
    originalEntry: path.relative(resolvedPkgDir, entryPoint),
    outputSize,
    nativeExternals,
    filesBefore,
    filesAfter,
    reduction: `${((1 - filesAfter / filesBefore) * 100).toFixed(1)}%`,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(resolvedPkgDir, 'bundle-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8'
  );

  console.log(`[bundle-openclaw] Files after bundling: ${filesAfter}`);
  console.log(`[bundle-openclaw] Reduction: ${filesBefore} -> ${filesAfter} (${manifest.reduction})`);
  console.log('[bundle-openclaw] Done.');
}

main().catch((err) => {
  console.error(`[bundle-openclaw] FATAL: ${err.message}`);
  process.exit(1);
});
