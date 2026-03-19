#!/usr/bin/env node
/**
 * Download Node.js binaries for bundling with the app.
 * Run during build process: bun run node:download
 *
 * Downloads Node.js LTS for the current or specified platform.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const NODE_VERSION = '20.18.3';
const RESOURCES_DIR = path.join(__dirname, '..', 'resources');

// Platform mappings
const PLATFORMS = {
  'darwin-x64': { os: 'darwin', arch: 'x64', ext: 'tar.gz' },
  'darwin-arm64': { os: 'darwin', arch: 'arm64', ext: 'tar.gz' },
  'win32-x64': { os: 'win', arch: 'x64', ext: 'zip' },
  'win32-arm64': { os: 'win', arch: 'arm64', ext: 'zip' },
  'linux-x64': { os: 'linux', arch: 'x64', ext: 'tar.gz' },
  'linux-arm64': { os: 'linux', arch: 'arm64', ext: 'tar.gz' },
};

function getDownloadUrl(platform) {
  const config = PLATFORMS[platform];
  if (!config) throw new Error(`Unknown platform: ${platform}`);

  const { os, arch, ext } = config;
  return `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${os}-${arch}.${ext}`;
}

function getOutputPath(platform) {
  const config = PLATFORMS[platform];
  const ext = config.ext === 'zip' ? 'zip' : 'tar.gz';
  return path.join(RESOURCES_DIR, `node-${platform}.${ext}`);
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
          if (response.statusCode === 301 || response.statusCode === 302) {
            const location = response.headers.location;
            if (location) {
              request(location);
              return;
            }
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
          fs.unlinkSync(dest);
          reject(err);
        });
    };

    request(url);
  });
}

async function downloadNode(platform, force = false) {
  const outputPath = getOutputPath(platform);

  // Skip if already exists
  if (fs.existsSync(outputPath) && !force) {
    console.log(`Already exists: ${outputPath}`);
    console.log('Use --force to re-download.');
    return;
  }

  // Ensure resources directory exists
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  // Download
  const url = getDownloadUrl(platform);
  await downloadFile(url, outputPath);

  console.log(`Saved to: ${outputPath}`);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');

  // Parse platform arguments
  let platforms = [];

  for (const arg of args) {
    if (arg === '--force' || arg === '-f') continue;
    if (arg === '--all') {
      platforms = Object.keys(PLATFORMS);
    } else if (PLATFORMS[arg]) {
      platforms.push(arg);
    }
  }

  // Default: current platform
  if (platforms.length === 0) {
    const currentPlatform = `${process.platform}-${process.arch}`;
    if (PLATFORMS[currentPlatform]) {
      platforms = [currentPlatform];
    } else {
      console.error(`Unsupported platform: ${currentPlatform}`);
      console.error('Available platforms:', Object.keys(PLATFORMS).join(', '));
      process.exit(1);
    }
  }

  console.log(`Node.js version: ${NODE_VERSION}`);
  console.log(`Platforms: ${platforms.join(', ')}`);
  console.log('');

  for (const platform of platforms) {
    console.log(`\n[${platform}]`);
    try {
      await downloadNode(platform, force);
    } catch (err) {
      console.error(`Failed to download for ${platform}:`, err.message);
      process.exit(1);
    }
  }

  console.log('\nAll done!');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});