#!/usr/bin/env node
/**
 * Download Scode binary for bundling with the app.
 * Run during build process: bun run scode:download
 *
 * Downloads Scode from the Tencent COS mirror (rolling "latest"):
 *   https://sudoclaw-download-1309794936.cos.ap-beijing.myqcloud.com/sudocode/release/latest/
 * The mirror is rolling-latest only (no versioned directories). The scode entry
 * in runtime-versions.json is informational; integrity is enforced via the
 * SHA256SUMS.txt published alongside the artifacts.
 * Override the base with SCODE_DOWNLOAD_BASE_URL. GitHub Releases are NOT used by
 * default; set SUDOWORK_USE_GITHUB_FALLBACK=1 to add GitHub as a fallback source.
 *
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
const crypto = require('crypto');
const runtimeVersions = require('../src/shared/runtime-versions.json');

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

// Tencent COS mirror is the default source. The mirror is rolling-latest only
// (no versioned dirs). Override with SCODE_DOWNLOAD_BASE_URL (trailing slash optional).
const COS_BASE_URL = (process.env.SCODE_DOWNLOAD_BASE_URL || 'https://sudoclaw-download-1309794936.cos.ap-beijing.myqcloud.com/sudocode/release/latest').replace(/\/+$/, '');

// GitHub is opt-in only, gated behind SUDOWORK_USE_GITHUB_FALLBACK=1.
const GITHUB_BASE_URL = `https://github.com/sudoprivacy/sudocode/releases/download/v${SCODE_VERSION}`;
const USE_GITHUB_FALLBACK = process.env.SUDOWORK_USE_GITHUB_FALLBACK === '1';

// Platform mappings: archive downloads (.tar.gz for macOS, .zip for Windows)
const PLATFORMS = {
  'darwin-arm64': { name: 'scode-macos-arm64.tar.gz' },
  'darwin-x64': { name: 'scode-macos-x64.tar.gz' },
  'win32-arm64': { name: 'scode-windows-arm64.zip' },
  'win32-x64': { name: 'scode-windows-x64.zip' },
};

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

/**
 * Ordered list of download URLs to try for the given platform.
 * COS first; GitHub only when SUDOWORK_USE_GITHUB_FALLBACK=1.
 */
function getDownloadUrls(platform) {
  const config = PLATFORMS[platform];
  if (!config) throw new Error(`Unknown platform: ${platform}`);
  const urls = [`${COS_BASE_URL}/${config.name}`];
  if (USE_GITHUB_FALLBACK) urls.push(`${GITHUB_BASE_URL}/${config.name}`);
  return urls;
}

/** Fetch a small text resource (SHA256SUMS.txt), following redirects. */
function fetchText(url) {
  return new Promise((resolve, reject) => {
    let redirects = 0;
    const request = (urlStr) => {
      if (redirects++ > 10) {
        reject(new Error('Too many redirects'));
        return;
      }
      https
        .get(urlStr, (response) => {
          if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
            request(response.headers.location);
            return;
          }
          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }
          let data = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            data += chunk;
          });
          response.on('end', () => resolve(data));
        })
        .on('error', reject);
    };
    request(url);
  });
}

/** Parse a SHA256SUMS.txt body and return the lowercase hex hash for `filename`. */
function expectedHashFor(sumsText, filename) {
  for (const line of sumsText.split('\n')) {
    const match = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (match && match[2].trim() === filename) return match[1].toLowerCase();
  }
  return null;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Verify a downloaded artifact against the SHA256SUMS.txt next to it.
 * Throws an Error tagged with code 'INTEGRITY' on any verification failure.
 */
async function verifyIntegrity(artifactUrl, filePath, filename) {
  const sumsUrl = artifactUrl.replace(/[^/]+$/, 'SHA256SUMS.txt');
  let sumsText;
  try {
    sumsText = await fetchText(sumsUrl);
  } catch (err) {
    const e = new Error(`Could not fetch SHA256SUMS.txt from ${sumsUrl}: ${err.message}`);
    e.code = 'INTEGRITY';
    throw e;
  }
  const expected = expectedHashFor(sumsText, filename);
  if (!expected) {
    const e = new Error(`No SHA256 entry for ${filename} in ${sumsUrl}`);
    e.code = 'INTEGRITY';
    throw e;
  }
  const actual = sha256File(filePath);
  if (actual !== expected) {
    const e = new Error(`SHA256 mismatch for ${filename}: expected ${expected}, got ${actual}`);
    e.code = 'INTEGRITY';
    throw e;
  }
  console.log(`SHA256 verified: ${filename}`);
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

  // Skip if already exists
  if (fs.existsSync(outputFile) && !force) {
    console.log(`Already exists: ${outputFile}`);
    console.log('Use --force to re-download.');
    return true;
  }

  // Ensure resources directory exists
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  // Try each source in order (COS, then optional GitHub fallback).
  const config = PLATFORMS[platform];
  const urls = getDownloadUrls(platform);
  let lastErr = null;

  for (const url of urls) {
    try {
      await downloadFile(url, outputFile);
      await verifyIntegrity(url, outputFile, config.name);
      console.log(`Saved to: ${outputFile}`);
      return true;
    } catch (err) {
      lastErr = err;
      // Clean up partial/corrupted download before the next attempt.
      try {
        fs.unlinkSync(outputFile);
      } catch {}
      console.warn(`Download failed from ${url}: ${err.message}`);
      // An integrity failure is a hard stop — do not fall back or placeholder.
      if (err.code === 'INTEGRITY') throw err;
    }
  }

  if (lastErr && lastErr.message === 'NOT_FOUND') {
    console.warn(`\n⚠️  Scode binary not available for platform ${platform}`);
    console.warn('   Creating empty placeholder file.');
    console.warn('   Users can install Scode manually from the About page.');
    // Create empty placeholder file so electron-builder doesn't fail
    fs.writeFileSync(outputFile, Buffer.alloc(0));
    return false;
  }

  throw lastErr || new Error('Download failed');
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
    if (err.code === 'INTEGRITY') {
      console.error('   Integrity check failed — refusing to bundle a possibly corrupted or tampered binary.');
      process.exit(1);
    }
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
