#!/usr/bin/env node
/**
 * Download python-build-standalone binaries for bundling with the app.
 * Run during build process: bun run python:download
 *
 * Downloads pre-built Python (from astral-sh/python-build-standalone) for the
 * current or specified platform. Bundled Python is extracted at runtime to
 * ~/.nexus/python/ and used as a managed interpreter — no admin privileges needed.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Target Python minor version. The download script will pick the latest patch
// release (e.g. 3.13.14) automatically from the newest python-build-standalone release.
const PYTHON_MINOR = '3.13';
const RESOURCES_DIR = path.join(__dirname, '..', 'resources');

// Mapping from our platform key to the python-build-standalone asset suffix.
// Asset filename format: cpython-{minor}.{patch}+{date}-{suffix}
// e.g. cpython-3.13.14+20260623-aarch64-apple-darwin-install_only_stripped.tar.gz
const PLATFORMS = {
  'darwin-arm64': 'aarch64-apple-darwin-install_only_stripped.tar.gz',
  'darwin-x64': 'x86_64-apple-darwin-install_only_stripped.tar.gz',
  'win32-x64': 'x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
  'win32-arm64': 'aarch64-pc-windows-msvc-install_only_stripped.tar.gz',
};

function getOutputPath(platform) {
  return path.join(RESOURCES_DIR, `python-${platform}.tar.gz`);
}

/**
 * Query the GitHub Releases API to find the latest python-build-standalone
 * release that contains an install_only_stripped asset for the given platform
 * and Python minor version (PYTHON_MINOR).
 *
 * Asset name pattern:
 *   cpython-{minor}.{patch}+{date}-{arch}-{os}-install_only_stripped.tar.gz
 * e.g.:
 *   cpython-3.13.14+20260623-aarch64-apple-darwin-install_only_stripped.tar.gz
 *
 * Returns { tag, pythonVersion, downloadUrl } or throws if not found.
 */
function fetchLatestRelease(platform) {
  const suffix = PLATFORMS[platform];
  if (!suffix) throw new Error(`Unknown platform: ${platform}`);

  // prefix: "cpython-3.13." — matches any patch release of the target minor
  const prefix = `cpython-${PYTHON_MINOR}.`;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/astral-sh/python-build-standalone/releases?per_page=10',
      headers: {
        'User-Agent': 'sudowork-download-script',
        Accept: 'application/vnd.github+json',
      },
    };

    https
      .get(options, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`GitHub API responded ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          let releases;
          try {
            releases = JSON.parse(body);
          } catch (e) {
            reject(new Error(`Failed to parse GitHub API response: ${e.message}`));
            return;
          }
          for (const release of releases) {
            const asset = (release.assets || []).find(
              (a) => a.name.startsWith(prefix) && a.name.endsWith(suffix),
            );
            if (asset) {
              // Extract the full version string from the asset name, e.g. "3.13.14"
              const versionMatch = asset.name.match(/^cpython-(\d+\.\d+\.\d+)\+/);
              const pythonVersion = versionMatch ? versionMatch[1] : PYTHON_MINOR;
              resolve({ tag: release.tag_name, pythonVersion, downloadUrl: asset.browser_download_url });
              return;
            }
          }
          reject(
            new Error(
              `No python-build-standalone release found for Python ${PYTHON_MINOR}.x on ${platform}.\n` +
                `Suffix searched: ${suffix}\n` +
                `Check https://github.com/astral-sh/python-build-standalone/releases`,
            ),
          );
        });
      })
      .on('error', reject);
  });
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

async function downloadPython(platform, force = false) {
  const outputPath = getOutputPath(platform);

  if (fs.existsSync(outputPath) && !force) {
    console.log(`Already exists: ${outputPath}`);
    console.log('Use --force to re-download.');
    return;
  }

  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  console.log(`Querying GitHub for latest python-build-standalone release (Python ${PYTHON_MINOR}.x)...`);
  const { tag, pythonVersion, downloadUrl } = await fetchLatestRelease(platform);
  console.log(`Found: Python ${pythonVersion} in release ${tag}`);

  await downloadFile(downloadUrl, outputPath);
  console.log(`Saved to: ${outputPath}`);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');

  let platforms = [];
  for (const arg of args) {
    if (arg === '--force' || arg === '-f') continue;
    if (arg === '--all') {
      platforms = Object.keys(PLATFORMS);
    } else if (PLATFORMS[arg]) {
      platforms.push(arg);
    }
  }

  if (platforms.length === 0) {
    const current = `${process.platform}-${process.arch}`;
    if (PLATFORMS[current]) {
      platforms = [current];
    } else {
      console.error(`Unsupported platform: ${current}`);
      console.error('Available platforms:', Object.keys(PLATFORMS).join(', '));
      process.exit(1);
    }
  }

  console.log(`Python minor: ${PYTHON_MINOR}.x (latest patch will be resolved from releases)`);
  console.log(`Platforms: ${platforms.join(', ')}`);
  console.log('');

  for (const platform of platforms) {
    console.log(`\n[${platform}]`);
    try {
      await downloadPython(platform, force);
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
