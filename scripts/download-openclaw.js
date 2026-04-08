/**
 * Downloads openclaw as a tgz into resources/
 * so it can be bundled as an extraResource in the packaged Electron app.
 *
 * Builds dist/ at pack time if missing (npm packaging bug #49338).
 * The output tgz is ready for end users — no runtime build needed.
 *
 * Usage: node scripts/download-openclaw.js [--force] [--version=X] [--skip-bundle]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tar = require('tar');
const runtimeVersions = require('../src/shared/runtime-versions.json');
const { updateLocalDevRuntimeVersion, clearLocalDevRuntimeVersion } = require('./dev-runtime-state');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const OUTPUT = path.join(RESOURCES_DIR, 'openclaw.tgz');
const OUTPUT_MANIFEST = path.join(RESOURCES_DIR, 'openclaw.manifest.json');
const FORCE = process.argv.includes('--force');
const SKIP_BUNDLE = process.argv.includes('--skip-bundle');
const KNOWN_GOOD_VERSION = runtimeVersions.sudoclaw;
const NPM_REGISTRY = process.env.NPM_CONFIG_REGISTRY || process.env.npm_config_registry || 'https://registry.npmjs.org/';

fs.mkdirSync(RESOURCES_DIR, { recursive: true });

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.warn(`[openclaw][diag] Failed to parse JSON ${filePath}: ${error.message}`);
    return null;
  }
}

function logFileSummary(label, filePath, options = {}) {
  const {
    maxChars = 1200,
    patterns = [],
  } = options;

  if (!fs.existsSync(filePath)) {
    console.log(`[openclaw][diag] ${label}: missing (${filePath})`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const preview = content.slice(0, maxChars);
  console.log(`[openclaw][diag] ${label}: ${filePath}`);
  console.log(`[openclaw][diag] ${label} preview (${Math.min(content.length, maxChars)}/${content.length} chars):`);
  console.log(preview);

  for (const pattern of patterns) {
    const index = content.indexOf(pattern);
    if (index === -1) {
      console.log(`[openclaw][diag] ${label} pattern not found: ${pattern}`);
      continue;
    }
    const start = Math.max(0, index - 240);
    const end = Math.min(content.length, index + pattern.length + 480);
    console.log(`[openclaw][diag] ${label} pattern match for "${pattern}" at offset ${index}:`);
    console.log(content.slice(start, end));
  }
}

function logPackageVersion(label, pkgDir, packageName) {
  const pkgJsonPath = path.join(pkgDir, 'node_modules', ...packageName.split('/'), 'package.json');
  const pkgJson = readJsonIfExists(pkgJsonPath);
  if (!pkgJson) {
    console.log(`[openclaw][diag] ${label}: ${packageName} not installed`);
    return;
  }

  console.log(
    `[openclaw][diag] ${label}: ${packageName}@${pkgJson.version} (${pkgJson.type || 'type=unspecified'})`,
  );
}

function logCommandOutput(label, command, cwd) {
  try {
    const output = execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    console.log(`[openclaw][diag] ${label}:`);
    console.log(output || '(empty)');
  } catch (error) {
    console.warn(`[openclaw][diag] ${label} failed: ${error.message}`);
    if (typeof error.stdout === 'string' && error.stdout.trim()) {
      console.warn(`[openclaw][diag] ${label} stdout:`);
      console.warn(error.stdout.trim());
    }
    if (typeof error.stderr === 'string' && error.stderr.trim()) {
      console.warn(`[openclaw][diag] ${label} stderr:`);
      console.warn(error.stderr.trim());
    }
  }
}

function logOpenClawDiagnostics(stage, pkgDir, entryPoint, outputFile) {
  console.log(`[openclaw][diag] ===== ${stage} =====`);
  console.log(
    `[openclaw][diag] env node=${process.version} npm_config_platform=${process.env.npm_config_platform || '(unset)'} npm_config_arch=${process.env.npm_config_arch || '(unset)'} platform=${process.platform} arch=${process.arch}`,
  );

  const openclawPkg = readJsonIfExists(path.join(pkgDir, 'package.json'));
  if (openclawPkg) {
    console.log(
      `[openclaw][diag] openclaw package version=${openclawPkg.version} type=${openclawPkg.type || 'type=unspecified'}`,
    );
    console.log(
      `[openclaw][diag] declared deps: @whiskeysockets/baileys=${openclawPkg.dependencies?.['@whiskeysockets/baileys'] || '(missing)'} protobufjs=${openclawPkg.dependencies?.protobufjs || '(missing)'} libsignal=${openclawPkg.dependencies?.libsignal || '(missing)'}`,
    );
  }

  logCommandOutput('npm version', 'npm --version', pkgDir);
  logPackageVersion(stage, pkgDir, '@whiskeysockets/baileys');
  logPackageVersion(stage, pkgDir, 'libsignal');
  logPackageVersion(stage, pkgDir, 'protobufjs');
  logPackageVersion(stage, pkgDir, '@bufbuild/protobuf');
  logCommandOutput(
    'npm ls @whiskeysockets/baileys protobufjs libsignal @bufbuild/protobuf',
    'npm ls @whiskeysockets/baileys protobufjs libsignal @bufbuild/protobuf --depth=3',
    pkgDir,
  );

  logFileSummary('entry source', entryPoint, {
    maxChars: 1600,
    patterns: ['await init_Defaults', 'init_Defaults', 'Promise.resolve().then(() => (init_'],
  });

  logFileSummary('baileys Defaults', path.join(pkgDir, 'node_modules', '@whiskeysockets', 'baileys', 'lib', 'Defaults', 'index.js'), {
    maxChars: 1600,
    patterns: ['await ', 'top-level', 'export const', 'export {', 'from '],
  });

  logFileSummary('bundle output', outputFile, {
    maxChars: 1600,
    patterns: ['await init_Defaults', 'init_Defaults', 'var init_Defaults = __esm'],
  });
}

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

let version = KNOWN_GOOD_VERSION;

if (fs.existsSync(OUTPUT) && !FORCE) {
  const archivedVersion = getVersionFromArchive(OUTPUT);
  if (archivedVersion) {
    updateLocalDevRuntimeVersion('openclaw', archivedVersion);
  } else {
    clearLocalDevRuntimeVersion('openclaw');
  }

  if (!fs.existsSync(OUTPUT_MANIFEST)) {
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
  execSync(`npm pack openclaw@${version} --registry=${NPM_REGISTRY}`, { cwd: tmpDir, stdio: 'inherit' });
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
  const npmTimeout = 1_200_000;
  console.log(`[openclaw] Installing dependencies (npm, flat structure, registry: ${NPM_REGISTRY}, timeout: ${npmTimeout / 1000}s)...`);
  try {
    execSync(`npm install --omit=dev --legacy-peer-deps --registry=${NPM_REGISTRY}`, {
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
      tryBuild(`npm install --legacy-peer-deps --registry=${NPM_REGISTRY}`, 'npm run build');
    } catch {
      tryBuild('pnpm install', 'pnpm build');
    }
    if (!fs.existsSync(distEntry) && !fs.existsSync(distEntryJs)) {
      throw new Error('Build completed but dist/entry.(m)js still missing');
    }
    console.log('[openclaw] Build completed');
  }

  const entryPoint = fs.existsSync(distEntry) ? distEntry : distEntryJs;
  const bundleOutput = path.join(pkgDir, 'openclaw.mjs');
  logOpenClawDiagnostics('post-install pre-bundle', pkgDir, entryPoint, bundleOutput);

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

  // Bundle openclaw runtime with esbuild (reduces thousands of files to one)
  if (!SKIP_BUNDLE) {
    console.log('[openclaw] Bundling openclaw runtime with esbuild...');
    const bundleScript = path.join(__dirname, 'bundle-openclaw.js');
    try {
      execSync(`node "${bundleScript}" "${pkgDir}"`, {
        stdio: 'inherit',
        timeout: 300_000, // 5 minutes
      });
      console.log('[openclaw] Bundle completed successfully.');
      logOpenClawDiagnostics('post-bundle', pkgDir, entryPoint, bundleOutput);
    } catch (err) {
      console.warn(`[openclaw] Bundle failed (falling back to unbundled): ${err?.message}`);
      logOpenClawDiagnostics('bundle-failed fallback', pkgDir, entryPoint, bundleOutput);
      console.warn('[openclaw] The package will work but with more files than optimal.');
    }
  } else {
    console.log('[openclaw] Skipping bundle (--skip-bundle flag).');
  }

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

  updateLocalDevRuntimeVersion('openclaw', version);

} finally {
  if (!fs.existsSync(OUTPUT)) {
    clearLocalDevRuntimeVersion('openclaw');
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`[openclaw] Saved to ${OUTPUT}`);
