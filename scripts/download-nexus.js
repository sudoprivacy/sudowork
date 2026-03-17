/**
 * Downloads the pre-built Nexus conda environment (nexus.tar.gz) into resources/
 * so it can be bundled as an extraResource in the packaged Electron app.
 *
 * Usage:
 *   node scripts/download-nexus.js [--platform <darwin|linux|win32>] [--arch <arm64|x64>] [--force]
 *
 * When --platform/--arch are omitted, the current process.platform / process.arch are used.
 * Use --force to re-download even if the file already exists.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// URL map: platform-arch → download URL
// Add / update entries here when new builds are available.
// ---------------------------------------------------------------------------
const NEXUS_URLS = {
  'darwin-arm64': 'https://github.com/sudoprivacy/sudorepo/releases/download/v0.0.1/mac-arm-nexus.tar.gz',
  'darwin-x64':   null, // TODO: fill in mac-x64 URL  (if available)
  'linux-x64':    null, // TODO: fill in linux-x64 URL (if available)
  'linux-arm64':  null, // TODO: fill in linux-arm64 URL (if available)
  // Windows uses PyInstaller binary, no conda env needed
};

// ---------------------------------------------------------------------------

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const OUTPUT = path.join(RESOURCES_DIR, 'nexus.tar.gz');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');

function argValue(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}

const platform = argValue('--platform') || process.platform;
const arch = argValue('--arch') || process.arch;
const key = `${platform}-${arch}`;
const url = NEXUS_URLS[key];

if (!url) {
  if (url === null) {
    console.log(`[nexus] No download URL configured for ${key} — writing placeholder.`);
    console.log(`[nexus] To enable Nexus for this platform, add the URL to NEXUS_URLS in scripts/download-nexus.js`);
  } else {
    console.log(`[nexus] Platform ${key} not recognised — writing placeholder.`);
  }
  // Write a placeholder so electron-builder can still find the file.
  // NexusService detects this at runtime and skips conda setup gracefully.
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT, 'NEXUS_PLACEHOLDER');
  process.exit(0);
}

if (fs.existsSync(OUTPUT) && !FORCE) {
  console.log(`[nexus] Already exists: ${OUTPUT}  (use --force to re-download)`);
  process.exit(0);
}

fs.mkdirSync(RESOURCES_DIR, { recursive: true });

/**
 * Download a URL to a file, following up to maxRedirects redirects.
 */
function download(url, dest, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) {
      return reject(new Error('Too many redirects'));
    }

    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        res.resume();
        return resolve(download(res.headers.location, dest, maxRedirects - 1));
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }

      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      let lastPct = -1;

      const file = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct && pct % 10 === 0) {
            process.stdout.write(`\r[nexus] Downloading... ${pct}%`);
            lastPct = pct;
          }
        }
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          process.stdout.write('\n');
          resolve();
        });
      });
      file.on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    });

    req.on('error', reject);
  });
}

console.log(`[nexus] Downloading nexus env for ${key}...`);
console.log(`[nexus] URL: ${url}`);

download(url, OUTPUT)
  .then(() => {
    const size = (fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1);
    console.log(`[nexus] Saved to ${OUTPUT} (${size} MB)`);
  })
  .catch((err) => {
    console.error(`[nexus] Download failed: ${err.message}`);
    if (fs.existsSync(OUTPUT)) fs.unlinkSync(OUTPUT);
    process.exit(1);
  });
