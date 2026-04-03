/**
 * Bundle openclaw runtime into a single aggregated JS file using esbuild.
 *
 * Reduces the packaged file count from ~40k to a handful by consolidating
 * all JS runtime code into one `openclaw.mjs` file, keeping only native
 * addon bindings as separate node_modules entries.
 *
 * Usage:
 *   Standalone:  node scripts/bundle-openclaw.js <package-dir>
 *   Programmatic: const { bundleOpenclaw } = require('./bundle-openclaw.js');
 *                 await bundleOpenclaw(packageDir);
 *
 * The script uses esbuild's async JS API (required for plugin support).
 * A catch-all plugin auto-externalizes any unresolvable bare specifiers,
 * preventing build failures from optional/dynamic dependencies.
 */

const fs = require('fs');
const path = require('path');

// Known optional/dynamic dependencies that should be externalized.
// These are packages that openclaw or its transitive deps try to
// require/import dynamically but aren't always installed.
const KNOWN_OPTIONAL_EXTERNALS = [
  // LLM / AI
  'node-llama-cpp',
  // Media / audio
  'ffmpeg-static',
  '@discordjs/opus',
  'node-opus',
  'opusscript',
  'sodium',
  'sodium-native',
  'libsodium-wrappers',
  'tweetnacl',
  'zlib-sync',
  'erlpack',
  'bufferutil',
  'utf-8-validate',
  'cpu-features',
  // Playwright / browser automation
  'playwright',
  'playwright-core',
  'chromium-bidi',
  'chromium-bidi/lib/cjs/bidiMapper/BidiMapper',
  'chromium-bidi/lib/cjs/cdp/CdpConnection',
  // Native binding platform variants — all platforms listed so the
  // bundle script works cross-platform without filtering
  '@img/sharp-darwin-arm64', '@img/sharp-darwin-x64',
  '@img/sharp-linux-arm', '@img/sharp-linux-arm64',
  '@img/sharp-linux-s390x', '@img/sharp-linux-x64',
  '@img/sharp-linuxmusl-arm64', '@img/sharp-linuxmusl-x64',
  '@img/sharp-wasm32',
  '@img/sharp-win32-ia32', '@img/sharp-win32-x64',
  '@lydell/node-pty-darwin-arm64', '@lydell/node-pty-darwin-x64',
  '@lydell/node-pty-linux-arm64', '@lydell/node-pty-linux-x64',
  '@lydell/node-pty-win32-x64',
  '@mariozechner/clipboard-darwin-arm64', '@mariozechner/clipboard-darwin-x64',
  '@mariozechner/clipboard-darwin-universal',
  '@mariozechner/clipboard-linux-arm64-gnu', '@mariozechner/clipboard-linux-x64-gnu',
  '@mariozechner/clipboard-win32-x64-msvc',
  '@napi-rs/canvas-darwin-arm64', '@napi-rs/canvas-darwin-x64',
  '@napi-rs/canvas-linux-arm64-gnu', '@napi-rs/canvas-linux-arm64-musl',
  '@napi-rs/canvas-linux-x64-gnu', '@napi-rs/canvas-linux-x64-musl',
  '@napi-rs/canvas-win32-x64-msvc',
  '@snazzah/davey-darwin-arm64', '@snazzah/davey-darwin-x64',
  '@snazzah/davey-linux-arm64-gnu', '@snazzah/davey-linux-x64-gnu',
  '@snazzah/davey-win32-x64-msvc',
  // FFI
  'koffi',
];

// Node.js built-in modules (both bare and node: prefixed)
const NODE_BUILTINS = [
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

/**
 * Count files recursively in a directory.
 */
function countFiles(dir) {
  let count = 0;
  if (!fs.existsSync(dir)) return 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(fullPath);
    } else {
      count++;
    }
  }
  return count;
}

/**
 * Discover native addon externals by scanning node_modules for .node files.
 * Returns a Set of package names that contain native bindings.
 */
function discoverNativeExternals(pkgDir) {
  const nm = path.join(pkgDir, 'node_modules');
  const nativePackages = new Set();

  if (!fs.existsSync(nm)) return nativePackages;

  function scanDir(dir, depth = 0) {
    if (depth > 4) return; // Don't go too deep
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name.endsWith('.node')) {
          // Extract package name from path relative to node_modules
          const rel = path.relative(nm, dir);
          const parts = rel.split(path.sep);
          const pkgName = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
          nativePackages.add(pkgName);
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          scanDir(fullPath, depth + 1);
        }
      }
    } catch {
      // Ignore permission errors etc.
    }
  }

  scanDir(nm);
  return nativePackages;
}

/**
 * Remove non-native node_modules directories after bundling.
 * Keeps only directories that contain native .node bindings.
 */
function cleanNodeModules(pkgDir, nativePackages) {
  const nm = path.join(pkgDir, 'node_modules');
  if (!fs.existsSync(nm)) return;

  const entries = fs.readdirSync(nm, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      // Remove loose files in node_modules root
      try { fs.unlinkSync(path.join(nm, entry.name)); } catch {}
      continue;
    }

    const fullPath = path.join(nm, entry.name);

    if (entry.name.startsWith('@')) {
      // Scoped package — check each sub-package
      const scopeEntries = fs.readdirSync(fullPath, { withFileTypes: true });
      for (const scopeEntry of scopeEntries) {
        const scopedName = `${entry.name}/${scopeEntry.name}`;
        if (!nativePackages.has(scopedName)) {
          try { fs.rmSync(path.join(fullPath, scopeEntry.name), { recursive: true, force: true }); } catch {}
        }
      }
      // Remove scope dir if empty
      try {
        const remaining = fs.readdirSync(fullPath);
        if (remaining.length === 0) fs.rmdirSync(fullPath);
      } catch {}
    } else if (entry.name === '.package-lock.json') {
      try { fs.unlinkSync(fullPath); } catch {}
    } else if (!nativePackages.has(entry.name)) {
      try { fs.rmSync(fullPath, { recursive: true, force: true }); } catch {}
    }
  }
}

/**
 * Bundle openclaw into a single JS file.
 *
 * @param {string} pkgDir - Path to the extracted openclaw package directory
 * @returns {Promise<{success: boolean, outputFile?: string, error?: string}>}
 */
async function bundleOpenclaw(pkgDir) {
  // Find entry point
  const entryJs = path.join(pkgDir, 'dist', 'entry.js');
  const entryMjs = path.join(pkgDir, 'dist', 'entry.mjs');
  const entry = fs.existsSync(entryJs) ? entryJs : fs.existsSync(entryMjs) ? entryMjs : null;

  if (!entry) {
    return { success: false, error: 'No entry point found (dist/entry.js or dist/entry.mjs)' };
  }

  const outputFile = path.join(pkgDir, 'openclaw.mjs');
  const filesBefore = countFiles(pkgDir);
  console.log(`[bundle-openclaw] Files before bundling: ${filesBefore}`);

  // Discover native addons
  const nativeExternals = discoverNativeExternals(pkgDir);
  console.log(`[bundle-openclaw] Native externals: ${[...nativeExternals].join(', ')}`);

  // Build externals list
  const allExternals = new Set();

  // Node builtins (bare + node: prefix)
  for (const mod of NODE_BUILTINS) {
    allExternals.add(mod);
    allExternals.add(`node:${mod}`);
  }

  // Known optional deps
  for (const pkg of KNOWN_OPTIONAL_EXTERNALS) {
    allExternals.add(pkg);
  }

  // Native addons
  for (const pkg of nativeExternals) {
    allExternals.add(pkg);
  }

  const externalsList = [...allExternals];
  console.log(`[bundle-openclaw] Running esbuild...`);
  console.log(`[bundle-openclaw]   Entry: ${entry}`);
  console.log(`[bundle-openclaw]   Output: ${outputFile}`);
  console.log(`[bundle-openclaw]   Externals: ${externalsList.length} patterns`);

  // Load esbuild — try local project first, then fall back to require
  let esbuild;
  const projectEsbuild = path.resolve(__dirname, '..', 'node_modules', 'esbuild');
  try {
    if (fs.existsSync(projectEsbuild)) {
      console.log(`[bundle-openclaw] Using esbuild from: ${projectEsbuild}`);
      esbuild = require(projectEsbuild);
    } else {
      esbuild = require('esbuild');
    }
  } catch (err) {
    return { success: false, error: `Failed to load esbuild: ${err.message}` };
  }

  // Catch-all plugin: auto-externalize any bare specifier that fails to resolve.
  // This prevents build failures from optional/dynamic deps we didn't list.
  const catchAllExternalPlugin = {
    name: 'catch-all-external',
    setup(build) {
      // Track which specifiers we auto-externalized for logging
      const autoExternalized = new Set();

      build.onResolve({ filter: /.*/ }, (args) => {
        // Only handle bare specifiers (not relative/absolute paths)
        if (args.path.startsWith('.') || args.path.startsWith('/') || /^[a-zA-Z]:\\/.test(args.path)) {
          return null; // Let esbuild handle it
        }

        // Already in externals list — skip
        if (allExternals.has(args.path)) {
          return { path: args.path, external: true };
        }

        return null; // Let esbuild try to resolve first
      });

      build.onResolve({ filter: /.*/ }, async (args) => {
        // This runs after esbuild's default resolver fails.
        // If it's a bare specifier that couldn't be resolved, externalize it.
        if (args.path.startsWith('.') || args.path.startsWith('/') || /^[a-zA-Z]:\\/.test(args.path)) {
          return null;
        }

        // Try to resolve it — if it fails, externalize
        try {
          const result = await build.resolve(args.path, {
            kind: args.kind,
            resolveDir: args.resolveDir,
            importer: args.importer,
          });
          if (result.errors && result.errors.length > 0) {
            if (!autoExternalized.has(args.path)) {
              autoExternalized.add(args.path);
              console.log(`[bundle-openclaw] Auto-externalized: ${args.path}`);
            }
            return { path: args.path, external: true };
          }
          return result;
        } catch {
          if (!autoExternalized.has(args.path)) {
            autoExternalized.add(args.path);
            console.log(`[bundle-openclaw] Auto-externalized (error): ${args.path}`);
          }
          return { path: args.path, external: true };
        }
      });
    },
  };

  try {
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: outputFile,
      target: 'node20',
      sourcemap: 'external',
      treeShaking: true,
      external: externalsList,
      plugins: [catchAllExternalPlugin],
      banner: {
        js: [
          "import { fileURLToPath as __bundled_fileURLToPath } from 'node:url';",
          "import { dirname as __bundled_dirname_fn } from 'node:path';",
          "import { createRequire as __bundled_createRequire } from 'node:module';",
          "const __bundled_dirname = __bundled_dirname_fn(__bundled_fileURLToPath(import.meta.url));",
          "const __bundled_filename = __bundled_fileURLToPath(import.meta.url);",
          "const require = __bundled_createRequire(import.meta.url);",
        ].join('\n'),
      },
      define: {
        '__dirname': '__bundled_dirname',
        '__filename': '__bundled_filename',
      },
      logLevel: 'warning',
    });

    if (result.errors && result.errors.length > 0) {
      return { success: false, error: `esbuild had ${result.errors.length} errors` };
    }

    // Verify output exists
    if (!fs.existsSync(outputFile)) {
      return { success: false, error: 'esbuild did not produce output file' };
    }

    const outputSize = fs.statSync(outputFile).size;
    console.log(`[bundle-openclaw] Bundle created: ${outputFile} (${(outputSize / 1024 / 1024).toFixed(1)} MB)`);

    // Clean up node_modules — keep only native bindings
    console.log('[bundle-openclaw] Cleaning node_modules (keeping native bindings only)...');
    cleanNodeModules(pkgDir, nativeExternals);

    const filesAfter = countFiles(pkgDir);
    console.log(`[bundle-openclaw] Files after bundling: ${filesAfter} (reduced from ${filesBefore})`);
    console.log(`[bundle-openclaw] File count reduction: ${((1 - filesAfter / filesBefore) * 100).toFixed(1)}%`);

    // Write manifest
    const manifest = {
      bundled: true,
      entry: 'openclaw.mjs',
      originalEntry: path.relative(pkgDir, entry),
      nativeExternals: [...nativeExternals],
      filesBefore,
      filesAfter,
      outputSizeBytes: outputSize,
      bundledAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(pkgDir, 'bundle-manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf-8'
    );

    return { success: true, outputFile, filesBefore, filesAfter };

  } catch (err) {
    return { success: false, error: `esbuild build failed: ${err.message}` };
  }
}

// Export for programmatic use
module.exports = { bundleOpenclaw };

// CLI mode
if (require.main === module) {
  const pkgDir = process.argv[2];
  if (!pkgDir) {
    console.error('Usage: node scripts/bundle-openclaw.js <package-dir>');
    process.exit(1);
  }

  const resolvedDir = path.resolve(pkgDir);
  if (!fs.existsSync(resolvedDir)) {
    console.error(`Directory not found: ${resolvedDir}`);
    process.exit(1);
  }

  bundleOpenclaw(resolvedDir)
    .then((result) => {
      if (!result.success) {
        console.error(`[bundle-openclaw] FATAL: ${result.error}`);
        process.exit(1);
      }
      console.log('[bundle-openclaw] Done.');
    })
    .catch((err) => {
      console.error(`[bundle-openclaw] FATAL: ${err.message}`);
      process.exit(1);
    });
}
