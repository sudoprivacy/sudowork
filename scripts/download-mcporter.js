#!/usr/bin/env node
/**
 * Download mcporter npm package with all dependencies and create a tgz bundle.
 * Run during build process: bun run mcporter:download
 *
 * Creates a self-contained tgz bundle for runtime extraction by
 * McporterService.
 *
 * Usage: node scripts/download-mcporter.js [--force] [--version <version>]
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
const OUTPUT = path.join(RESOURCES_DIR, 'mcporter.tgz');
const FORCE = process.argv.includes('--force') || process.argv.includes('-f');

/**
 * Download mcporter with all production dependencies and create a tgz bundle
 */
async function downloadMcporter() {
  // Check if already downloaded
  if (fs.existsSync(OUTPUT) && !FORCE) {
    console.log(`[mcporter] Already exists: ${OUTPUT} (use --force to re-download)`);
    return true;
  }

  // Ensure resources directory exists
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  console.log('[mcporter] Fetching version info...');

  // Parse version argument
  let version = DEFAULT_VERSION;
  const args = process.argv.slice(2);
  const versionIndex = args.indexOf('--version');
  if (versionIndex !== -1 && args[versionIndex + 1]) {
    version = args[versionIndex + 1];
  }

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

    // 3. Create a tarball of the entire directory (including node_modules)
    console.log('[mcporter] Creating tarball...');

    if (platform === 'win32') {
      // On Windows, create tarball in tmpDir first, then copy to destination
      const tmpOutput = path.join(tmpDir, 'mcporter.tgz');
      try {
        execSync(`tar -czf mcporter.tgz .`, {
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

    console.log(`[mcporter] ✅ Download completed successfully`);
    console.log(`[mcporter] Bundle saved to: ${OUTPUT}`);
    return true;

  } catch (err) {
    console.error(`[mcporter] ❌ Failed to download: ${err.message}`);

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
  console.log(`[mcporter] Output file: ${OUTPUT}`);

  const success = await downloadMcporter();

  // Non-fatal: exit 0 to allow build to continue
  process.exit(success ? 0 : 0);
}

main().catch((err) => {
  console.error('[mcporter] Error:', err.message);
  process.exit(0);
});
