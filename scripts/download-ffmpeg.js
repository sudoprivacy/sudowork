#!/usr/bin/env node
/**
 * Download a PINNED static FFmpeg build and bundle it with the app.
 * Run during the build: `bun run ffmpeg:download` (wired into build:win/mac/linux
 * and the reusable CI build). Pass a `<os>-<arch>` key (e.g. `win32-x64`) to
 * fetch a specific platform; defaults to the current build host.
 *
 * Produces `resources/ffmpeg-<platform>-<arch>.tar.gz` containing the flat
 * `ffmpeg`(.exe) [+ `ffprobe`(.exe)] binaries at the archive root, which
 * FfmpegRuntimeService extracts to `<userData>/ffmpeg/` at runtime.
 *
 * The exact build (tag, version, per-platform SHA256) is pinned in
 * `src/shared/ffmpeg-runtime.json` — the single source of truth. We download
 * from BtbN's IMMUTABLE dated `autobuild-*` release (not the rolling `latest`
 * tag) and verify the downloaded archive against the pinned SHA256 before
 * trusting it, so a build is reproducible and tamper-evident. BtbN's GPL builds
 * ship libx264 + libass, so subtitle burning (`ffmpeg -vf subtitles=...`) works.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const tar = require('tar');
const yauzl = require('yauzl');
const pinned = require('../src/shared/ffmpeg-runtime.json');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');

const { tag: FFMPEG_TAG, version: FFMPEG_VERSION, releaseSuffix: FFMPEG_RELEASE, platforms: PLATFORMS } = pinned;

/** Asset basename BtbN publishes under the pinned dated tag, e.g. `ffmpeg-n9.0.1-4-g...-win64-gpl-9.0.zip`. */
function assetName(cfg) {
  const ext = cfg.archive === 'zip' ? 'zip' : 'tar.xz';
  return `ffmpeg-${FFMPEG_VERSION}-${cfg.btbn}-gpl-${FFMPEG_RELEASE}.${ext}`;
}

function assetUrl(cfg) {
  return `https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_TAG}/${assetName(cfg)}`;
}

function currentKey() {
  return `${process.platform}-${process.arch}`;
}

function sha256OfFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
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
    // No source pinned for this platform (e.g. macOS — pending evermeet/osxexperts).
    // Skip rather than fail the build; the app ships without bundled ffmpeg on
    // this platform until a source is configured in ffmpeg-runtime.json.
    console.warn(`[ffmpeg:download] no pinned FFmpeg for '${key}' — skipping (pinned: ${Object.keys(PLATFORMS).join(', ')})`);
    return;
  }
  const exe = key.startsWith('win32') ? '.exe' : '';

  fs.mkdirSync(RESOURCES_DIR, { recursive: true });
  const outResource = path.join(RESOURCES_DIR, `ffmpeg-${key}.tar.gz`);
  if (fs.existsSync(outResource) && !process.argv.includes('--force')) {
    console.log(`[ffmpeg:download] ${path.basename(outResource)} already exists (use --force to refetch)`);
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-dl-'));
  try {
    const archivePath = path.join(tmp, `src.${cfg.archive === 'zip' ? 'zip' : 'tar.xz'}`);
    try {
      await download(assetUrl(cfg), archivePath);
    } catch (err) {
      if (/HTTP 404/.test(err.message)) {
        throw new Error(
          `${assetName(cfg)} is gone from BtbN tag ${FFMPEG_TAG} (old autobuilds get pruned). ` +
            `Re-pin src/shared/ffmpeg-runtime.json to a current autobuild-* tag + refresh its SHA256s.`,
        );
      }
      throw err;
    }

    // Integrity gate: the pinned SHA256 must match before we trust the bytes.
    const actualSha = sha256OfFile(archivePath);
    if (actualSha !== cfg.sha256) {
      throw new Error(`SHA256 mismatch for ${assetName(cfg)}: expected ${cfg.sha256}, got ${actualSha}`);
    }
    console.log(`[ffmpeg:download] SHA256 verified: ${actualSha}`);

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
    const wanted = [`ffmpeg${exe}`, `ffprobe${exe}`];
    for (const name of wanted) {
      const found = findBinary(extractDir, name);
      if (!found) {
        if (name.startsWith('ffmpeg')) throw new Error(`ffmpeg binary not found in ${assetName(cfg)}`);
        console.warn(`[ffmpeg:download] optional ${name} not found — skipping`);
        continue;
      }
      const dst = path.join(flatDir, name);
      fs.copyFileSync(found, dst);
      if (!name.endsWith('.exe')) fs.chmodSync(dst, 0o755);
    }

    // Max gzip level: static ffmpeg binaries barely compress, but it's a free
    // few MB off a ~114 MB archive and build CPU is not the bottleneck here.
    await tar.create({ gzip: { level: 9 }, file: outResource, cwd: flatDir, portable: true }, fs.readdirSync(flatDir));
    console.log(`[ffmpeg:download] wrote ${outResource} (${(fs.statSync(outResource).size / 1e6).toFixed(1)} MB)`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('[ffmpeg:download] failed:', err.message);
  process.exit(1);
});
