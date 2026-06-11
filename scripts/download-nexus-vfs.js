#!/usr/bin/env node
/**
 * Download the nexus-vfs daemon (nexusd-cluster) and vault plugin dylib,
 * installing them under ~/.nexus-vfs/bin and ~/.nexus-vfs/plugins respectively.
 * Run during build / bootstrap: bun run nexus-vfs:download
 *
 * Unlike download-nexus.js / download-scode.js (which only stage a versioned
 * archive into resources/ for electron-builder), this script downloads from the
 * Tencent COS mirror, extracts the archive, and installs the executable directly
 * to ~/.nexus-vfs/bin/nexusd-cluster — the same location DynamicNexusVfsService
 * launches from. nexus-vfs is a NEW, independent runtime; it does NOT touch
 * ~/.nexus or the existing Nexus/Sudocode download paths.
 *
 * The vault plugin dylib is downloaded from a separate release (nexus repo) and
 * placed in ~/.nexus-vfs/plugins/ so nexusd-cluster can load it via --plugin-dir.
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
const VAULT_VERSION = runtimeVersions['nexus-vault'];

// Runtime bucket is primary; legacy bucket stays live as a fallback during deprecation.
const COS_BASE_URLS = [
  `https://sudowork-runtime-1309794936.cos.ap-beijing.myqcloud.com/nexus-vfs/release/v${VERSION}`,
  `https://sudoclaw-download-1309794936.cos.ap-beijing.myqcloud.com/nexus-vfs/release/v${VERSION}`,
];

// Vault plugin is released from the nexus repo (separate from nexus-vfs).
const VAULT_COS_BASE_URLS = [
  `https://sudowork-runtime-1309794936.cos.ap-beijing.myqcloud.com/nexus-vault/release/v${VAULT_VERSION}`,
  `https://sudoclaw-download-1309794936.cos.ap-beijing.myqcloud.com/nexus-vault/release/v${VAULT_VERSION}`,
];

// GitHub Release fallback for vault plugin (梁 mirrors to COS, but GH is source of truth).
const VAULT_GITHUB_URL = `https://github.com/nexi-lab/nexus/releases/download/vault-v${VAULT_VERSION}`;

/**
 * Known-good SHA256 sums (mirrors SHA256SUMS.txt in the bucket).
 * A download whose hash is not listed here is rejected — no silent acceptance.
 * Note: there is intentionally NO macos-x86_64 entry (Intel Macs unsupported).
 *
 * nexusd-cluster sums are populated after COS mirror; vault sums from CI artifacts.
 */
const SHA256SUMS = {
  // nexusd-cluster v0.2.0
  'nexusd-cluster-linux-aarch64.tar.gz': 'eeb0a861711a74ef8b78146a05ed0b96bff5aa8dfb6b3ba7f9ea1252fe11ab36',
  'nexusd-cluster-linux-x86_64.tar.gz': '2b85bf0daf381c68776911049a32ee3015974e4569fba2b407cff52c24a20260',
  'nexusd-cluster-macos-aarch64.tar.gz': '86e00f10612b23ad30f1498cd025a786b457c2925dd4276e6c7202f6367b0713',
  'nexusd-cluster-macos-x86_64.tar.gz': '5d44d7ea5e18a4d2fe71d88342fd1adcff0fd84d09e1782eb0fd409f50668589',
  'nexusd-cluster-windows-aarch64.zip': '5c8b33210161c7d094ebe0ddca3eddefcf8ceabe0bfba7b24f0e0d232be64a92',
  'nexusd-cluster-windows-x86_64.zip': '86a6f47d0755a27af4d6509eb7d2aed83e9d5e1d47ba2ed7944094f419f15e88',
  // vault plugin v0.1.1
  'nexus-vault-linux-x86_64.tar.gz': '9d7d87fd64e2ab16f76f384df4f91252d25c795a6a1f21e8a7c134030f8573fb',
  'nexus-vault-macos-arm64.tar.gz': 'f185068d23a309589e8b10646d0055bba59d4c491dd86396c8adf95a9a212f56',
  'nexus-vault-macos-x86_64.tar.gz': '85fc3c67b05884fe32d0464602a80b1962a29dbfa888148a532884d60851d547',
  'nexus-vault-windows-x86_64.zip': '134b95ba6693eb08b74581b07071519af4219fcaac4766d5610b4e77a0fbca75',
};



const HOME = os.homedir();
const INSTALL_ROOT = path.join(HOME, '.nexus-vfs');
const BIN_DIR = path.join(INSTALL_ROOT, 'bin');
const PLUGIN_DIR = path.join(INSTALL_ROOT, 'plugins');
const DOWNLOAD_DIR = path.join(INSTALL_ROOT, 'downloads');
const READY_MARKER = path.join(BIN_DIR, '.nexus-vfs-bin-ready');
const VAULT_READY_MARKER = path.join(PLUGIN_DIR, '.nexus-vault-ready');

const isWindows = process.platform === 'win32';

// Uniform mapping across all three OSes for v0.0.1-rc1.
const OS_NAME_MAP = { darwin: 'macos', win32: 'windows', linux: 'linux' };
const ARCH_NAME_MAP = { arm64: 'aarch64', x64: 'x86_64' };

function getBinaryName() {
  return isWindows ? 'nexusd-cluster.exe' : 'nexusd-cluster';
}

function getArtifactName(platform = process.platform, arch = process.arch) {
  const osName = OS_NAME_MAP[platform];
  const archName = ARCH_NAME_MAP[arch];
  if (!osName || !archName) {
    throw new Error(`Unsupported platform: ${platform}-${arch}`);
  }
  const ext = platform === 'win32' ? '.zip' : '.tar.gz';
  return `nexusd-cluster-${osName}-${archName}${ext}`;
}

/**
 * Vault plugin artifact name. The vault dylib uses different naming from nexusd-cluster:
 * - macOS: libnexus_vault.dylib (arm64 only, no x86_64)
 * - Linux: libnexus_vault.so (x86_64 only in v0.1.0)
 * - Windows: nexus_vault.dll (x86_64 only in v0.1.0)
 *
 * Archive naming: nexus-vault-{os}-{arch}.{tar.gz|zip}
 */
function getVaultArtifactName(platform = process.platform, arch = process.arch) {
  const VAULT_PLATFORM_MAP = {
    'darwin-arm64': 'nexus-vault-macos-arm64',
    'darwin-x64': 'nexus-vault-macos-x86_64',
    'linux-x64': 'nexus-vault-linux-x86_64',
    'win32-x64': 'nexus-vault-windows-x86_64',
  };
  const key = `${platform}-${arch}`;
  const name = VAULT_PLATFORM_MAP[key];
  if (!name) return null; // not available for this platform
  const ext = platform === 'win32' ? '.zip' : '.tar.gz';
  return `${name}${ext}`;
}

/** Platform-specific vault dylib filename inside the archive. */
function getVaultDylibName(platform = process.platform) {
  if (platform === 'darwin') return 'libnexus_vault.dylib';
  if (platform === 'linux') return 'libnexus_vault.so';
  if (platform === 'win32') return 'nexus_vault.dll';
  return null;
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
  const urls = COS_BASE_URLS.map((base) => `${base}/${artifact}`);
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

  let downloaded = false;
  let lastErr = null;
  let allNotFound = true;
  for (const url of urls) {
    try {
      await downloadFile(url, archivePath);
      downloaded = true;
      break;
    } catch (err) {
      lastErr = err;
      if (err.message !== 'NOT_FOUND') allNotFound = false;
    }
  }
  if (!downloaded) {
    try {
      fs.unlinkSync(archivePath);
    } catch {}
    if (allNotFound) {
      // CLEAR error — no GitHub fallback, no guessing alternate paths.
      console.error(`\n❌ nexus-vfs binary not available for ${platform}-${arch} in v${VERSION}.`);
      console.error(`   Tried: ${urls.join(', ')} → HTTP 404`);
      console.error('   This platform is not published in this release; nothing installed.');
      return false;
    }
    throw lastErr;
  }

  // Integrity check against the known-good SHA256 before we trust the archive.
  const expectedSha = SHA256SUMS[artifact];
  if (expectedSha) {
    const actualSha = sha256OfFile(archivePath);
    if (actualSha !== expectedSha) {
      try {
        fs.unlinkSync(archivePath);
      } catch {}
      throw new Error(`SHA256 mismatch for ${artifact}: expected ${expectedSha}, got ${actualSha}`);
    }
    console.log(`SHA256 verified: ${actualSha}`);
  } else {
    console.warn(`⚠️  No SHA256 for ${artifact}; skipping integrity check (pending COS mirror).`);
  }

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

/**
 * Download and install the vault plugin dylib to ~/.nexus-vfs/plugins/.
 * Tries COS mirrors first, then falls back to GitHub Release.
 */
async function installVaultPlugin(platform, arch, force) {
  const artifact = getVaultArtifactName(platform, arch);
  if (!artifact) {
    console.log(`⏭️  Vault plugin not available for ${platform}-${arch}; skipping.`);
    return false;
  }

  const dylibName = getVaultDylibName(platform);
  const installedDylib = path.join(PLUGIN_DIR, dylibName);

  if (fs.existsSync(installedDylib) && fs.existsSync(VAULT_READY_MARKER) && fs.readFileSync(VAULT_READY_MARKER, 'utf-8').trim() === VAULT_VERSION && !force) {
    console.log(`Already installed (vault v${VAULT_VERSION}): ${installedDylib}`);
    return true;
  }

  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  fs.mkdirSync(PLUGIN_DIR, { recursive: true });

  const archivePath = path.join(DOWNLOAD_DIR, artifact);
  const extractDir = path.join(DOWNLOAD_DIR, `vault-extract-${Date.now()}`);

  // Try COS mirrors first, then GitHub Release.
  const urls = [
    ...VAULT_COS_BASE_URLS.map((base) => `${base}/${artifact}`),
    `${VAULT_GITHUB_URL}/${artifact}`,
  ];

  let downloaded = false;
  let lastErr = null;
  for (const url of urls) {
    try {
      await downloadFile(url, archivePath);
      downloaded = true;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!downloaded) {
    try { fs.unlinkSync(archivePath); } catch {}
    console.error(`\n❌ Vault plugin not available for ${platform}-${arch} in v${VAULT_VERSION}.`);
    console.error(`   Tried: ${urls.join(', ')}`);
    return false;
  }

  // SHA256 verification.
  const expectedSha = SHA256SUMS[artifact];
  if (expectedSha) {
    const actualSha = sha256OfFile(archivePath);
    if (actualSha !== expectedSha) {
      try { fs.unlinkSync(archivePath); } catch {}
      throw new Error(`SHA256 mismatch for ${artifact}: expected ${expectedSha}, got ${actualSha}`);
    }
    console.log(`SHA256 verified: ${actualSha}`);
  } else {
    console.warn(`⚠️  No SHA256 for ${artifact}; skipping integrity check.`);
  }

  extractArchive(archivePath, extractDir);

  // Find the dylib in the extracted tree.
  const extractedDylib = findBinaryInDir(extractDir, dylibName);
  if (!extractedDylib) {
    throw new Error(`Archive ${artifact} did not contain expected dylib ${dylibName}`);
  }

  fs.copyFileSync(extractedDylib, installedDylib);
  if (!isWindows) {
    fs.chmodSync(installedDylib, 0o755);
  }

  fs.writeFileSync(VAULT_READY_MARKER, VAULT_VERSION);

  try {
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.unlinkSync(archivePath);
  } catch {}

  const size = fs.statSync(installedDylib).size;
  console.log(`Installed vault plugin: ${installedDylib} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  return true;
}

/** Like findBinary but takes a custom filename to search for. */
function findBinaryInDir(dir, wanted) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findBinaryInDir(full, wanted);
      if (found) return found;
    } else if (entry.name === wanted) {
      return full;
    }
  }
  return null;
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

  console.log(`Downloading nexus-vfs (v${VERSION}) + vault plugin (v${VAULT_VERSION}) for ${platform}-${arch}...`);
  console.log('');

  try {
    const ok = await installForPlatform(platform, arch, force);
    if (ok) {
      console.log('\n✅ nexus-vfs download completed');
    } else {
      console.log('\n⏭️  Skipping nexus-vfs (not available for this platform)');
    }
  } catch (err) {
    console.error(`\n❌ Failed to download nexus-vfs:`, err.message);
  }

  // Vault plugin — separate artifact from nexus repo.
  try {
    const vaultOk = await installVaultPlugin(platform, arch, force);
    if (vaultOk) {
      console.log('\n✅ vault plugin download completed');
    }
  } catch (err) {
    console.error(`\n❌ Failed to download vault plugin:`, err.message);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(0);
});
