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
const tar = require('tar');
const runtimeVersions = require('../src/shared/runtime-versions.json');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const OUTPUT = path.join(RESOURCES_DIR, 'openclaw.tgz');
const OUTPUT_MANIFEST = path.join(RESOURCES_DIR, 'openclaw.manifest.json');
const FORCE = process.argv.includes('--force');
const versionArg = process.argv.find((a) => a.startsWith('--version='));
const VERSION_PIN = versionArg ? versionArg.split('=')[1] : null;
const KNOWN_GOOD_VERSION = runtimeVersions.sudoclaw;

fs.mkdirSync(RESOURCES_DIR, { recursive: true });

function getDaveyBindingDirName() {
  const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const suffix = platform === 'win32' ? 'msvc' : platform === 'linux' ? 'gnu' : '';
  return `davey-${platform}-${arch}${suffix ? `-${suffix}` : ''}`;
}

function writeOpenClawManifest(version) {
  const manifest = {
    version,
    platform: process.platform,
    arch: process.arch,
    daveyBinding: `@snazzah/${getDaveyBindingDirName()}`,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(`[openclaw] Wrote manifest to ${OUTPUT_MANIFEST}`);
}

function getVersionFromArchive(archivePath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-manifest-'));

  try {
    tar.x({
      file: archivePath,
      cwd: tmpDir,
      sync: true,
      filter: (entryPath) => entryPath === 'package/package.json',
    });

    const pkgJsonPath = path.join(tmpDir, 'package', 'package.json');
    if (!fs.existsSync(pkgJsonPath)) return null;

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    return typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : null;
  } catch (error) {
    console.warn(`[openclaw] Failed to read version from existing archive: ${error.message}`);
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

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

if (fs.existsSync(OUTPUT) && !FORCE) {
  if (!fs.existsSync(OUTPUT_MANIFEST)) {
    const archivedVersion = getVersionFromArchive(OUTPUT);
    if (archivedVersion) {
      writeOpenClawManifest(archivedVersion);
    } else {
      console.warn('[openclaw] Existing archive version is unknown, skipping manifest generation');
    }
  }
  console.log(`[openclaw] Already exists: ${OUTPUT}  (use --force to re-download)`);
  process.exit(0);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-'));
try {
  // Download with npm pack
  execSync(`npm pack openclaw@${version} --registry=https://registry.npmjs.org`, { cwd: tmpDir, stdio: 'inherit' });
  const files = fs.readdirSync(tmpDir);
  const tgz = files.find((f) => f.endsWith('.tgz'));
  if (!tgz) throw new Error('npm pack did not produce a .tgz file');

  const extractDir = path.join(tmpDir, 'extract');
  fs.mkdirSync(extractDir, { recursive: true });

  // Extract - run tar from extractDir with relative path to avoid Windows path issues
  console.log(`[openclaw] Extracting ${tgz}...`);
  if (process.platform === 'win32') {
    execSync(`tar -xzf ../${tgz}`, { cwd: extractDir, stdio: 'inherit', shell: true });
  } else {
    execSync(`tar -xzf ../${tgz}`, { cwd: extractDir, stdio: 'inherit' });
  }

  const pkgDir = path.join(extractDir, 'package');
  const distEntry = path.join(pkgDir, 'dist', 'entry.mjs');
  const distEntryJs = path.join(pkgDir, 'dist', 'entry.js');
  const hasDist = fs.existsSync(distEntry) || fs.existsSync(distEntryJs);

  // Install dependencies
  const npmTimeout = process.platform === 'win32' ? 600_000 : 120_000;
  console.log(`[openclaw] Installing dependencies (npm, flat structure, timeout: ${npmTimeout / 1000}s)...`);
  try {
    execSync('npm install --omit=dev --registry=https://registry.npmjs.org', {
      cwd: pkgDir,
      stdio: 'inherit',
      timeout: npmTimeout,
    });
  } catch (err) {
    console.error('[openclaw] npm install failed:', err?.message);
    throw new Error('npm install failed. Ensure npm is available and network is stable.');
  }

  // Build if dist/ missing
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

  // Create launcher.mjs - fixes argv for Commander when run via bundled Node.js
  console.log('[openclaw] Creating launcher.mjs...');
  const launcherContent = `#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openclawPath = path.join(__dirname, 'openclaw.mjs');
let userArgs = process.argv.slice(2);
// Strip leading executable paths so Commander receives correct subcommand
const isExecutablePath = (s) => typeof s === 'string' && (
  /node(\\.exe)?$/i.test(path.basename(s)) || /Sudowork(\\.exe)?$/i.test(path.basename(s))
);
while (userArgs.length > 0 && isExecutablePath(userArgs[0])) userArgs = userArgs.slice(1);
process.argv = ['node', openclawPath, ...userArgs];
await import('./openclaw.mjs');
`;
  fs.writeFileSync(path.join(pkgDir, 'launcher.mjs'), launcherContent, 'utf-8');

  // Create bin directory with wrappers
  console.log('[openclaw] Creating bin wrappers...');
  const binDir = path.join(pkgDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  // Unix wrapper (shell script)
  const unixWrapper = `#!/bin/sh
# openclaw wrapper — managed by Sudowork (Sudoclaw)
CLI="\$(dirname "\$0")/../launcher.mjs"
STATE_DIR="\${HOME}/.nexus/sudoclaw"
BUNDLED_NODE="\${HOME}/.nexus/node/bin/node"

if [ ! -x "\$BUNDLED_NODE" ]; then
  echo "Error: Bundled Node.js not found at \$BUNDLED_NODE" >&2
  echo "Please restart Sudowork to install it." >&2
  exit 1
fi

exec env OPENCLAW_STATE_DIR="\$STATE_DIR" OPENCLAW_CONFIG_PATH="\$STATE_DIR/sudoclaw.json" "\$BUNDLED_NODE" "\$CLI" "\$@"
`;
  fs.writeFileSync(path.join(binDir, 'openclaw'), unixWrapper, { mode: 0o755 });

  // Windows wrapper (batch file)
  const windowsWrapper = `@echo off
set "CLI=%~dp0..\\launcher.mjs"
set "OPENCLAW_STATE_DIR=%USERPROFILE%\\.nexus\\sudoclaw"
set "OPENCLAW_CONFIG_PATH=%USERPROFILE%\\.nexus\\sudoclaw\\sudoclaw.json"
set "BUNDLED_NODE=%USERPROFILE%\\.nexus\\node\\node.exe"

if not exist "%BUNDLED_NODE%" (
  echo Error: Bundled Node.js not found at %BUNDLED_NODE%
  echo Please restart Sudowork to install it.
  exit /b 1
)

"%BUNDLED_NODE%" "%CLI%" %*
`;
  fs.writeFileSync(path.join(binDir, 'openclaw.cmd'), windowsWrapper.replace(/\n/g, '\r\n'), 'utf-8');

  writeOpenClawManifest(version);

  // Create final tarball - run from extractDir to avoid path issues
  console.log('[openclaw] Creating final tarball...');
  if (process.platform === 'win32') {
    const tmpOutput = path.join(extractDir, 'openclaw.tgz');
    try {
      execSync(`tar -czf openclaw.tgz package`, { cwd: extractDir, stdio: 'inherit', shell: true });
    } catch (e) {
      if (!fs.existsSync(tmpOutput)) throw e;
    }
    fs.copyFileSync(tmpOutput, OUTPUT);
  } else {
    execSync(`tar -czf "${OUTPUT}" -C "${extractDir}" package`, { stdio: 'inherit' });
  }

} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`[openclaw] Saved to ${OUTPUT}`);
