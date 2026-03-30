#!/usr/bin/env node
/**
 * Download 7-Zip (7za.exe) standalone binary for Windows.
 * This ensures we have a reliable extraction tool in NSIS that supports overwriting.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// We use 7-zip standalone console version (7za.exe)
// Source: https://www.7-zip.org/download.html
// Since 7-zip doesn't provide a direct permanent link for latest, we use a reliable mirror or specific version
const VERSION = '24.09'; // 24.09 is latest stable as of 2024
const BASE_URL = 'https://www.7-zip.org/a/';
const ARCH_MAP = {
  'x64': '7z2409-extra.7z', // Extra package contains 7za.exe
  'arm64': '7z2409-arm64.exe', // ARM64 version
};

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');

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
      https.get(urlStr, (response) => {
        if ([301, 302, 307, 308].includes(response.statusCode)) {
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
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        try { fs.unlinkSync(dest); } catch {}
        reject(err);
      });
    };
    request(url);
  });
}

/**
 * Since 7-Zip downloads are often packed in .7z or .exe, but we need 7za.exe,
 * for simplicity in this script, we'll try to find a direct 7za.exe or
 * instruct the user.
 *
 * BETTER APPROACH: Use the 7za.exe already available in node_modules/7zip-bin
 */
async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');

  const platforms = ['win32-x64', 'win32-arm64'];

  console.log('📦 Preparing 7za.exe for Windows bundling...');
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  for (const platform of platforms) {
    const arch = platform.split('-')[1];
    const sourcePath = path.join(__dirname, '..', 'node_modules', '7zip-bin', 'win', arch, '7za.exe');
    const destPath = path.join(RESOURCES_DIR, `7za-${arch}.exe`);

    if (fs.existsSync(destPath) && !force) {
      console.log(`✓ 7za-${arch}.exe already exists in resources/`);
      continue;
    }

    if (fs.existsSync(sourcePath)) {
      console.log(`Copying 7za.exe from node_modules for ${arch}...`);
      fs.copyFileSync(sourcePath, destPath);
      console.log(`✅ Copied to ${destPath}`);
    } else {
      console.error(`❌ Could not find 7za.exe in ${sourcePath}`);
      console.error('Please run "npm install" or "bun install" first.');
      process.exit(1);
    }
  }

  // Create a symlink or copy for the default 7za.exe (usually x64)
  const defaultDest = path.join(RESOURCES_DIR, '7za.exe');
  if (!fs.existsSync(defaultDest) || force) {
    fs.copyFileSync(path.join(RESOURCES_DIR, '7za-x64.exe'), defaultDest);
    console.log('✅ Created default resources/7za.exe (x64)');
  }

  console.log('\nAll 7-Zip binaries ready!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
