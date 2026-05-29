#!/usr/bin/env node
/**
 * Download pre-built openclaw (sudoclaw) archive for ad-hoc debugging.
 * This archive is no longer bundled into app packages by CI or build scripts.
 *
 * Downloads from GitHub releases with COS fallback:
 * - GitHub: https://github.com/sudoprivacy/sudorepo/releases/download/v{version}/v{version}-sudoclaw-{platform}-{arch}.tgz
 * - COS:   https://sudoworkhub-1309794936.cos.ap-beijing.myqcloud.com/v{version}/v{version}-sudoclaw-{platform}-{arch}.tgz
 *
 * Saves to: resources/v{version}-sudoclaw-{platform}-{arch}.tgz
 * Also writes: resources/v{version}-sudoclaw-{platform}-{arch}.manifest.json
 *
 * NOTE: Download failures are fatal (exit 1) — unlike nexus, we do NOT create empty placeholders.
 *
 * Usage: node scripts/download-openclaw.js [--force] [platform]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const runtimeVersions = require('../src/shared/runtime-versions.json');
const { updateLocalDevRuntimeVersion, clearLocalDevRuntimeVersion } = require('./dev-runtime-state');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const SUDOCLAW_VERSION = runtimeVersions.sudoclaw;
const SUDOCLAW_RELEASE_VERSION = SUDOCLAW_VERSION.split('-')[0];

const GITHUB_BASE_URL = `https://github.com/sudoprivacy/sudorepo/releases/download/${SUDOCLAW_RELEASE_VERSION}`;
const COS_BASE_URL = `https://sudoworkhub-1309794936.cos.ap-beijing.myqcloud.com/${SUDOCLAW_RELEASE_VERSION}`;

// Platform mappings: Node.js platform-arch → sudoclaw archive name
const PLATFORMS = {
  'darwin-arm64': { os: 'macos', arch: 'arm64' },
  'darwin-x64': { os: 'macos', arch: 'x64' },
  'win32-arm64': { os: 'windows', arch: 'arm64' },
  'win32-x64': { os: 'windows', arch: 'x64' },
};

function getPlatformConfig(platform) {
  const config = PLATFORMS[platform];
  if (!config) throw new Error(`Unknown platform: ${platform}`);

  const [nodePlatform, nodeArch] = platform.split('-');
  if (!nodePlatform || !nodeArch) {
    throw new Error(`Invalid platform identifier: ${platform}`);
  }

  return {
    ...config,
    nodePlatform,
    nodeArch,
  };
}

/**
 * Get the archive filename for a given platform.
 * e.g. v0.1.0-v2026.03.11-sudoclaw-macos-arm64.tgz
 */
function getArchiveFileName(platform) {
  const config = getPlatformConfig(platform);
  return `${SUDOCLAW_VERSION}-sudoclaw-${config.os}-${config.arch}.tgz`;
}

function getManifestFileName(platform) {
  return getArchiveFileName(platform).replace(/\.tgz$/i, '.manifest.json');
}

function getGitHubDownloadUrl(platform) {
  return `${GITHUB_BASE_URL}/${getArchiveFileName(platform)}`;
}

function getCosDownloadUrl(platform) {
  return `${COS_BASE_URL}/${getArchiveFileName(platform)}`;
}

function getDaveyBindingDirName(platform, arch) {
  const suffix = platform === 'win32' ? 'msvc' : platform === 'linux' ? 'gnu' : '';
  return `davey-${platform}-${arch}${suffix ? `-${suffix}` : ''}`;
}

function writeOpenClawManifest(platform, version) {
  const config = getPlatformConfig(platform);
  const outputManifest = path.join(RESOURCES_DIR, getManifestFileName(platform));
  const manifest = {
    version,
    platform: config.nodePlatform,
    arch: config.nodeArch,
    daveyBinding: `@snazzah/${getDaveyBindingDirName(config.nodePlatform, config.nodeArch)}`,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(outputManifest, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(`[openclaw] Wrote manifest to ${outputManifest}`);
}

/**
 * Download a file from URL with redirect support.
 * Returns a promise that resolves on success, rejects on failure.
 */
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
            file.close();
            try {
              fs.unlinkSync(dest);
            } catch {}
            reject(new Error('NOT_FOUND'));
            return;
          }

          if (response.statusCode !== 200) {
            file.close();
            try {
              fs.unlinkSync(dest);
            } catch {}
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
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {}
          reject(err);
        });
    };

    request(url);
  });
}

async function downloadOpenClaw(platform, force = false) {
  const output = path.join(RESOURCES_DIR, getArchiveFileName(platform));
  // Skip if already exists
  if (fs.existsSync(output) && !force) {
    console.log(`Already exists: ${output}`);
    console.log('Use --force to re-download.');
    return true;
  }

  // Ensure resources directory exists
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  // Try GitHub first, then COS fallback
  const downloadAttempts = [
    { label: 'GitHub', url: getGitHubDownloadUrl(platform) },
    { label: 'COS', url: getCosDownloadUrl(platform) },
  ];

  let lastError = null;

  for (const attempt of downloadAttempts) {
    console.log(`\n[openclaw] Trying ${attempt.label} download...`);
    try {
      await downloadFile(attempt.url, output);
      console.log(`[openclaw] Downloaded from ${attempt.label}: ${output}`);
      return true;
    } catch (err) {
      lastError = err;
      console.warn(`[openclaw] ${attempt.label} download failed: ${err.message}`);
      // Clean up partial download
      try {
        fs.unlinkSync(output);
      } catch {}
    }
  }

  // Both sources failed — do NOT create empty placeholder
  throw new Error(
    `Failed to download openclaw for ${platform} from all sources. Last error: ${lastError?.message || 'unknown'}`
  );
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

  // Default: current platform (respect npm_config_platform/npm_config_arch for cross-compilation)
  if (!platform) {
    const effectivePlatform = process.env.npm_config_platform || process.platform;
    const effectiveArch = process.env.npm_config_arch || process.arch;
    const currentPlatform = `${effectivePlatform}-${effectiveArch}`;
    if (PLATFORMS[currentPlatform]) {
      platform = currentPlatform;
    } else {
      console.error(`❌ Unsupported platform: ${currentPlatform}`);
      console.error('   Supported platforms: ' + Object.keys(PLATFORMS).join(', '));
      process.exit(1);
    }
  }

  console.log(`[openclaw] Downloading sudoclaw ${SUDOCLAW_VERSION} for ${platform}...`);
  console.log('');

  try {
    const success = await downloadOpenClaw(platform, force);
    if (success) {
      writeOpenClawManifest(platform, SUDOCLAW_VERSION);
      updateLocalDevRuntimeVersion('openclaw', SUDOCLAW_VERSION);
      console.log('\n✅ OpenClaw download completed');
    }
  } catch (err) {
    console.error(`\n❌ Failed to download:`, err.message);
    clearLocalDevRuntimeVersion('openclaw');
    // Exit 1 — do not allow build to continue without openclaw
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  clearLocalDevRuntimeVersion('openclaw');
  process.exit(1);
});
