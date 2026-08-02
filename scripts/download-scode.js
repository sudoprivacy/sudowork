#!/usr/bin/env node
/**
 * Download Scode binary for bundling with the app.
 * Run during build process: bun run scode:download
 *
 * Downloads Scode from: https://github.com/sudoprivacy/sudocode/releases/download/v{version}/
 * Saves with versioned filename:
 * - Windows: resources/v{version}-scode-windows-{arch}.zip
 * - macOS: resources/v{version}-scode-macos-{arch}.tar.gz
 *
 * NOTE: Download failures are non-fatal (exit 0) to allow builds to proceed
 * when platform-specific binaries are not yet available.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const runtimeVersions = require('../src/shared/runtime-versions.json');
const scodePlatforms = require('../src/shared/scode-platforms.json');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');

const SCODE_VERSION = runtimeVersions.scode;

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
    const archName = process.arch === 'x64' ? 'x64' : process.arch;
    const archiveExt = process.platform === 'win32' ? '.zip' : '.tar.gz';
    outputFile = path.join(RESOURCES_DIR, `v${SCODE_VERSION}-scode-${osName}-${archName}${archiveExt}`);
  }
  fs.writeFileSync(outputFile, Buffer.alloc(0));
  return outputFile;
}

const BASE_URL = `https://github.com/sudoprivacy/sudocode/releases/download/v${SCODE_VERSION}`;

// Derive the { platform → archive filename } map from the SSOT platforms file.
// Keep the shape backward-compatible with the rest of the script ({ name }).
const PLATFORMS = Object.fromEntries(
  Object.entries(scodePlatforms.platforms).map(([key, spec]) => [key, { name: `scode-${spec.os}-${spec.arch}${spec.ext}` }]),
);

/**
 * Get the versioned output filename for the given platform.
 * e.g. v0.1.1-scode-macos-arm64.tar.gz
 */
function getVersionedFileName(platform) {
  const config = PLATFORMS[platform];
  if (!config) throw new Error(`Unknown platform: ${platform}`);
  return `v${SCODE_VERSION}-${config.name}`;
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

async function downloadScode(platform, force = false) {
  const outputFile = getOutputFile(platform);

  // Skip only valid staged resources. Old zero-byte placeholders must be
  // replaced, otherwise an offline build can never become self-contained.
  if (fs.existsSync(outputFile) && !force) {
    if (fs.statSync(outputFile).size >= 100 * 1024) {
      console.log(`Already exists: ${outputFile}`);
      console.log('Use --force to re-download.');
      return true;
    }
    fs.rmSync(outputFile, { force: true });
  }

  // Ensure resources directory exists
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  // Download
  const url = getDownloadUrl(platform);

  try {
    await downloadFile(url, outputFile);
    console.log(`Saved to: ${outputFile}`);
    return true;
  } catch (err) {
    // Clean up partial download
    try {
      fs.unlinkSync(outputFile);
    } catch {}

    if (err.message === 'NOT_FOUND') {
      console.warn(`\n⚠️  Scode binary not available for platform ${platform}`);
      console.warn('   Creating empty placeholder file.');
      console.warn('   Users can install Scode manually from the About page.');
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

  console.log(`Downloading Scode for ${platform}...`);
  console.log('');

  try {
    const success = await downloadScode(platform, force);
    if (success) {
      console.log('\n✅ Scode download completed');
    } else {
      console.log('\n⏭️  Skipping Scode (not available for this platform)');
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
