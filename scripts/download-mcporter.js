#!/usr/bin/env node
/**
 * Download mcporter npm package with all dependencies for bundling with the app.
 * Run during build process: bun run mcporter:download
 *
 * Uses npm install --production to create a self-contained bundle with all
 * dependencies in node_modules, then copies to resources/mcporter directory.
 *
 * Usage: node scripts/download-mcporter.js [--force] [--version <version>]
 *   --force           Re-download even if directory already exists
 *   --version         Specific version to download (default: latest)
 *
 * NOTE: Download failures are non-fatal (exit 0) to allow builds to proceed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const DEFAULT_VERSION = 'latest';
const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const MCPORTER_DIR = path.join(RESOURCES_DIR, 'mcporter');

/**
 * Download mcporter with all production dependencies
 * Similar approach to download-claude-code.js for self-contained bundle
 */
async function downloadMcporter(force = false, version = DEFAULT_VERSION) {
  // Check if already downloaded
  if (fs.existsSync(MCPORTER_DIR) && !force) {
    console.log(`[mcporter] Already exists: ${MCPORTER_DIR} (use --force to re-download)`);
    return true;
  }

  // Ensure resources directory exists
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  // Clean up existing directory if forcing
  if (fs.existsSync(MCPORTER_DIR)) {
    console.log(`[mcporter] Removing existing: ${MCPORTER_DIR}`);
    fs.rmSync(MCPORTER_DIR, { recursive: true, force: true });
  }

  console.log(`[mcporter] Fetching version info for mcporter@${version}...`);
  let actualVersion = version;
  try {
    const info = JSON.parse(execSync(`npm show mcporter@${version} --json`, {
      encoding: 'utf8',
      timeout: 30000,
    }));
    actualVersion = info.version;
    console.log(`[mcporter] Target version: ${actualVersion}`);
  } catch (err) {
    console.log(`[mcporter] Could not fetch version info, using: ${version}`);
  }

  // Create temporary directory for installation
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcporter-build-'));

  try {
    // 1. Initialize a dummy package.json
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'mcporter-bundle',
      private: true,
    }));

    // 2. Install mcporter with all production dependencies
    console.log('[mcporter] Installing mcporter with dependencies...');

    const installEnv = {
      ...process.env,
      NODE_ENV: 'production',
    };

    // Log platform being installed for
    const platform = process.env.npm_config_platform || process.platform;
    const arch = process.env.npm_config_arch || process.arch;
    console.log(`[mcporter] Target platform: ${platform}-${arch}`);

    execSync(`npm install mcporter@${actualVersion} --production --no-save`, {
      cwd: tmpDir,
      stdio: 'inherit',
      env: installEnv,
      timeout: 120000,
    });

    // 3. Copy the entire directory (including node_modules with hoisted dependencies)
    // npm install puts dependencies at root node_modules (hoisted), not inside each package
    console.log('[mcporter] Copying to resources directory...');

    // Copy everything from tmpDir to MCPORTER_DIR
    // This includes: node_modules/ (with mcporter and all its dependencies)
    // For cleaner structure, we'll move mcporter to root and keep dependencies in node_modules
    const installedMcporterPath = path.join(tmpDir, 'node_modules', 'mcporter');

    if (!fs.existsSync(installedMcporterPath)) {
      throw new Error('mcporter package not found in node_modules after installation');
    }

    // Copy mcporter package content to MCPORTER_DIR root
    fs.cpSync(installedMcporterPath, MCPORTER_DIR, { recursive: true });

    // Copy other dependencies (excluding mcporter itself) to node_modules subfolder
    const nodeModulesSrc = path.join(tmpDir, 'node_modules');
    const nodeModulesDest = path.join(MCPORTER_DIR, 'node_modules');
    fs.mkdirSync(nodeModulesDest, { recursive: true });

    const dependencies = fs.readdirSync(nodeModulesSrc).filter(name => name !== 'mcporter');
    for (const dep of dependencies) {
      const srcPath = path.join(nodeModulesSrc, dep);
      const destPath = path.join(nodeModulesDest, dep);
      fs.cpSync(srcPath, destPath, { recursive: true });
    }

    console.log(`[mcporter] Copied ${dependencies.length} dependency packages`);

    // 4. Verify CLI entry point exists
    const possibleEntryPoints = [
      path.join(MCPORTER_DIR, 'dist', 'cli.js'),
      path.join(MCPORTER_DIR, 'bin', 'cli.js'),
      path.join(MCPORTER_DIR, 'cli.js'),
      path.join(MCPORTER_DIR, 'src', 'cli.js'),
      path.join(MCPORTER_DIR, 'index.js'),
    ];

    const entryPoint = possibleEntryPoints.find(p => fs.existsSync(p));
    if (entryPoint) {
      console.log(`[mcporter] CLI entry point: ${path.relative(MCPORTER_DIR, entryPoint)}`);
    } else {
      console.warn('[mcporter] ⚠️  Could not find CLI entry point');
      console.log('[mcporter] Package structure:');
      const items = fs.readdirSync(MCPORTER_DIR);
      for (const item of items) {
        console.log(`  - ${item}`);
      }
    }

    console.log('[mcporter] ✅ Download completed successfully');
    console.log(`[mcporter] Bundle location: ${MCPORTER_DIR}`);
    return true;

  } catch (err) {
    console.error(`[mcporter] ❌ Failed to download: ${err.message}`);

    // Clean up any partial downloads
    try {
      if (fs.existsSync(MCPORTER_DIR)) {
        fs.rmSync(MCPORTER_DIR, { recursive: true, force: true });
      }
    } catch {}

    return false;
  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');

  // Parse version argument
  let version = DEFAULT_VERSION;
  const versionIndex = args.indexOf('--version');
  if (versionIndex !== -1 && args[versionIndex + 1]) {
    version = args[versionIndex + 1];
  }

  console.log(`[mcporter] Version to download: ${version}`);
  console.log(`[mcporter] Output directory: ${MCPORTER_DIR}`);

  const success = await downloadMcporter(force, version);

  // Non-fatal: exit 0 to allow build to continue
  process.exit(success ? 0 : 0);
}

main().catch((err) => {
  console.error('[mcporter] Error:', err.message);
  process.exit(0);
});