#!/usr/bin/env node
/**
 * Download @shareone/cli npm package with all dependencies and create a tgz bundle.
 * Run during build process: node scripts/download-shareone.js
 *
 * Creates a self-contained tgz bundle similar to claude-code.tgz,
 * which will be extracted at runtime by ShareoneCliService.
 *
 * Usage: node scripts/download-shareone.js [--force] [--version <version>]
 *   --force           Re-download even if tgz already exists
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
const OUTPUT = path.join(RESOURCES_DIR, 'shareone.tgz');
const FORCE = process.argv.includes('--force') || process.argv.includes('-f');

/**
 * Download @shareone/cli with all production dependencies and create a tgz bundle
 */
async function downloadShareone() {
  // Check if already downloaded
  if (fs.existsSync(OUTPUT) && !FORCE) {
    console.log(`[shareone] Already exists: ${OUTPUT} (use --force to re-download)`);
    return true;
  }

  // Ensure resources directory exists
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  console.log('[shareone] Fetching version info...');

  // Parse version argument
  let version = DEFAULT_VERSION;
  const args = process.argv.slice(2);
  const versionIndex = args.indexOf('--version');
  if (versionIndex !== -1 && args[versionIndex + 1]) {
    version = args[versionIndex + 1];
  }

  let actualVersion = version;
  try {
    const info = JSON.parse(execSync(`npm show @shareone/cli@${version} --json`, {
      encoding: 'utf8',
      timeout: 30000,
    }));
    actualVersion = info.version;
    console.log(`[shareone] Target version: ${actualVersion}`);
  } catch (err) {
    console.log(`[shareone] Could not fetch version info, using: ${version}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shareone-cli-build-'));

  try {
    // 1. Initialize a dummy package.json
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'shareone-cli-bundle',
      private: true,
    }));

    // 2. Install @shareone/cli with all production dependencies
    console.log('[shareone] Installing @shareone/cli with dependencies...');

    const installEnv = {
      ...process.env,
      NODE_ENV: 'production',
    };

    // Log platform being installed for
    const platform = process.env.npm_config_platform || process.platform;
    const arch = process.env.npm_config_arch || process.arch;
    console.log(`[shareone] Target platform: ${platform}-${arch}`);

    execSync(`npm install @shareone/cli@${actualVersion} --production --no-save`, {
      cwd: tmpDir,
      stdio: 'inherit',
      env: installEnv,
      timeout: 120000,
    });

    // 3. Bundle with esbuild into a single JS file
    const pkgDir = path.join(tmpDir, 'node_modules', '@shareone', 'cli');
    const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
    const entryRel = typeof pkgJson.bin === 'string' ? pkgJson.bin : Object.values(pkgJson.bin)[0];
    const entryAbs = path.join(pkgDir, entryRel);
    const bundleOut = path.join(pkgDir, 'shareone.bundle.js');

    console.log('[shareone] Bundling with esbuild...');
    execSync(
      `npx esbuild "${entryAbs}" --bundle --platform=node --target=node22 --format=cjs --outfile="${bundleOut}"`,
      { cwd: tmpDir, stdio: 'inherit' },
    );

    // Update package.json bin to point at the bundle
    pkgJson.bin = { shareone: 'shareone.bundle.js' };
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

    // Remove original source files to keep tgz minimal
    const binDir = path.join(pkgDir, 'bin');
    const libDir = path.join(pkgDir, 'lib');
    if (fs.existsSync(binDir)) fs.rmSync(binDir, { recursive: true, force: true });
    if (fs.existsSync(libDir)) fs.rmSync(libDir, { recursive: true, force: true });

    // 4. Create a tarball of the entire directory
    console.log('[shareone] Creating tarball...');

    if (platform === 'win32') {
      // On Windows, create tarball in tmpDir first, then copy to destination
      const tmpOutput = path.join(tmpDir, 'shareone.tgz');
      try {
        execSync(`tar -czf shareone.tgz .`, {
          cwd: tmpDir,
          stdio: 'inherit',
          shell: true
        });
      } catch (e) {
        // tar may exit with code 1 if files changed during read, but archive is still valid
        if (!fs.existsSync(tmpOutput)) {
          throw e;
        }
      }
      fs.copyFileSync(tmpOutput, OUTPUT);
    } else {
      execSync(`tar -czf "${OUTPUT}" -C "${tmpDir}" .`, { stdio: 'inherit' });
    }

    console.log(`[shareone] ✅ Download completed successfully`);
    console.log(`[shareone] Bundle saved to: ${OUTPUT}`);
    return true;

  } catch (err) {
    console.error(`[shareone] ❌ Failed to download: ${err.message}`);

    // Clean up any partial downloads
    try {
      if (fs.existsSync(OUTPUT)) {
        fs.unlinkSync(OUTPUT);
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
  console.log(`[shareone] Output file: ${OUTPUT}`);

  const success = await downloadShareone();

  // Non-fatal: exit 0 to allow build to continue
  process.exit(success ? 0 : 0);
}

main().catch((err) => {
  console.error('[shareone] Error:', err.message);
  process.exit(0);
});