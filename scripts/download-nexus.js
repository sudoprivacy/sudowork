#!/usr/bin/env node
/**
 * Download Nexus binary for bundling with the app.
 * Run during build process: bun run nexus:download
 *
 * Downloads Nexus from: https://github.com/nexi-lab/nexus/releases/download/v{version}/
 * Saves with versioned filename:
 * - Windows: resources/v{version}-nexus-cluster-{os}-{arch}.zip
 * - macOS/Linux: resources/v{version}-nexus-cluster-{os}-{arch}.tar.gz
 *
 * NOTE: Download failures are non-fatal (exit 0) to allow builds to proceed
 * when platform-specific binaries are not yet available.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const runtimeVersions = require('../src/shared/runtime-versions.json');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');

const NEXUS_VERSION = runtimeVersions.nexus;

/**
 * Create an empty placeholder file for the current platform so electron-builder doesn't fail.
 * Used when binaries are not available for the platform or download fails.
 */
function createFallbackPlaceholder(platform) {
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });
  let outputFile;
  if (platform && PLATFORMS[platform]) {
    outputFile = getOutputFile(platform);
  } else {
    const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform;
    const archName = process.arch === 'x64' ? 'x86_64' : process.arch;
    const ext = process.platform === 'win32' ? '.exe' : '';
    outputFile = path.join(RESOURCES_DIR, `v${NEXUS_VERSION}-nexus-cluster-${osName}-${archName}${ext}`);
  }
  fs.writeFileSync(outputFile, Buffer.alloc(0));
  return outputFile;
}

const BASE_URL = `https://github.com/nexi-lab/nexus/releases/download/v${NEXUS_VERSION}`;

// Platform mappings: direct binary downloads (no tar.gz)
// Linux is included for completeness but binaries may not be available.
const PLATFORMS = {
  'darwin-arm64': { name: 'nexus-cluster-macos-arm64' },
  'darwin-x64': { name: 'nexus-cluster-macos-x86_64' },
  'win32-x64': { name: 'nexus-cluster-windows-x86_64.exe' },
  'linux-x64': { name: 'nexus-cluster-linux-x86_64' },
};

/**
 * Get the versioned output filename for the given platform.
 * e.g. v0.9.28-nexus-cluster-macos-arm64
 */
function getVersionedFileName(platform) {
  const config = PLATFORMS[platform];
  if (!config) throw new Error(`Unknown platform: ${platform}`);
  return `v${NEXUS_VERSION}-${config.name}`;
}

function getOutputFile(platform) {
  return path.join(RESOURCES_DIR, getVersionedFileName(platform));
}

function getDownloadUrl(platform) {
  const config = PLATFORMS[platform];
  if (!config) throw new Error(`Unknown platform: ${platform}`);
  return `${BASE_URL}/${config.name}`;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading: ${url}`);

    const file = fs.createWriteStream(dest);
    let redirects = 0;

    const request = (urlStr) => {
      if (redirects++ > 10) {
        reject(new Error('Too many redirects'));
        return;
      }

      https
        .get(urlStr, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
            const location = response.headers.location;
            if (location) {
              console.log(`Redirected to: ${location}`);
              request(location);
              return;
            }
          }

          if (response.statusCode === 404) {
            reject(new Error('NOT_FOUND'));
            return;
          }

          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }

          const totalSize = parseInt(response.headers['content-length'] || '0', 10);
          let downloaded = 0;
          let lastPrintedPercent = -1;

          response.on('data', (chunk) => {
            downloaded += chunk.length;
            if (totalSize > 0) {
              const percent = Math.round((downloaded / totalSize) * 100);
              // Only print every 5%
              if (percent - lastPrintedPercent >= 5 || percent === 100) {
                lastPrintedPercent = percent;
                process.stdout.write(`\rDownloading: ${percent}%`);
              }
            }
          });

          response.pipe(file);

          file.on('finish', () => {
            file.close();
            console.log('\nDownload complete.');
            resolve();
          });
        })
        .on('error', (err) => {
          try {
            fs.unlinkSync(dest);
          } catch {}
          reject(err);
        });
    };

    request(url);
  });
}

async function downloadNexus(platform, force = false) {
  const outputFile = getOutputFile(platform);

  // Skip if already exists
  if (fs.existsSync(outputFile) && !force) {
    console.log(`Already exists: ${outputFile}`);
    console.log('Use --force to re-download.');
    return true;
  }

  // Ensure resources directory exists
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  // Download
  const url = getDownloadUrl(platform);

  try {
    await downloadFile(url, outputFile);

    // Make binary executable on macOS/Linux
    if (process.platform !== 'win32') {
      fs.chmodSync(outputFile, 0o755);
    }

    console.log(`Saved to: ${outputFile}`);
    return true;
  } catch (err) {
    // Clean up partial download
    try {
      fs.unlinkSync(outputFile);
    } catch {}

    if (err.message === 'NOT_FOUND') {
      console.warn(`\n⚠️  Nexus binary not available for platform ${platform}`);
      console.warn('   Creating empty placeholder file.');
      console.warn('   Users can install Nexus manually from the About page.');
      // Create empty placeholder file so electron-builder doesn't fail
      fs.writeFileSync(outputFile, Buffer.alloc(0));
      return false;
    }

    throw err;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');

  // Check for explicit platform argument
  let platform;
  for (const arg of args) {
    if (arg === '--force' || arg === '-f') continue;
    if (PLATFORMS[arg]) {
      platform = arg;
      break;
    }
  }

  // Default: current platform
  if (!platform) {
    const currentPlatform = `${process.platform}-${process.arch}`;
    if (PLATFORMS[currentPlatform]) {
      platform = currentPlatform;
    } else {
      console.warn(`⚠️  Unsupported platform: ${currentPlatform}`);
      console.warn('   Creating empty placeholder file.');
      createFallbackPlaceholder(null);
      process.exit(0);
    }
  }

  console.log(`Downloading Nexus for ${platform}...`);
  console.log('');

  try {
    const success = await downloadNexus(platform, force);
    if (success) {
      console.log('\n✅ Nexus download completed');
    } else {
      console.log('\n⏭️  Skipping Nexus (not available for this platform)');
    }
  } catch (err) {
    console.error(`\n❌ Failed to download:`, err.message);
    console.warn('   Creating empty placeholder file.');
    createFallbackPlaceholder(platform);
    // Exit 0 to allow build to continue
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  console.warn('Creating empty placeholder file.');
  try {
    createFallbackPlaceholder(null);
  } catch {}
  // Exit 0 to allow build to continue
  process.exit(0);
});
