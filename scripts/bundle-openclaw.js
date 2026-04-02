#!/usr/bin/env node

/**
 * Bundle openclaw runtime into aggregated JS artifacts using esbuild.
 *
 * Takes an extracted openclaw package directory (with node_modules installed)
 * and produces:
 *   - openclaw.mjs   — single bundled ESM entry (all JS deps inlined)
 *   - node_modules/@snazzah/davey-*  — native bindings (kept separate, cannot be bundled)
 *
 * After bundling, all pure-JS node_modules are removed to dramatically reduce
 * file count in the final tarball.
 *
 * Usage:
 *   node scripts/bundle-openclaw.js <package-dir>
 *
 * The <package-dir> must contain dist/entry.mjs (or dist/entry.js) and node_modules/.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Resolve the davey native binding directory name for the current platform.
 */
function getDaveyBindingDirName() {
  const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const suffix = platform === 'win32' ? 'msvc' : platform === 'linux' ? 'gnu' : '';
  return `davey-${platform}-${arch}${suffix ? `-${suffix}` : ''}`;
}

/**
 * Find all .node native addon files under node_modules.
 */
function findNativeAddons(nodeModulesDir) {
  const addons = [];
  if (!fs.existsSync(nodeModulesDir)) return addons;

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.node')) {
        addons.push(fullPath);
      }
    }
  }
  walk(nodeModulesDir);
  return addons;
}

/**
 * Collect external package names that contain native addons.
 * Returns a Set of bare specifier prefixes (e.g. "@snazzah/davey-darwin-arm64").
 */
function collectNativeExternals(nodeModulesDir) {
  const externals = new Set();
  const addons = findNativeAddons(nodeModulesDir);

  for (const addonPath of addons) {
    // Resolve the package name from the path relative to node_modules
    const rel = path.relative(nodeModulesDir, addonPath);
    const parts = rel.split(path.sep);
    // Scoped packages: @scope/pkg
    const pkgName = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
    externals.add(pkgName);
  }

  return externals;
}

/**
 * Collect top-level directory names in node_modules (including scoped packages).
 */
function listNodeModulesPackages(nodeModulesDir) {
  const packages = [];
  if (!fs.existsSync(nodeModulesDir)) return packages;

  for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    if (entry.name.startsWith('@')) {
      // Scoped package — enumerate subdirs
      const scopeDir = path.join(nodeModulesDir, entry.name);
      for (const sub of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (sub.isDirectory()) {
          packages.push(`${entry.name}/${sub.name}`);
        }
      }
    } else {
      packages.push(entry.name);
    }
  }
  return packages;
}

/**
 * Remove a package directory from node_modules.
 */
function removePackageFromNodeModules(nodeModulesDir, pkgName) {
  const parts = pkgName.split('/');
  const targetDir = path.join(nodeModulesDir, ...parts);
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  // Clean up empty scope directory
  if (parts.length === 2) {
    const scopeDir = path.join(nodeModulesDir, parts[0]);
    if (fs.existsSync(scopeDir)) {
      const remaining = fs.readdirSync(scopeDir);
      if (remaining.length === 0) {
        fs.rmSync(scopeDir, { recursive: true, force: true });
      }
    }
  }
}

/**
 * Count files recursively in a directory.
 */
function countFiles(dir) {
  let count = 0;
  if (!fs.existsSync(dir)) return 0;

  function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        count++;
      }
    }
  }
  walk(dir);
  return count;
}

/**
 * Main bundling function.
 *
 * @param {string} pkgDir - Path to the extracted openclaw package directory
 */
function bundleOpenclaw(pkgDir) {
  const nodeModulesDir = path.join(pkgDir, 'node_modules');
  const distEntryMjs = path.join(pkgDir, 'dist', 'entry.mjs');
  const distEntryJs = path.join(pkgDir, 'dist', 'entry.js');
  const bundledOutput = path.join(pkgDir, 'openclaw.mjs');

  // Determine entry point
  const entryPoint = fs.existsSync(distEntryMjs) ? distEntryMjs : fs.existsSync(distEntryJs) ? distEntryJs : null;
  if (!entryPoint) {
    throw new Error(`No entry point found. Expected dist/entry.mjs or dist/entry.js in ${pkgDir}`);
  }

  if (!fs.existsSync(nodeModulesDir)) {
    throw new Error(`node_modules not found in ${pkgDir}. Run npm install first.`);
  }

  // Count files before bundling
  const filesBefore = countFiles(pkgDir);
  console.log(`[bundle-openclaw] Files before bundling: ${filesBefore}`);

  // Discover native addon externals
  const nativeExternals = collectNativeExternals(nodeModulesDir);
  console.log(`[bundle-openclaw] Native externals: ${[...nativeExternals].join(', ') || '(none)'}`);

  // Also mark node built-in modules as external
  const nodeBuiltins = [
    'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
    'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'http2',
    'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
    'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
    'sys', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'wasi',
    'worker_threads', 'zlib',
  ];

  // Build external list: native addons + node: prefixed builtins
  const externalPatterns = [
    ...nodeBuiltins.map((m) => m),
    ...nodeBuiltins.map((m) => `node:${m}`),
    ...nativeExternals,
  ];

  // Create esbuild configuration
  const esbuildArgs = [
    entryPoint,
    '--bundle',
    '--platform=node',
    '--format=esm',
    `--outfile=${bundledOutput}`,
    '--target=node20',
    '--sourcemap=external',
    '--tree-shaking=true',
    // Keep dynamic requires working
    '--define:__dirname=__bundled_dirname',
    // Banner to set up __dirname equivalent for ESM
    `--banner:js=import { fileURLToPath as __bundled_fileURLToPath } from 'node:url'; import { dirname as __bundled_dirname_fn } from 'node:path'; const __bundled_dirname = __bundled_dirname_fn(__bundled_fileURLToPath(import.meta.url));`,
    // External packages (native addons + node builtins)
    ...externalPatterns.map((ext) => `--external:${ext}`),
  ];

  console.log(`[bundle-openclaw] Running esbuild...`);
  console.log(`[bundle-openclaw]   Entry: ${entryPoint}`);
  console.log(`[bundle-openclaw]   Output: ${bundledOutput}`);
  console.log(`[bundle-openclaw]   Externals: ${externalPatterns.length} patterns`);

  try {
    // Use npx esbuild to run the bundler
    const esbuildCmd = `npx esbuild ${esbuildArgs.map((a) => `"${a}"`).join(' ')}`;
    execSync(esbuildCmd, {
      cwd: pkgDir,
      stdio: 'inherit',
      timeout: 120_000,
      shell: true,
    });
  } catch (err) {
    throw new Error(`esbuild bundling failed: ${err.message}`);
  }

  if (!fs.existsSync(bundledOutput)) {
    throw new Error(`esbuild did not produce output at ${bundledOutput}`);
  }

  const bundleSize = fs.statSync(bundledOutput).size;
  console.log(`[bundle-openclaw] Bundle created: ${bundledOutput} (${(bundleSize / 1024 / 1024).toFixed(2)} MB)`);

  // Clean up node_modules: remove all pure-JS packages, keep only native addons
  console.log('[bundle-openclaw] Cleaning up node_modules (keeping native addons only)...');
  const allPackages = listNodeModulesPackages(nodeModulesDir);
  let removedCount = 0;

  for (const pkg of allPackages) {
    if (nativeExternals.has(pkg)) {
      console.log(`[bundle-openclaw]   Keeping native: ${pkg}`);
      continue;
    }
    removePackageFromNodeModules(nodeModulesDir, pkg);
    removedCount++;
  }

  // Remove any remaining non-package files from node_modules root
  // (e.g. .package-lock.json, .cache)
  for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      fs.unlinkSync(path.join(nodeModulesDir, entry.name));
    }
  }

  console.log(`[bundle-openclaw] Removed ${removedCount} JS-only packages from node_modules`);

  // Count files after bundling
  const filesAfter = countFiles(pkgDir);
  console.log(`[bundle-openclaw] Files after bundling: ${filesAfter}`);
  console.log(`[bundle-openclaw] File count reduced by ${((1 - filesAfter / filesBefore) * 100).toFixed(1)}% (${filesBefore} → ${filesAfter})`);

  // Write bundle manifest for validation
  const bundleManifest = {
    bundled: true,
    entry: 'openclaw.mjs',
    nativeExternals: [...nativeExternals],
    bundleSize,
    filesBefore,
    filesAfter,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(pkgDir, 'bundle-manifest.json'), JSON.stringify(bundleManifest, null, 2) + '\n', 'utf-8');
  console.log('[bundle-openclaw] Wrote bundle-manifest.json');

  return bundleManifest;
}

// CLI entry point
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

  try {
    bundleOpenclaw(resolvedDir);
    console.log('[bundle-openclaw] Done!');
  } catch (err) {
    console.error(`[bundle-openclaw] FATAL: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { bundleOpenclaw };
