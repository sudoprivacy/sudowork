#!/usr/bin/env node
/**
 * Download the nexus-vfs daemon (nexusd-cluster) and install it under ~/.nexus-vfs/bin.
 * Run during build / bootstrap: bun run nexus-vfs:download
 *
 * Unlike download-nexus.js / download-scode.js (which only stage a versioned
 * archive into resources/ for electron-builder), this script downloads from the
 * Tencent COS mirror, extracts the archive, and installs the executable directly
 * to ~/.nexus-vfs/bin/nexusd-cluster — the same location DynamicNexusVfsService
 * launches from. nexus-vfs is a NEW, independent runtime; it does NOT touch
 * ~/.nexus or the existing Nexus/Sudocode download paths.
 *
 * COS layout (v0.0.1-rc1), verified by HEAD probe:
 *   nexusd-cluster-macos-aarch64.tar.gz   (200)
 *   nexusd-cluster-macos-x86_64.tar.gz    (404 — not published in this release)
 *   nexusd-cluster-linux-x86_64.tar.gz    (200)
 *   nexusd-cluster-linux-aarch64.tar.gz   (200)
 *   nexusd-cluster-windows-x86_64.zip     (200)
 *   nexusd-cluster-windows-aarch64.zip    (200)
 *
 * Each archive contains a single top-level dir `nexusd-cluster-<os>-<arch>/`
 * holding the executable (`nexusd-cluster` / `nexusd-cluster.exe`) and README.md.
 *
 * Per project guardrail: a missing platform binary surfaces a CLEAR error rather
 * than silently falling back to GitHub or a wrong artifact. To keep the
 * cli:download composite (chained with &&) from aborting the other runtimes, the
 * process still exits 0 on a handled miss, but nothing is installed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const runtimeVersions = require('../src/shared/runtime-versions.json');

const VERSION = runtimeVersions['nexus-vfs'];

const COS_BASE_URL = `https://sudoclaw-download-1309794936.cos.ap-beijing.myqcloud.com/nexus-vfs/release/v${VERSION}`;

/**
 * Known-good SHA256 sums for v0.0.1-rc1 (mirrors SHA256SUMS.txt in the bucket).
 * A download whose hash is not listed here is rejected — no silent acceptance.
 * Note: there is intentionally NO macos-x86_64 entry (Intel Macs unsupported).
 */
const SHA256SUMS = {
  'nexusd-cluster-linux-aarch64.tar.gz': '1dd8d899b6cca4f9f47c6785ac7cd3bf30ff3d9faca1c6b791ec9fc76232af87',
  'nexusd-cluster-linux-x86_64.tar.gz': '9d4f86780ae4ba59cb3e2fc573d68200bba7a0d45cd4e5d862499012ec46945a',
  'nexusd-cluster-macos-aarch64.tar.gz': 'eeb5d821cf8940cc97e879707f85b39db0dbb054d42334e2d8c48a4e63cd13ab',
  'nexusd-cluster-windows-aarch64.zip': 'dc121b622575f781c4ac5efb4190153cae9e783ee635342e325e67a30d1852c8',
  'nexusd-cluster-windows-x86_64.zip': '4e261d26070994667fee2d98f6b065c0d5e436a903fca2d7dfd198a85a19d81f',
};

/** Explicit, non-fallback error for the one platform this release does not ship. */
const INTEL_MAC_UNSUPPORTED = 'nexus-vfs v0.0.1-rc1 has no Intel macOS artifact; use Apple Silicon or wait for a newer release';

const HOME = os.homedir();
const INSTALL_ROOT = path.join(HOME, '.nexus-vfs');
const BIN_DIR = path.join(INSTALL_ROOT, 'bin');
const DOWNLOAD_DIR = path.join(INSTALL_ROOT, 'downloads');
const READY_MARKER = path.join(BIN_DIR, '.nexus-vfs-bin-ready');

const isWindows = process.platform === 'win32';

// Uniform mapping across all three OSes for v0.0.1-rc1.
const OS_NAME_MAP = { darwin: 'macos', win32: 'windows', linux: 'linux' };
const ARCH_NAME_MAP = { arm64: 'aarch64', x64: 'x86_64' };

function getBinaryName() {
  return isWindows ? 'nexusd-cluster.exe' : 'nexusd-cluster';
}

function getArtifactName(platform = process.platform, arch = process.arch) {
  // The only platform missing from this release: Intel macOS. Fail loudly rather
  // than falling back to the wrong arch or another mirror.
  if (platform === 'darwin' && arch === 'x64') {
    throw new Error(INTEL_MAC_UNSUPPORTED);
  }
  const osName = OS_NAME_MAP[platform];
  const archName = ARCH_NAME_MAP[arch];
  if (!osName || !archName) {
    throw new Error(`Unsupported platform: ${platform}-${arch}`);
  }
  const ext = platform === 'win32' ? '.zip' : '.tar.gz';
  return `nexusd-cluster-${osName}-${archName}${ext}`;
}

function sha256OfFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
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
          const code = response.statusCode;
          if ((code === 301 || code === 302 || code === 307 || code === 308) && response.headers.location) {
            response.resume();
            console.log(`Redirected to: ${response.headers.location}`);
            request(response.headers.location);
            return;
          }

          if (code === 404) {
            response.resume();
            reject(new Error('NOT_FOUND'));
            return;
          }

          if (code !== 200) {
            response.resume();
            reject(new Error(`HTTP ${code}`));
            return;
          }

          const totalSize = parseInt(response.headers['content-length'] || '0', 10);
          let downloaded = 0;
          let lastPrintedPercent = -1;

          response.on('data', (chunk) => {
            downloaded += chunk.length;
            if (totalSize > 0) {
              const percent = Math.round((downloaded / totalSize) * 100);
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

/**
 * Extract the archive into extractDir. Shells out to the system `tar`
 * (.tar.gz, available on macOS/Linux/modern Windows) or `unzip` / PowerShell
 * Expand-Archive (.zip).
 */
function extractArchive(archivePath, extractDir) {
  fs.mkdirSync(extractDir, { recursive: true });

  if (archivePath.endsWith('.zip')) {
    if (isWindows) {
      execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${archivePath}' -DestinationPath '${extractDir}'`], { stdio: 'inherit' });
    } else {
      execFileSync('unzip', ['-o', archivePath, '-d', extractDir], { stdio: 'inherit' });
    }
  } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'inherit' });
  } else {
    throw new Error(`Unsupported archive format: ${archivePath}`);
  }
}

/** Recursively locate the nexusd-cluster executable inside the extracted tree. */
function findBinary(dir) {
  const wanted = getBinaryName();
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findBinary(full);
      if (found) return found;
    } else if (entry.name === wanted) {
      return full;
    }
  }
  return null;
}

async function installForPlatform(platform, arch, force) {
  const artifact = getArtifactName(platform, arch);
  const url = `${COS_BASE_URL}/${artifact}`;
  const binName = getBinaryName();
  const installedBinary = path.join(BIN_DIR, binName);

  if (fs.existsSync(installedBinary) && fs.existsSync(READY_MARKER) && fs.readFileSync(READY_MARKER, 'utf-8').trim() === VERSION && !force) {
    console.log(`Already installed (v${VERSION}): ${installedBinary}`);
    console.log('Use --force to re-download.');
    return true;
  }

  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  fs.mkdirSync(BIN_DIR, { recursive: true });

  const archivePath = path.join(DOWNLOAD_DIR, artifact);
  const extractDir = path.join(DOWNLOAD_DIR, `extract-${Date.now()}`);

  try {
    await downloadFile(url, archivePath);
  } catch (err) {
    try {
      fs.unlinkSync(archivePath);
    } catch {}
    if (err.message === 'NOT_FOUND') {
      // CLEAR error — no GitHub fallback, no guessing alternate paths.
      console.error(`\n❌ nexus-vfs binary not available for ${platform}-${arch} in v${VERSION}.`);
      console.error(`   Tried: ${url} → HTTP 404`);
      console.error('   This platform is not published in this release; nothing installed.');
      return false;
    }
    throw err;
  }

  // Integrity check against the known-good SHA256 before we trust the archive.
  const expectedSha = SHA256SUMS[artifact];
  if (!expectedSha) {
    throw new Error(`No known SHA256 for ${artifact}; refusing to install an unverified artifact.`);
  }
  const actualSha = sha256OfFile(archivePath);
  if (actualSha !== expectedSha) {
    try {
      fs.unlinkSync(archivePath);
    } catch {}
    throw new Error(`SHA256 mismatch for ${artifact}: expected ${expectedSha}, got ${actualSha}`);
  }
  console.log(`SHA256 verified: ${actualSha}`);

  extractArchive(archivePath, extractDir);

  const extractedBinary = findBinary(extractDir);
  if (!extractedBinary) {
    throw new Error(`Archive ${artifact} did not contain expected binary ${binName}`);
  }

  fs.copyFileSync(extractedBinary, installedBinary);
  if (!isWindows) {
    fs.chmodSync(installedBinary, 0o755);
  }

  fs.writeFileSync(READY_MARKER, VERSION);

  // Clean up download + extraction artifacts.
  try {
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.unlinkSync(archivePath);
  } catch {}

  const size = fs.statSync(installedBinary).size;
  console.log(`Installed: ${installedBinary} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');

  const platform = process.platform;
  const arch = process.arch;

  if (!OS_NAME_MAP[platform] || !ARCH_NAME_MAP[arch]) {
    console.warn(`⚠️  Unsupported platform: ${platform}-${arch}; skipping nexus-vfs.`);
    process.exit(0);
  }

  console.log(`Downloading nexus-vfs (v${VERSION}) for ${platform}-${arch}...`);
  console.log('');

  try {
    const ok = await installForPlatform(platform, arch, force);
    if (ok) {
      console.log('\n✅ nexus-vfs download completed');
    } else {
      console.log('\n⏭️  Skipping nexus-vfs (not available for this platform)');
    }
  } catch (err) {
    // Exit 0 so the cli:download composite (chained with &&) still covers the
    // other runtimes. The failure is loud in the log and nothing is installed.
    console.error(`\n❌ Failed to download nexus-vfs:`, err.message);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(0);
});
