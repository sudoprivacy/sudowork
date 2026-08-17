#!/usr/bin/env node
/**
 * Download a static FFmpeg build and bundle it with the app.
 * Run during the build: `bun run ffmpeg:download` (wired into build:win/mac/linux).
 *
 * Produces `resources/ffmpeg-<platform>-<arch>.tar.gz` containing the flat
 * `ffmpeg`(.exe) [+ `ffprobe`(.exe)] binaries at the archive root, which
 * FfmpegRuntimeService extracts to `<userData>/ffmpeg/` at runtime.
 *
 * By default it fetches the current build platform (matching how build:win /
 * build:mac / build:linux each run on their own OS). Pass a `<os>-<arch>` key
 * (e.g. `win32-x64`) to fetch a specific one.
 *
 * Uses GPL static builds (libx264 + libass) so subtitle burning
 * (`ffmpeg -vf subtitles=...`) works.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const tar = require('tar');
const yauzl = require('yauzl');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');

// BtbN provides consistent cross-platform GPL static builds; macOS is not built
// by BtbN and needs a separate source (evermeet / osxexperts) — TODO before we
// ship macOS. Pin `FFMPEG_BUILD` to a dated `autobuild-*` tag for reproducible
// builds; `latest` is fine for local dev/testing.
const FFMPEG_BUILD = process.env.FFMPEG_BUILD || 'latest';
const BTBN = (name) => `https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_BUILD}/${name}`;

const PLATFORMS = {
  'win32-x64': { url: BTBN('ffmpeg-master-latest-win64-gpl.zip'), archive: 'zip', exe: '.exe' },
  'win32-arm64': { url: BTBN('ffmpeg-master-latest-winarm64-gpl.zip'), archive: 'zip', exe: '.exe' },
  'linux-x64': { url: BTBN('ffmpeg-master-latest-linux64-gpl.tar.xz'), archive: 'tar.xz', exe: '' },
  'linux-arm64': { url: BTBN('ffmpeg-master-latest-linuxarm64-gpl.tar.xz'), archive: 'tar.xz', exe: '' },
  // 'darwin-x64' / 'darwin-arm64': BtbN has no macOS build — configure evermeet/osxexperts before shipping mac.
};

function currentKey() {
  return `${process.platform}-${process.arch}`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`[ffmpeg:download] GET ${url}`);
    const file = fs.createWriteStream(dest);
    let redirects = 0;
    const go = (u) => {
      if (redirects++ > 10) return reject(new Error('too many redirects'));
      https
        .get(u, { headers: { 'User-Agent': 'sudowork-build' } }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
            res.resume();
            return go(res.headers.location);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          }
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
        })
        .on('error', (err) => {
          fs.unlink(dest, () => reject(err));
        });
    };
    go(url);
  });
}

/** Extract a .zip and return the temp dir it was extracted into. */
function unzip(zipPath, outDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.readEntry();
      zip.on('entry', (entry) => {
        const target = path.join(outDir, entry.fileName);
        if (/\/$/.test(entry.fileName)) {
          fs.mkdirSync(target, { recursive: true });
          return zip.readEntry();
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        zip.openReadStream(entry, (e, rs) => {
          if (e) return reject(e);
          const ws = fs.createWriteStream(target);
          rs.pipe(ws);
          ws.on('finish', () => zip.readEntry());
          ws.on('error', reject);
        });
      });
      zip.on('end', () => resolve(outDir));
      zip.on('error', reject);
    });
  });
}

/** Recursively find a file named `ffmpeg`/`ffmpeg.exe` etc. under `dir`. */
function findBinary(dir, name) {
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      const found = findBinary(full, name);
      if (found) return found;
    } else if (item === name) {
      return full;
    }
  }
  return null;
}

async function main() {
  const explicitKey = process.argv.find((a) => /^[a-z0-9]+-[a-z0-9]+$/i.test(a));
  const key = explicitKey || currentKey();
  const cfg = PLATFORMS[key];
  if (!cfg) {
    // No source for this platform (e.g. macOS — pending evermeet/osxexperts).
    // Skip rather than fail the build; the app ships without bundled ffmpeg on
    // this platform until a source is configured.
    console.warn(`[ffmpeg:download] no FFmpeg source configured for '${key}' — skipping (configured: ${Object.keys(PLATFORMS).join(', ')})`);
    return;
  }

  fs.mkdirSync(RESOURCES_DIR, { recursive: true });
  const outResource = path.join(RESOURCES_DIR, `ffmpeg-${key}.tar.gz`);
  if (fs.existsSync(outResource) && !process.argv.includes('--force')) {
    console.log(`[ffmpeg:download] ${path.basename(outResource)} already exists (use --force to refetch)`);
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-dl-'));
  try {
    const archivePath = path.join(tmp, `src.${cfg.archive === 'zip' ? 'zip' : 'tar.xz'}`);
    await download(cfg.url, archivePath);

    const extractDir = path.join(tmp, 'extract');
    fs.mkdirSync(extractDir, { recursive: true });
    if (cfg.archive === 'zip') {
      await unzip(archivePath, extractDir);
    } else {
      // .tar.xz — rely on the build machine's `tar` (xz-capable on linux/mac).
      execFileSync('tar', ['-xf', archivePath, '-C', extractDir], { stdio: 'inherit' });
    }

    const flatDir = path.join(tmp, 'flat');
    fs.mkdirSync(flatDir, { recursive: true });
    const wanted = [`ffmpeg${cfg.exe}`, `ffprobe${cfg.exe}`];
    for (const name of wanted) {
      const found = findBinary(extractDir, name);
      if (!found) {
        if (name.startsWith('ffmpeg')) throw new Error(`ffmpeg binary not found in ${cfg.url}`);
        console.warn(`[ffmpeg:download] optional ${name} not found — skipping`);
        continue;
      }
      const dst = path.join(flatDir, name);
      fs.copyFileSync(found, dst);
      if (!name.endsWith('.exe')) fs.chmodSync(dst, 0o755);
    }

    await tar.create({ gzip: true, file: outResource, cwd: flatDir, portable: true }, fs.readdirSync(flatDir));
    console.log(`[ffmpeg:download] wrote ${outResource} (${(fs.statSync(outResource).size / 1e6).toFixed(1)} MB)`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('[ffmpeg:download] failed:', err.message);
  process.exit(1);
});
