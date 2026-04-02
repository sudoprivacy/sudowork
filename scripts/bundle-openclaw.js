/**
 * Bundle openclaw runtime into aggregated JS artifacts using esbuild.
 *
 * Consolidates thousands of node_modules files into a single openclaw.mjs,
 * keeping only native addons (.node bindings) as separate files.
 *
 * Usage:
 *   node scripts/bundle-openclaw.js <package-dir>
 *
 * The script:
 * 1. Discovers native addon externals (packages with .node files)
 * 2. Bundles dist/entry.js (or dist/entry.mjs) + all JS deps -> openclaw.mjs
 * 3. Marks Node.js builtins, native addons, and known optional deps as external
 * 4. Cleans up node_modules, keeping only native binding directories
 * 5. Writes bundle-manifest.json for validation tracking
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

// --- Known optional / dynamic-import packages that may not be installed ---
// These are marked external so esbuild doesn't error on missing resolutions.
const KNOWN_OPTIONAL_EXTERNALS = [
  // LLM runtime (optional, loaded dynamically)
  'node-llama-cpp',
  // Media processing (optional peer dep of prism-media)
  'ffmpeg-static',
  'opusscript',
  'node-opus',
  '@discordjs/opus',
  'sodium-native',
  'sodium',
  'libsodium-wrappers',
  'tweetnacl',
  // Playwright / Chromium internals (loaded conditionally)
  'chromium-bidi',
  'chromium-bidi/lib/cjs/bidiMapper/BidiMapper',
  'chromium-bidi/lib/cjs/cdp/CdpConnection',
  // Playwright itself (large, should remain external)
  'playwright',
  'playwright-core',
  // Sharp optional platform bindings (not for current platform)
  '@img/sharp-darwin-arm64',
  '@img/sharp-darwin-x64',
  '@img/sharp-linux-arm',
  '@img/sharp-linux-arm64',
  '@img/sharp-linux-x64',
  '@img/sharp-linux-s390x',
  '@img/sharp-linuxmusl-arm64',
  '@img/sharp-linuxmusl-x64',
  '@img/sharp-win32-ia32',
  '@img/sharp-win32-x64',
  '@img/sharp-wasm32',
  // Canvas native bindings
  '@napi-rs/canvas-win32-x64-msvc',
  '@napi-rs/canvas-darwin-arm64',
  '@napi-rs/canvas-darwin-x64',
  '@napi-rs/canvas-linux-x64-gnu',
  '@napi-rs/canvas-linux-x64-musl',
  '@napi-rs/canvas-linux-arm64-gnu',
  '@napi-rs/canvas-linux-arm64-musl',
  // Clipboard native bindings
  '@mariozechner/clipboard-win32-x64-msvc',
  '@mariozechner/clipboard-darwin-arm64',
  '@mariozechner/clipboard-darwin-x64',
  '@mariozechner/clipboard-linux-x64-gnu',
  '@mariozechner/clipboard-linux-arm64-gnu',
  // Node-pty native bindings
  '@lydell/node-pty-win32-x64',
  '@lydell/node-pty-darwin-arm64',
  '@lydell/node-pty-darwin-x64',
  '@lydell/node-pty-linux-x64',
  '@lydell/node-pty-linux-arm64',
  // Davey (Discord voice) native bindings
  '@snazzah/davey-win32-x64-msvc',
  '@snazzah/davey-darwin-arm64',
  '@snazzah/davey-darwin-x64',
  '@snazzah/davey-linux-x64-gnu',
  '@snazzah/davey-linux-arm64-gnu',
  // Koffi (FFI library, loads native code)
  'koffi',
  // cpu-features (optional native module)
  'cpu-features',
  // Various optional/peer deps that may not be present
  'bufferutil',
  'utf-8-validate',
  'zlib-sync',
  'erlpack',
];

function main() {
  const pkgDir = process.argv[2];
  if (!pkgDir) {
    console.error('Usage: node scripts/bundle-openclaw.js <package-dir>');
    process.exit(1);
  }

  if (!fs.existsSync(pkgDir)) {
    console.error(`[bundle-openclaw] Package directory not found: ${pkgDir}`);
    process.exit(1);
  }

  // Find entry point
  const entryJs = path.join(pkgDir, 'dist', 'entry.js');
  const entryMjs = path.join(pkgDir, 'dist', 'entry.mjs');
  const entry = fs.existsSync(entryJs) ? entryJs : fs.existsSync(entryMjs) ? entryMjs : null;

  if (!entry) {
    console.error('[bundle-openclaw] No dist/entry.js or dist/entry.mjs found');
    process.exit(1);
  }

  const outputFile = path.join(pkgDir, 'openclaw.mjs');

  // Count files before bundling
  const filesBefore = countFiles(pkgDir);
  console.log(`[bundle-openclaw] Files before bundling: ${filesBefore}`);

  // Discover native addon externals (packages containing .node files)
  const nativeExternals = discoverNativeExternals(pkgDir);
  console.log(`[bundle-openclaw] Native externals: ${nativeExternals.join(', ') || '(none)'}`);

  // Build the full externals list
  const allExternals = buildExternalsList(nativeExternals);
  console.log(`[bundle-openclaw] Running esbuild...`);
  console.log(`[bundle-openclaw]   Entry: ${entry}`);
  console.log(`[bundle-openclaw]   Output: ${outputFile}`);
  console.log(`[bundle-openclaw]   Externals: ${allExternals.length} patterns`);

  // Run esbuild using the JS API for reliability (no npx prompt)
  runEsbuild(entry, outputFile, allExternals, pkgDir);

  if (!fs.existsSync(outputFile)) {
    throw new Error('esbuild produced no output file');
  }

  const bundleSize = fs.statSync(outputFile).size;
  console.log(`[bundle-openclaw] Bundle size: ${(bundleSize / 1024 / 1024).toFixed(1)} MB`);

  // Clean up node_modules, keeping only native binding directories
  cleanupNodeModules(pkgDir, nativeExternals);

  // Write bundle manifest
  const filesAfter = countFiles(pkgDir);
  const manifest = {
    bundled: true,
    entry: 'openclaw.mjs',
    originalEntry: path.relative(pkgDir, entry),
    nativeExternals,
    bundleSize,
    filesBefore,
    filesAfter,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(pkgDir, 'bundle-manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`[bundle-openclaw] Files after bundling: ${filesAfter}`);
  console.log(`[bundle-openclaw] Reduction: ${filesBefore} -> ${filesAfter} (${((1 - filesAfter / filesBefore) * 100).toFixed(1)}% fewer files)`);
  console.log(`[bundle-openclaw] Bundle complete: ${outputFile}`);
}

function countFiles(dir) {
  let count = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else {
        count++;
      }
    }
  }
  return count;
}

function discoverNativeExternals(pkgDir) {
  const nmDir = path.join(pkgDir, 'node_modules');
  if (!fs.existsSync(nmDir)) return [];

  const externals = new Set();

  // Scan top-level and scoped packages for .node files
  const scanPackage = (pkgName, pkgPath) => {
    const stack = [pkgPath];
    while (stack.length > 0) {
      const current = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'node_modules') {
          stack.push(path.join(current, entry.name));
        } else if (entry.name.endsWith('.node')) {
          externals.add(pkgName);
          return; // Found one .node file, that's enough
        }
      }
    }
  };

  for (const entry of fs.readdirSync(nmDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@')) {
      // Scoped package
      const scopeDir = path.join(nmDir, entry.name);
      for (const subEntry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (subEntry.isDirectory()) {
          scanPackage(`${entry.name}/${subEntry.name}`, path.join(scopeDir, subEntry.name));
        }
      }
    } else if (entry.name !== '.package-lock.json' && entry.name !== '.cache') {
      scanPackage(entry.name, path.join(nmDir, entry.name));
    }
  }

  return [...externals].sort();
}

function buildExternalsList(nativeExternals) {
  const externals = new Set();

  // Node.js builtins (both bare and node: prefixed)
  for (const mod of builtinModules) {
    if (!mod.startsWith('_')) {
      externals.add(mod);
      externals.add(`node:${mod}`);
    }
  }

  // Native addons discovered from node_modules
  for (const ext of nativeExternals) {
    externals.add(ext);
  }

  // Known optional externals
  for (const ext of KNOWN_OPTIONAL_EXTERNALS) {
    externals.add(ext);
  }

  return [...externals].sort();
}

function runEsbuild(entry, outputFile, externals, pkgDir) {
  // Try to use esbuild from the project's node_modules first, then from the
  // openclaw package's node_modules, and finally fall back to npx.
  const projectRoot = path.resolve(__dirname, '..');
  const possibleEsbuildPaths = [
    path.join(projectRoot, 'node_modules', 'esbuild'),
    path.join(projectRoot, 'node_modules', '.pnpm', 'esbuild'),
    path.join(pkgDir, 'node_modules', 'esbuild'),
  ];

  let esbuild = null;
  for (const p of possibleEsbuildPaths) {
    try {
      esbuild = require(p);
      console.log(`[bundle-openclaw] Using esbuild from: ${p}`);
      break;
    } catch {
      // try next
    }
  }

  if (esbuild && typeof esbuild.buildSync === 'function') {
    // Use JS API directly - most reliable approach
    try {
      const result = esbuild.buildSync({
        entryPoints: [entry],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: outputFile,
        target: 'node20',
        sourcemap: 'external',
        treeShaking: true,
        external: externals,
        logLevel: 'warning',
        banner: {
          js: [
            "import { fileURLToPath as __bundled_fileURLToPath } from 'node:url';",
            "import { dirname as __bundled_dirname_fn } from 'node:path';",
            "import { createRequire as __bundled_createRequire } from 'node:module';",
            'const __bundled_dirname = __bundled_dirname_fn(__bundled_fileURLToPath(import.meta.url));',
            'const __bundled_filename = __bundled_fileURLToPath(import.meta.url);',
            'const require = __bundled_createRequire(import.meta.url);',
          ].join('\n'),
        },
        define: {
          __dirname: '__bundled_dirname',
          __filename: '__bundled_filename',
        },
        // Catch-all plugin for any remaining unresolvable imports
        plugins: [
          {
            name: 'external-catch-all',
            setup(build) {
              // Mark any remaining unresolvable bare specifiers as external
              // This handles edge cases where optional deps have sub-path imports
              build.onResolve({ filter: /.*/ }, (args) => {
                // Only handle bare specifiers (not relative/absolute paths)
                if (args.path.startsWith('.') || args.path.startsWith('/') || /^[a-zA-Z]:/.test(args.path)) {
                  return null;
                }
                // Check if the module exists in node_modules
                try {
                  require.resolve(args.path, { paths: [pkgDir] });
                  return null; // Found, let esbuild handle it
                } catch {
                  // Not found - mark as external to avoid build errors
                  console.log(`[bundle-openclaw] Auto-externalized missing module: ${args.path}`);
                  return { path: args.path, external: true };
                }
              });
            },
          },
        ],
      });

      if (result.errors && result.errors.length > 0) {
        console.error('[bundle-openclaw] esbuild errors:', result.errors);
        throw new Error(`esbuild had ${result.errors.length} error(s)`);
      }
      if (result.warnings && result.warnings.length > 0) {
        console.log(`[bundle-openclaw] esbuild warnings: ${result.warnings.length}`);
      }
      return;
    } catch (err) {
      // If JS API fails (e.g. version mismatch), fall through to CLI
      console.warn(`[bundle-openclaw] esbuild JS API failed, falling back to CLI: ${err.message}`);
    }
  }

  // Fallback: use esbuild CLI via npx with all externals
  console.log('[bundle-openclaw] Falling back to esbuild CLI via npx...');
  const args = [
    'esbuild',
    JSON.stringify(entry),
    '--bundle',
    '--platform=node',
    '--format=esm',
    `--outfile=${JSON.stringify(outputFile)}`,
    '--target=node20',
    '--sourcemap=external',
    '--tree-shaking=true',
    `--define:__dirname=__bundled_dirname`,
    `--define:__filename=__bundled_filename`,
    `--banner:js=import { fileURLToPath as __bundled_fileURLToPath } from 'node:url'; import { dirname as __bundled_dirname_fn } from 'node:path'; import { createRequire as __bundled_createRequire } from 'node:module'; const __bundled_dirname = __bundled_dirname_fn(__bundled_fileURLToPath(import.meta.url)); const __bundled_filename = __bundled_fileURLToPath(import.meta.url); const require = __bundled_createRequire(import.meta.url);`,
  ];

  for (const ext of externals) {
    args.push(`--external:${ext}`);
  }

  const cmd = `npx ${args.join(' ')}`;
  execSync(cmd, { cwd: pkgDir, stdio: 'inherit' });
}

function cleanupNodeModules(pkgDir, nativeExternals) {
  const nmDir = path.join(pkgDir, 'node_modules');
  if (!fs.existsSync(nmDir)) return;

  console.log('[bundle-openclaw] Cleaning up node_modules (keeping native bindings)...');

  // Build set of package directories to keep (native addons)
  const keepPackages = new Set(nativeExternals);
  // Also keep any KNOWN_OPTIONAL_EXTERNALS that have native bindings
  for (const ext of KNOWN_OPTIONAL_EXTERNALS) {
    const extPath = path.join(nmDir, ext);
    if (fs.existsSync(extPath)) {
      // Check if it has .node files
      if (hasNativeFiles(extPath)) {
        keepPackages.add(ext);
      }
    }
  }

  // Also keep playwright-core since it has browser binaries referenced at runtime
  const playwrightCorePath = path.join(nmDir, 'playwright-core');
  if (fs.existsSync(playwrightCorePath)) {
    keepPackages.add('playwright-core');
  }

  // Iterate through top-level entries
  for (const entry of fs.readdirSync(nmDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      // Remove non-directory files (.package-lock.json, etc.)
      try {
        fs.unlinkSync(path.join(nmDir, entry.name));
      } catch { /* ignore */ }
      continue;
    }

    if (entry.name.startsWith('@')) {
      // Scoped package - check each sub-package
      const scopeDir = path.join(nmDir, entry.name);
      let scopeHasKeepers = false;
      for (const subEntry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (!subEntry.isDirectory()) continue;
        const scopedName = `${entry.name}/${subEntry.name}`;
        if (keepPackages.has(scopedName)) {
          scopeHasKeepers = true;
        } else {
          // Remove this sub-package
          try {
            fs.rmSync(path.join(scopeDir, subEntry.name), { recursive: true, force: true });
          } catch { /* ignore */ }
        }
      }
      // Remove scope directory if empty
      if (!scopeHasKeepers) {
        try {
          fs.rmSync(scopeDir, { recursive: true, force: true });
        } catch { /* ignore */ }
      }
    } else if (entry.name === '.bin') {
      // Keep .bin directory (may contain native tool symlinks)
    } else if (!keepPackages.has(entry.name)) {
      // Remove this package
      try {
        fs.rmSync(path.join(nmDir, entry.name), { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  }
}

function hasNativeFiles(dir) {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        stack.push(path.join(current, entry.name));
      } else if (entry.name.endsWith('.node') || entry.name.endsWith('.dll') || entry.name.endsWith('.so') || entry.name.endsWith('.dylib')) {
        return true;
      }
    }
  }
  return false;
}

try {
  main();
} catch (err) {
  console.error(`[bundle-openclaw] FATAL: ${err.message}`);
  process.exit(1);
}
