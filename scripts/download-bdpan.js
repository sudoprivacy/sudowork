#!/usr/bin/env node
/**
 * Download bdpan installer binary for bundling with the app.
 * Run during build process: bun run bdpan:download
 *
 * Saves to resources/bdpan-installer (or bdpan-installer.exe on Windows)
 * for inclusion as extraResources in the packaged Electron app.
 *
 * Usage: node scripts/download-bdpan.js [--force] [--os <os>] [--arch <arch>]
 *   --force           Re-download even if file already exists
 *   --os <os>         Target OS: darwin, linux, windows (default: auto-detect)
 *   --arch <arch>     Target arch: amd64, arm64 (default: auto-detect)
 *
 * NOTE: Download failures are non-fatal (exit 0) to allow builds to proceed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const VERSION = '3.7.1';
const CDN_BASE = `https://issuecdn.baidupcs.com/issue/netdisk/ai-bdpan/installer/${VERSION}`;
const CHECKSUM_URL = `${CDN_BASE}/SHA256SUMS`;
const RESOURCES_DIR = path.join(__dirname, '..', 'resources');

const VALID_OS = ['darwin', 'linux', 'windows'];
const VALID_ARCH = ['amd64', 'arm64'];

function detectOs() {
  const platform = os.platform();
  if (platform === 'darwin') return 'darwin';
  if (platform === 'linux') return 'linux';
  if (platform === 'win32') return 'windows';
  throw new Error(`Unsupported OS: ${platform}`);
}

function detectArch() {
  const arch = os.arch();
  if (arch === 'x64') return 'amd64';
  if (arch === 'arm64') return 'arm64';
  throw new Error(`Unsupported arch: ${arch}`);
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

async function downloadBdpan(osName, arch, force) {
  // CDN uses amd64/arm64; electron-builder ${arch} uses x64/arm64
  const cdnArch = arch; // amd64 or arm64 (as passed in)
  const ebArch = arch === 'amd64' ? 'x64' : arch; // x64 or arm64 (matches electron-builder ${arch})

  const cdnName = osName === 'windows'
    ? `bdpan-installer-${osName}-${cdnArch}.exe`
    : `bdpan-installer-${osName}-${cdnArch}`;

  // Output filename must match electron-builder.yml extraResources entry:
  //   bdpan-installer-windows-${arch}.exe  (${arch} = x64 or arm64)
  //   bdpan-installer-darwin-${arch}
  const outputName = osName === 'windows'
    ? `bdpan-installer-windows-${ebArch}.exe`
    : `bdpan-installer-${osName}-${ebArch}`;
  const outputFile = path.join(RESOURCES_DIR, outputName);

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

  if (osName !== 'windows') {
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

  let osOverride = null;
  let archOverride = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--os=')) {
      osOverride = args[i].split('=')[1];
    } else if (args[i] === '--os') {
      osOverride = args[++i];
    } else if (args[i].startsWith('--arch=')) {
      archOverride = args[i].split('=')[1];
    } else if (args[i] === '--arch') {
      archOverride = args[++i];
    }
  }

  if (osOverride && !VALID_OS.includes(osOverride)) {
    console.error(`Invalid --os: ${osOverride}. Valid: ${VALID_OS.join(', ')}`);
    process.exit(1);
  }
  if (archOverride && !VALID_ARCH.includes(archOverride)) {
    console.error(`Invalid --arch: ${archOverride}. Valid: ${VALID_ARCH.join(', ')}`);
    process.exit(1);
  }

  let osName, arch;
  try {
    osName = osOverride ?? detectOs();
    arch = archOverride ?? detectArch();
  } catch (err) {
    console.warn(`⚠️  ${err.message}. Skipping bdpan download.`);
    process.exit(0);
  }

  console.log(`Downloading bdpan installer v${VERSION} for ${osName}/${arch}...`);

  try {
    await downloadBdpan(osName, arch, force);
    console.log('✅ bdpan download completed');
  } catch (err) {
    console.error(`❌ Failed to download bdpan: ${err.message}`);
    // Non-fatal: allow build to continue
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(0);
});
