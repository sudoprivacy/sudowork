#!/usr/bin/env node
/**
 * Download bdpan installer binary for bundling with the app.
 * Run during build process: bun run bdpan:download
 *
 * Saves to resources/bdpan-installer (or bdpan-installer.exe on Windows)
 * for inclusion as extraResources in the packaged Electron app.
 *
 * Usage: node scripts/download-bdpan.js [--force] [<platform> ...] [--all]
 *   --force           Re-download even if file already exists
 *   <platform>        e.g. darwin-x64, win32-x64, linux-arm64 (default: current platform)
 *   --all             Download for all supported platforms
 *
 * NOTE: Download failures are non-fatal (exit 0) to allow builds to proceed.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const VERSION = '3.7.1';
const CDN_BASE = `https://issuecdn.baidupcs.com/issue/netdisk/ai-bdpan/installer/${VERSION}`;
const CHECKSUM_URL = `${CDN_BASE}/SHA256SUMS`;
const RESOURCES_DIR = path.join(__dirname, '..', 'resources');

// Platform mappings: key = process.platform-process.arch
// os/arch: names used in CDN download URL
// ext: file extension
const PLATFORMS = {
  'darwin-x64':  { os: 'darwin',  arch: 'amd64', ext: ''     },
  'darwin-arm64':{ os: 'darwin',  arch: 'arm64', ext: ''     },
  'win32-x64':   { os: 'windows', arch: 'amd64', ext: '.exe' },
  'win32-arm64': { os: 'windows', arch: 'arm64', ext: '.exe' },
  'linux-x64':   { os: 'linux',   arch: 'amd64', ext: ''     },
  'linux-arm64': { os: 'linux',   arch: 'arm64', ext: ''     },
};

function getOutputName(platform) {
  const { os, ext } = PLATFORMS[platform];
  const ebArch = platform.split('-')[1]; // x64 or arm64
  return `bdpan-installer-${os}-${ebArch}${ext}`;
}

function getOutputPath(platform) {
  return path.join(RESOURCES_DIR, getOutputName(platform));
}

function getCdnName(platform) {
  const { os, arch, ext } = PLATFORMS[platform];
  return `bdpan-installer-${os}-${arch}${ext}`;
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
      https.get(urlStr, (response) => {
        if ([301, 302, 307, 308].includes(response.statusCode)) {
          const location = response.headers.location;
          if (location) {
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
      }).on('error', (err) => {
        try { fs.unlinkSync(dest); } catch {}
        reject(err);
      });
    };

    request(url);
  });
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

async function downloadBdpan(platform, force) {
  const cdnName = getCdnName(platform);
  const outputFile = getOutputPath(platform);

  if (fs.existsSync(outputFile) && !force) {
    console.log(`Already exists: ${outputFile}  (use --force to re-download)`);
    return;
  }

  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  // Download installer
  try {
    await downloadFile(`${CDN_BASE}/${cdnName}`, outputFile);
  } catch (err) {
    try { fs.unlinkSync(outputFile); } catch {}
    if (err.message === 'NOT_FOUND') {
      console.warn(`⚠️  bdpan installer not available for ${osName}/${arch}`);
      return;
    }
    throw err;
  }

  if (!outputFile.endsWith('.exe')) {
    fs.chmodSync(outputFile, 0o755);
  }

  // Verify SHA256
  console.log('Verifying SHA256...');
  const checksumPath = `${outputFile}.sha256sums`;
  try {
    await downloadFile(CHECKSUM_URL, checksumPath);
  } catch (err) {
    console.warn(`⚠️  Could not download SHA256SUMS: ${err.message}. Skipping verification.`);
    return;
  }

  const checksumContent = fs.readFileSync(checksumPath, 'utf8');
  fs.unlinkSync(checksumPath);

  const line = checksumContent.split('\n').find((l) => l.includes(cdnName));
  if (!line) {
    console.warn(`⚠️  SHA256SUMS entry not found for ${cdnName}. Skipping verification.`);
    return;
  }

  const expectedHash = line.split(/\s+/)[0];
  const actualHash = sha256File(outputFile);
  if (actualHash !== expectedHash) {
    fs.unlinkSync(outputFile);
    throw new Error(`SHA256 mismatch!\n  expected: ${expectedHash}\n  actual:   ${actualHash}`);
  }
  console.log('✓ SHA256 verified');
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
      console.warn(`⚠️  Unsupported platform: ${currentPlatform}. Skipping bdpan download.`);
      process.exit(0);
    }
  }

  console.log(`bdpan installer version: ${VERSION}`);
  console.log(`Platforms: ${platforms.join(', ')}`);

  for (const platform of platforms) {
    console.log(`\n[${platform}]`);
    try {
      await downloadBdpan(platform, force);
      console.log('✅ bdpan download completed');
    } catch (err) {
      console.error(`❌ Failed to download bdpan: ${err.message}`);
      // Non-fatal: allow build to continue
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(0);
});
