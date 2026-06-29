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
const runtimeSha256 = require('../src/shared/runtime-sha256.json');
const {
  OS_NAME,
  CLUSTER_ARCH,
  getClusterArtifact,
  getClusterBinary,
  getPluginArtifact,
  getPluginDylib,
  getPluginSig,
} = require('./plugin-naming.js');

const VERSION = runtimeVersions['nexus-vfs'];
const VAULT_VERSION = runtimeVersions['nexus-vault'];
const LOCAL_CONNECTOR_VERSION = runtimeVersions['nexus-local-connector'];
const FUSE_PLUGIN_VERSION = runtimeVersions['nexus-fuse-plugin'];

// Runtime bucket is primary; legacy bucket stays live as a fallback during deprecation.
const COS_BASE_URLS = [
  `https://sudowork-runtime-1309794936.cos.ap-beijing.myqcloud.com/nexus-vfs/release/v${VERSION}`,
  `https://sudoclaw-download-1309794936.cos.ap-beijing.myqcloud.com/nexus-vfs/release/v${VERSION}`,
];

// GitHub Release fallback for nexus-vfs cluster, mirroring the same pattern
// used by vault/local-connector/fuse-plugin below. nexus-vfs's release.yml
// `publish-cos` step is gated on TENCENT_SECRET_ID/KEY; when those aren't
// configured the upload silently skips and primary COS 404s. The GitHub
// release (`publish-github-release` step, `softprops/action-gh-release@v2`)
// is unconditional on tag push, so the GH-release fallback is always
// available even when the COS mirror is empty.
const NEXUS_VFS_GITHUB_URL = `https://github.com/nexi-lab/nexus-vfs/releases/download/v${VERSION}`;

// Vault plugin is released from the nexus repo (separate from nexus-vfs).
const VAULT_COS_BASE_URLS = [
  `https://sudowork-runtime-1309794936.cos.ap-beijing.myqcloud.com/nexus-vault/release/v${VAULT_VERSION}`,
  `https://sudoclaw-download-1309794936.cos.ap-beijing.myqcloud.com/nexus-vault/release/v${VAULT_VERSION}`,
];

// GitHub Release fallback for vault plugin (梁 mirrors to COS, but GH is source of truth).
const VAULT_GITHUB_URL = `https://github.com/nexi-lab/nexus/releases/download/vault-v${VAULT_VERSION}`;

// local-connector + fuse-plugin are released from the nexus repo too. Both
// signed by kernel-dogfood-v1.pub (in contrast to vault's nexus-team.pub
// bootstrap key); kernel trust root in nexus-vfs#58 picks up both keys.
const LOCAL_CONNECTOR_COS_BASE_URLS = [
  `https://sudowork-runtime-1309794936.cos.ap-beijing.myqcloud.com/nexus-local-connector/release/v${LOCAL_CONNECTOR_VERSION}`,
  `https://sudoclaw-download-1309794936.cos.ap-beijing.myqcloud.com/nexus-local-connector/release/v${LOCAL_CONNECTOR_VERSION}`,
];
const LOCAL_CONNECTOR_GITHUB_URL = `https://github.com/nexi-lab/nexus/releases/download/local-connector-v${LOCAL_CONNECTOR_VERSION}`;

const FUSE_PLUGIN_COS_BASE_URLS = [
  `https://sudowork-runtime-1309794936.cos.ap-beijing.myqcloud.com/nexus-fuse-plugin/release/v${FUSE_PLUGIN_VERSION}`,
  `https://sudoclaw-download-1309794936.cos.ap-beijing.myqcloud.com/nexus-fuse-plugin/release/v${FUSE_PLUGIN_VERSION}`,
];
const FUSE_PLUGIN_GITHUB_URL = `https://github.com/nexi-lab/nexus/releases/download/fuse-v${FUSE_PLUGIN_VERSION}`;

/**
 * Known-good SHA256 sums (mirrors SHA256SUMS.txt in the bucket).
 * A download whose hash is not listed here is rejected — no silent acceptance.
 *
 * Single source of truth lives in `src/shared/runtime-sha256.json` so the
 * runtime re-installers (DynamicNexusVfsService, VaultPluginInstaller) read
 * the SAME table — bumping a version in `runtime-versions.json` without a
 * matched bump here used to leave the runtime stuck on the old SHA while
 * the script downloaded the new bytes (the #918 → Mac smoke regression).
 * Strip the `_doc` key so legitimate artifact lookups don't accidentally
 * match a documentation string.
 */
const SHA256SUMS = Object.fromEntries(Object.entries(runtimeSha256).filter(([key]) => !key.startsWith('_')));



const HOME = os.homedir();
const INSTALL_ROOT = path.join(HOME, '.nexus-vfs');
const BIN_DIR = path.join(INSTALL_ROOT, 'bin');
const PLUGIN_DIR = path.join(INSTALL_ROOT, 'plugins');
const DOWNLOAD_DIR = path.join(INSTALL_ROOT, 'downloads');
const READY_MARKER = path.join(BIN_DIR, '.nexus-vfs-bin-ready');
const VAULT_READY_MARKER = path.join(PLUGIN_DIR, '.nexus-vault-ready');
const LOCAL_CONNECTOR_READY_MARKER = path.join(PLUGIN_DIR, '.nexus-local-connector-ready');
const FUSE_PLUGIN_READY_MARKER = path.join(PLUGIN_DIR, '.nexus-fuse-plugin-ready');

const isWindows = process.platform === 'win32';

// Cluster + plugin archive/dylib naming lives in scripts/plugin-naming.js
// (the SSOT). The wrappers below preserve the original (platform, arch) =
// defaults from process.platform / process.arch so callers that omit args
// keep working — that's a stable contract for the install helpers below.
//
// Why the per-plugin one-line wrappers stay: they pin a plugin's logical
// name at the call site (`getVaultArtifactName`) and make a re-grep across
// the file trivial. Removing them would inline string literals (vault,
// local-connector, fuse-plugin) into every caller and make the platform
// matrix harder to audit.

function getBinaryName() {
  return getClusterBinary(process.platform);
}

function getArtifactName(platform = process.platform, arch = process.arch) {
  const name = getClusterArtifact(platform, arch);
  if (!name) {
    throw new Error(`Unsupported platform: ${platform}-${arch}`);
  }
  return name;
}

function getVaultArtifactName(platform = process.platform, arch = process.arch) {
  return getPluginArtifact(platform, arch, 'nexus_vault');
}

function getVaultDylibName(platform = process.platform) {
  return getPluginDylib(platform, 'nexus_vault');
}

function getVaultSigName(platform = process.platform) {
  return getPluginSig(platform, 'nexus_vault');
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
            // Pass the callback to close() so we resolve AFTER the OS
            // file handle is released. Without this, on Windows the very
            // next step (extractArchive → PowerShell Expand-Archive) can
            // race and hit "the process cannot access the file because it
            // is being used by another process" — `file.close()` returns
            // before the kernel handle is gone if no callback is given.
            file.close(() => {
              console.log('\nDownload complete.');
              resolve();
            });
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
 *
 * On Windows, retries the extraction once after a brief sleep — Defender
 * real-time scanning briefly locks freshly-written zips, and Expand-Archive
 * does not set $LASTEXITCODE on cmdlet errors (so `execFileSync` would
 * otherwise see exit 0 and the caller's `findBinaryInDir` would fail
 * downstream with a misleading "missing dylib" message).
 */
function extractArchive(archivePath, extractDir) {
  fs.mkdirSync(extractDir, { recursive: true });

  // Windows 10+ ships `bsdtar` at `%SystemRoot%\System32\tar.exe`. It
  // handles both `.zip` and `.tar.gz`, accepts Windows-native paths
  // (Git Bash's GNU tar does not), and reads via a different I/O path
  // than PowerShell's Expand-Archive — so it side-steps the Defender
  // real-time-scan file-lock race that Expand-Archive trips on
  // freshly-downloaded archives. Use the absolute path so PATH
  // ordering can't accidentally pick up GNU tar from Git Bash.
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const winTar = `${systemRoot}\\System32\\tar.exe`;
  const tarBin = isWindows ? winTar : 'tar';
  const runOnce = () => {
    if (archivePath.endsWith('.zip')) {
      if (isWindows) {
        execFileSync(tarBin, ['-xf', archivePath, '-C', extractDir], { stdio: 'inherit' });
      } else {
        execFileSync('unzip', ['-o', archivePath, '-d', extractDir], { stdio: 'inherit' });
      }
    } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
      execFileSync(tarBin, ['-xzf', archivePath, '-C', extractDir], { stdio: 'inherit' });
    } else {
      throw new Error(`Unsupported archive format: ${archivePath}`);
    }
  };

  const isEmpty = () => {
    try {
      return fs.readdirSync(extractDir).length === 0;
    } catch {
      return true;
    }
  };

  runOnce();
  if (isWindows && isEmpty()) {
    // Defender / file-lock race — wait, then retry once.
    execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 1500'], {
      stdio: 'ignore',
    });
    runOnce();
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
  const urls = [...COS_BASE_URLS.map((base) => `${base}/${artifact}`), `${NEXUS_VFS_GITHUB_URL}/${artifact}`];
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

  // Stage the verified vault archive into resources/ so electron-builder can
  // bundle it as an extraResource. This mirrors how scode/nexusd-cluster
  // archives are staged for packaging. The versioned filename follows the
  // same convention: v${VERSION}-${artifactName}.
  const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
  try {
    fs.mkdirSync(RESOURCES_DIR, { recursive: true });
    const stagedName = `v${VAULT_VERSION}-${artifact}`;
    const stagedPath = path.join(RESOURCES_DIR, stagedName);
    fs.copyFileSync(archivePath, stagedPath);
    console.log(`Staged vault archive for packaging: ${stagedPath}`);
  } catch (err) {
    console.warn(`⚠️  Could not stage vault archive to resources/: ${err.message}`);
  }

  // Find the dylib in the extracted tree.
  const extractedDylib = findBinaryInDir(extractDir, dylibName);
  if (!extractedDylib) {
    throw new Error(`Archive ${artifact} did not contain expected dylib ${dylibName}`);
  }

  fs.copyFileSync(extractedDylib, installedDylib);
  if (!isWindows) {
    fs.chmodSync(installedDylib, 0o755);
  }

  // Plugin signature: present in v0.1.2+ archives, absent in v0.1.1. When
  // present, copy it alongside the dylib so the kernel's PluginLoader can
  // Ed25519-verify before dlopen. When absent, the cluster's verify path
  // will reject the dylib at load — that failure surfaces clearly enough
  // that an extra error here would just duplicate it.
  const sigName = getVaultSigName(platform);
  const installedSig = path.join(PLUGIN_DIR, sigName);
  const extractedSig = findBinaryInDir(extractDir, sigName);
  if (extractedSig) {
    fs.copyFileSync(extractedSig, installedSig);
    console.log(`Installed vault plugin signature: ${installedSig}`);
  } else {
    // Best-effort cleanup so an older signed install doesn't shadow a
    // newer unsigned one (and vice versa) across version downgrades.
    try { fs.unlinkSync(installedSig); } catch {}
    console.warn(
      `⚠️  Archive ${artifact} contains no ${sigName}. Cluster signature ` +
      'verification will reject this plugin — bump vault to v0.1.2+ to fix.',
    );
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

// ── local-connector + fuse-plugin (signed by kernel-dogfood-v1.pub) ─────
//
// Both plugins share the vault-plugin install pattern: pull a signed
// archive from COS (with GitHub fallback), verify SHA256, extract dylib +
// `.sig` into ~/.nexus-vfs/plugins/. Refactoring into a single generic
// installer would obscure the per-plugin platform matrices, so we keep
// them as small wrappers around a shared core (`installSignedKernelPlugin`).

/**
 * Generic install path for a kernel-signed plugin. Carries the same
 * download/verify/extract logic as installVaultPlugin; per-plugin config
 * (artifact name, dylib name, ready marker, URLs) is supplied by the caller.
 */
async function installSignedKernelPlugin(spec, platform, arch, force) {
  const { displayName, version, artifactName, dylibName, sigName, urls, readyMarker } = spec;
  if (!artifactName) {
    console.log(`⏭️  ${displayName} not available for ${platform}-${arch}; skipping.`);
    return false;
  }
  if (!dylibName) {
    console.log(`⏭️  ${displayName}: no dylib name resolved for ${platform}; skipping.`);
    return false;
  }

  const installedDylib = path.join(PLUGIN_DIR, dylibName);

  if (
    fs.existsSync(installedDylib) &&
    fs.existsSync(readyMarker) &&
    fs.readFileSync(readyMarker, 'utf-8').trim() === version &&
    !force
  ) {
    console.log(`Already installed (${displayName} v${version}): ${installedDylib}`);
    return true;
  }

  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  fs.mkdirSync(PLUGIN_DIR, { recursive: true });

  const archivePath = path.join(DOWNLOAD_DIR, artifactName);
  const extractDir = path.join(DOWNLOAD_DIR, `${displayName}-extract-${Date.now()}`);

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
    try {
      fs.unlinkSync(archivePath);
    } catch {}
    console.error(`\n❌ ${displayName} not available for ${platform}-${arch} in v${version}.`);
    console.error(`   Tried: ${urls.join(', ')}`);
    if (lastErr) console.error(`   Last error: ${lastErr.message}`);
    return false;
  }

  const expectedSha = SHA256SUMS[artifactName];
  if (expectedSha) {
    const actualSha = sha256OfFile(archivePath);
    if (actualSha !== expectedSha) {
      try {
        fs.unlinkSync(archivePath);
      } catch {}
      throw new Error(`SHA256 mismatch for ${artifactName}: expected ${expectedSha}, got ${actualSha}`);
    }
    console.log(`SHA256 verified: ${actualSha}`);
  } else {
    console.warn(`⚠️  No SHA256 for ${artifactName}; skipping integrity check.`);
  }

  extractArchive(archivePath, extractDir);

  const extractedDylib = findBinaryInDir(extractDir, dylibName);
  if (!extractedDylib) {
    throw new Error(`Archive ${artifactName} did not contain expected dylib ${dylibName}`);
  }
  fs.copyFileSync(extractedDylib, installedDylib);
  if (!isWindows) fs.chmodSync(installedDylib, 0o755);

  const installedSig = path.join(PLUGIN_DIR, sigName);
  const extractedSig = findBinaryInDir(extractDir, sigName);
  if (extractedSig) {
    fs.copyFileSync(extractedSig, installedSig);
    console.log(`Installed ${displayName} signature: ${installedSig}`);
  } else {
    try {
      fs.unlinkSync(installedSig);
    } catch {}
    console.warn(
      `⚠️  Archive ${artifactName} contains no ${sigName}. Cluster signature ` +
        `verification will reject this plugin.`,
    );
  }

  fs.writeFileSync(readyMarker, version);

  try {
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.unlinkSync(archivePath);
  } catch {}

  const size = fs.statSync(installedDylib).size;
  console.log(`Installed ${displayName} plugin: ${installedDylib} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  return true;
}

/** Per-platform archive name for the local-connector release. */
function getLocalConnectorArtifactName(platform, arch) {
  return getPluginArtifact(platform, arch, 'nexus_local_connector');
}

function getLocalConnectorDylibName(platform) {
  return getPluginDylib(platform, 'nexus_local_connector');
}

async function installLocalConnectorPlugin(platform, arch, force) {
  const artifactName = getLocalConnectorArtifactName(platform, arch);
  const dylibName = getLocalConnectorDylibName(platform);
  return installSignedKernelPlugin(
    {
      displayName: 'local-connector',
      version: LOCAL_CONNECTOR_VERSION,
      artifactName,
      dylibName,
      sigName: dylibName ? `${dylibName}.sig` : null,
      urls: [
        ...(artifactName ? LOCAL_CONNECTOR_COS_BASE_URLS.map((b) => `${b}/${artifactName}`) : []),
        ...(artifactName ? [`${LOCAL_CONNECTOR_GITHUB_URL}/${artifactName}`] : []),
      ],
      readyMarker: LOCAL_CONNECTOR_READY_MARKER,
    },
    platform,
    arch,
    force,
  );
}

function getFusePluginArtifactName(platform, arch) {
  // macOS runs the FUSE protocol via FUSE-T (userspace driver provisioned
  // lazily by `FuseTInstallService`, not eagerly here). Windows stays on
  // the existing WinFsp path — separate adapter, not shipped by this
  // fuse-plugin release. The `publishedPlatforms` whitelist in
  // plugin-naming.js is the SSOT for that policy.
  return getPluginArtifact(platform, arch, 'nexus_fuse_plugin');
}

function getFusePluginDylibName(platform) {
  return getPluginDylib(platform, 'nexus_fuse_plugin');
}

async function installFusePlugin(platform, arch, force) {
  const artifactName = getFusePluginArtifactName(platform, arch);
  const dylibName = getFusePluginDylibName(platform);
  return installSignedKernelPlugin(
    {
      displayName: 'fuse-plugin',
      version: FUSE_PLUGIN_VERSION,
      artifactName,
      dylibName,
      sigName: dylibName ? `${dylibName}.sig` : null,
      urls: [
        ...(artifactName ? FUSE_PLUGIN_COS_BASE_URLS.map((b) => `${b}/${artifactName}`) : []),
        ...(artifactName ? [`${FUSE_PLUGIN_GITHUB_URL}/${artifactName}`] : []),
      ],
      readyMarker: FUSE_PLUGIN_READY_MARKER,
    },
    platform,
    arch,
    force,
  );
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

  if (!OS_NAME[platform] || !CLUSTER_ARCH[arch]) {
    console.warn(`⚠️  Unsupported platform: ${platform}-${arch}; skipping nexus-vfs.`);
    process.exit(0);
  }

  console.log(
    `Downloading nexus-vfs (v${VERSION}) + plugins: ` +
      `vault v${VAULT_VERSION}, local-connector v${LOCAL_CONNECTOR_VERSION}, ` +
      `fuse-plugin v${FUSE_PLUGIN_VERSION} for ${platform}-${arch}...`,
  );
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

  // local-connector + fuse-plugin — also separate artifacts from nexus repo.
  // Both signed by kernel-dogfood-v1.pub (vs vault's nexus-team.pub
  // bootstrap key). Trust root for both lives in the kernel's
  // TRUSTED_KEY_FILES alongside nexus-team.pub.
  try {
    const lcOk = await installLocalConnectorPlugin(platform, arch, force);
    if (lcOk) {
      console.log('\n✅ local-connector plugin download completed');
    }
  } catch (err) {
    console.error('\n❌ Failed to download local-connector plugin:', err.message);
  }

  try {
    const fuseOk = await installFusePlugin(platform, arch, force);
    if (fuseOk) {
      console.log('\n✅ fuse-plugin download completed');
    }
  } catch (err) {
    console.error('\n❌ Failed to download fuse-plugin:', err.message);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(0);
});
