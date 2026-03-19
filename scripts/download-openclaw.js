/**
 * Downloads openclaw as a tgz into resources/
 * so it can be bundled as an extraResource in the packaged Electron app.
 *
 * Builds dist/ at pack time if missing (npm packaging bug #49338).
 * The output tgz is ready for end users — no runtime build needed.
 *
 * Usage: node scripts/download-openclaw.js [--force] [--version=X]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const OUTPUT = path.join(RESOURCES_DIR, 'openclaw.tgz');
const FORCE = process.argv.includes('--force');
const versionArg = process.argv.find((a) => a.startsWith('--version='));
const VERSION_PIN = versionArg ? versionArg.split('=')[1] : null;

if (fs.existsSync(OUTPUT) && !FORCE) {
  console.log(`[openclaw] Already exists: ${OUTPUT}  (use --force to re-download)`);
  process.exit(0);
}

fs.mkdirSync(RESOURCES_DIR, { recursive: true });

const KNOWN_GOOD_VERSION = '2026.3.11';
let version;
if (VERSION_PIN === 'latest') {
  const info = JSON.parse(execSync('npm show openclaw --json --registry=https://registry.npmjs.org').toString());
  version = info.version;
  console.log(`[openclaw] Downloading openclaw@${version} (latest)...`);
} else if (VERSION_PIN) {
  version = VERSION_PIN;
  console.log(`[openclaw] Using version: ${version}`);
} else {
  version = KNOWN_GOOD_VERSION;
  console.log(`[openclaw] Using known-good version: ${version} (2026.3.13 has dist/ bug)`);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-'));
try {
  execSync(`npm pack openclaw@${version} --registry=https://registry.npmjs.org`, { cwd: tmpDir, stdio: 'inherit' });
  const files = fs.readdirSync(tmpDir);
  const tgz = files.find((f) => f.endsWith('.tgz'));
  if (!tgz) throw new Error('npm pack did not produce a .tgz file');

  const extractDir = path.join(tmpDir, 'extract');
  fs.mkdirSync(extractDir, { recursive: true });

  const tgzPath = path.join(tmpDir, tgz);
  if (process.platform === 'win32') {
    // On Windows, use system tar with full paths to avoid "Cannot open: No such file or directory".
    // Use forward slashes for Git Bash compatibility (CI runs with shell: bash).
    const toTarPath = (p) => path.resolve(p).replace(/\\/g, '/');
    execSync(`tar -xzf "${toTarPath(tgzPath)}" -C "${toTarPath(extractDir)}"`, {
      stdio: 'inherit',
      shell: true,
    });
  } else {
    execSync(`tar -xzf "${tgzPath}" -C "${extractDir}"`, { stdio: 'inherit' });
  }

  const pkgDir = path.join(extractDir, 'package');
  const distEntry = path.join(pkgDir, 'dist', 'entry.mjs');
  const distEntryJs = path.join(pkgDir, 'dist', 'entry.js');
  const hasDist = fs.existsSync(distEntry) || fs.existsSync(distEntryJs);

  // Always run npm install — dist/ imports chalk etc., npm pack excludes node_modules.
  // Use npm only (not pnpm) for flat node_modules — pnpm symlinks can cause extraction/runtime issues.
  console.log('[openclaw] Installing dependencies (npm, flat structure)...');
  try {
    execSync('npm install --omit=dev --registry=https://registry.npmjs.org', {
      cwd: pkgDir,
      stdio: 'inherit',
      timeout: 120_000,
    });
  } catch (err) {
    console.error('[openclaw] npm install failed, trying pnpm...', err?.message);
    try {
      execSync('pnpm install --prod --registry=https://registry.npmjs.org', {
        cwd: pkgDir,
        stdio: 'inherit',
        timeout: 120_000,
      });
    } catch (pnpmErr) {
      throw new Error('npm and pnpm install failed');
    }
  }

  if (!hasDist) {
    console.log('[openclaw] dist/ missing, building at pack time...');
    const tryBuild = (installCmd, buildCmd) => {
      execSync(installCmd, { cwd: pkgDir, stdio: 'inherit', timeout: 120_000 });
      execSync(buildCmd, { cwd: pkgDir, stdio: 'inherit', timeout: 180_000 });
    };
    try {
      tryBuild('npm install', 'npm run build');
    } catch {
      tryBuild('pnpm install', 'pnpm build');
    }
    if (!fs.existsSync(distEntry) && !fs.existsSync(distEntryJs)) {
      throw new Error('Build completed but dist/entry.(m)js still missing');
    }
    console.log('[openclaw] Build completed');
  }

  if (process.platform === 'win32') {
    const toTarPath = (p) => path.resolve(p).replace(/\\/g, '/');
    execSync(`tar -czf "${toTarPath(OUTPUT)}" -C "${toTarPath(extractDir)}" package`, {
      stdio: 'inherit',
      shell: true,
    });
  } else {
    execSync(`tar -czf "${OUTPUT}" -C "${extractDir}" package`, { stdio: 'inherit' });
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`[openclaw] Saved to ${OUTPUT}`);