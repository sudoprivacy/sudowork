#!/usr/bin/env node
/**
 * Download Nexus binary for bundling with the app.
 * Run during build process: bun run nexus:download
 *
 * Downloads Nexus from: https://github.com/nexi-lab/nexus/releases/latest/download/
 * Saves as resources/nexus.tar.gz (single name, platform-specific content)
 *
 * NOTE: Download failures are non-fatal (exit 0) to allow builds to proceed
 * when platform-specific binaries are not yet available.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const OUTPUT_FILE = path.join(RESOURCES_DIR, 'nexus.tar.gz');

const BASE_URL = 'https://github.com/nexi-lab/nexus/releases/download/v0.9.13';

// Platform mappings (nexus uses x86_64 naming convention for x64)
const PLATFORMS = {
  'darwin-arm64': { name: 'nexus-macos-arm64.tar.gz' },
  'darwin-x64': { name: 'nexus-macos-x86_64.tar.gz' },
  'win32-x64': { name: 'nexus-windows-x86_64.tar.gz' },
  'win32-arm64': { name: 'nexus-windows-arm64.tar.gz' },
};

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

          response.on('data', (chunk) => {
            downloaded += chunk.length;
            if (totalSize > 0) {
              const percent = Math.round((downloaded / totalSize) * 100);
              process.stdout.write(`\rDownloading: ${percent}%`);
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
  // Skip if already exists
  if (fs.existsSync(OUTPUT_FILE) && !force) {
    console.log(`Already exists: ${OUTPUT_FILE}`);
    console.log('Use --force to re-download.');
    return true;
  }

  // Ensure resources directory exists
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  // Download
  const url = getDownloadUrl(platform);

  try {
    await downloadFile(url, OUTPUT_FILE);
    console.log(`Saved to: ${OUTPUT_FILE}`);
    return true;
  } catch (err) {
    // Clean up partial download
    try {
      fs.unlinkSync(OUTPUT_FILE);
    } catch {}

    if (err.message === 'NOT_FOUND') {
      console.warn(`\n⚠️  Nexus binary not available for platform ${platform}`);
      console.warn('   Creating empty placeholder file.');
      console.warn('   Users can install Nexus manually from the About page.');
      // Create empty placeholder file so electron-builder doesn't fail
      fs.writeFileSync(OUTPUT_FILE, Buffer.alloc(0));
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
      // Create empty placeholder file so electron-builder doesn't fail
      fs.mkdirSync(RESOURCES_DIR, { recursive: true });
      fs.writeFileSync(OUTPUT_FILE, Buffer.alloc(0));
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
    // Create empty placeholder file so electron-builder doesn't fail
    fs.mkdirSync(RESOURCES_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, Buffer.alloc(0));
    // Exit 0 to allow build to continue
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  console.warn('Creating empty placeholder file.');
  // Create empty placeholder file so electron-builder doesn't fail
  try {
    fs.mkdirSync(RESOURCES_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, Buffer.alloc(0));
  } catch {}
  // Exit 0 to allow build to continue
  process.exit(0);
});