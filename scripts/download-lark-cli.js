#!/usr/bin/env node
/**
 * Download @larksuite/cli with its postinstall-fetched Go binary, then pack
 * the resulting node_modules into resources/lark-cli.tgz for runtime extraction.
 *
 * Strategy: `npm install` triggers lark-cli's own postinstall (scripts/install.js),
 * which downloads the host-platform binary into node_modules/@larksuite/cli/bin/.
 *
 * Implication: this script targets the HOST platform only. Cross-compile builds
 * (e.g. building Linux artifacts on a macOS runner) must run on native runners.
 * lark-cli's run.js has an auto-heal fallback that fetches the missing binary on
 * first invocation, so a wrong-platform tgz is recoverable but degrades UX.
 *
 * Usage:
 *   node scripts/download-lark-cli.js [--force] [--version <version>]
 *
 *   --force          Re-download even if tgz already exists
 *   --version        Specific version (default: latest)
 *
 * NOTE: Download failures are non-fatal (exit 0) so builds aren't blocked by a
 * transient registry outage; CliInstallService will surface the missing tgz at
 * runtime.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const NPM_PACKAGE = '@larksuite/cli';
const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const OUTPUT = path.join(RESOURCES_DIR, 'lark-cli.tgz');

const args = process.argv.slice(2);
const FORCE = args.includes('--force') || args.includes('-f');
const versionFlagIdx = args.indexOf('--version');
const VERSION_ARG = versionFlagIdx !== -1 ? args[versionFlagIdx + 1] : 'latest';

function resolveVersion(versionArg) {
  try {
    const info = JSON.parse(execSync(`npm show ${NPM_PACKAGE}@${versionArg} --json`, {
      encoding: 'utf8',
      timeout: 30000,
    }));
    return info.version;
  } catch (err) {
    console.log(`[lark-cli] Could not resolve version, falling back to: ${versionArg}`);
    return versionArg;
  }
}

async function downloadLarkCli() {
  if (fs.existsSync(OUTPUT) && !FORCE) {
    console.log(`[lark-cli] Already exists: ${OUTPUT} (use --force to re-download)`);
    return true;
  }

  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  const version = resolveVersion(VERSION_ARG);
  console.log(`[lark-cli] Version: ${version}`);
  console.log(`[lark-cli] Host: ${process.platform}-${process.arch} (this is what postinstall will fetch)`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lark-cli-build-'));

  try {
    // Dummy package.json so `npm install` writes into tmpDir/node_modules.
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'lark-cli-bundle',
      private: true,
    }));

    // npm install — postinstall (scripts/install.js) downloads the Go binary
    // for process.platform / process.arch into node_modules/@larksuite/cli/bin/.
    console.log(`[lark-cli] npm install ${NPM_PACKAGE}@${version}…`);
    execSync(`npm install ${NPM_PACKAGE}@${version} --no-save --no-audit --no-fund`, {
      cwd: tmpDir,
      stdio: 'inherit',
      timeout: 180000,
    });

    const pkgDir = path.join(tmpDir, 'node_modules', '@larksuite', 'cli');
    const binName = process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli';
    const binPath = path.join(pkgDir, 'bin', binName);
    if (!fs.existsSync(binPath)) {
      throw new Error(`Expected binary missing after postinstall: ${binPath}`);
    }

    // Tar just node_modules/ — drop the dummy root package.json so the tgz
    // layout matches what CliInstallService.resolveEntryFile expects.
    console.log(`[lark-cli] Creating tarball…`);
    if (process.platform === 'win32') {
      const tmpOutput = path.join(tmpDir, 'lark-cli.tgz');
      try {
        execSync(`tar -czf lark-cli.tgz node_modules`, { cwd: tmpDir, stdio: 'inherit', shell: true });
      } catch (e) {
        if (!fs.existsSync(tmpOutput)) throw e;
      }
      fs.copyFileSync(tmpOutput, OUTPUT);
    } else {
      execSync(`tar -czf "${OUTPUT}" -C "${tmpDir}" node_modules`, { stdio: 'inherit' });
    }

    const sizeMb = (fs.statSync(OUTPUT).size / (1024 * 1024)).toFixed(1);
    console.log(`[lark-cli] ✅ ${OUTPUT} (${sizeMb} MB)`);
    return true;
  } catch (err) {
    console.error(`[lark-cli] ❌ Failed: ${err.message}`);
    try {
      if (fs.existsSync(OUTPUT)) fs.unlinkSync(OUTPUT);
    } catch {}
    return false;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

async function main() {
  console.log(`[lark-cli] Output file: ${OUTPUT}`);
  const success = await downloadLarkCli();
  process.exit(success ? 0 : 0); // non-fatal
}

main().catch((err) => {
  console.error('[lark-cli] Error:', err.message);
  process.exit(0);
});
