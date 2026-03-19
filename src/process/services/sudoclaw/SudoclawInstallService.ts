/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sudoclaw Install Service
 *
 * Built-in OpenClaw installation for Sudowork. Installs to ~/.sudoclaw (separate
 * from official ~/.openclaw) so users get a one-click experience without system
 * Node.js. Runs entirely via Electron (ELECTRON_RUN_AS_NODE).
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as tar from 'tar';
import { syncElectronPath } from '../claudeCli/CliInstallService';

/** Sudoclaw root: ~/.sudoclaw (macOS/Linux) or %USERPROFILE%\.sudoclaw (Windows) */
export const SUDOCLAW_DIR = path.join(os.homedir(), '.sudoclaw');

/** Default gateway port for Sudoclaw (18799) — avoids conflict with system OpenClaw (18789) */
export const SUDOCLAW_DEFAULT_PORT = 18799;

const SUDOCLAW_CLI_DIR = path.join(SUDOCLAW_DIR, 'cli');
const SUDOCLAW_BIN_DIR = path.join(SUDOCLAW_DIR, 'bin');
const SUDOCLAW_WORKSPACE_DIR = path.join(SUDOCLAW_DIR, 'workspace');
const CONFIG_FILENAME = 'openclaw.json';
const TGZ_RESOURCE = 'openclaw.tgz';

function resolveTgzPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, TGZ_RESOURCE);
  }
  return path.join(app.getAppPath(), 'resources', TGZ_RESOURCE);
}

function hasTgzResource(): boolean {
  return fs.existsSync(resolveTgzPath());
}

/** Check if dist/entry.mjs exists. The bundled openclaw.tgz is pre-built at pack time. */
function hasDistEntry(pkgRoot: string): boolean {
  const entryMjs = path.join(pkgRoot, 'dist', 'entry.mjs');
  const entryJs = path.join(pkgRoot, 'dist', 'entry.js');
  return fs.existsSync(entryMjs) || fs.existsSync(entryJs);
}

/** Check if node_modules exists (dist/ imports chalk etc.). Old tgz lacked node_modules. */
function hasNodeModules(pkgRoot: string): boolean {
  const nm = path.join(pkgRoot, 'node_modules');
  if (!fs.existsSync(nm) || !fs.statSync(nm).isDirectory()) return false;
  const chalk = path.join(nm, 'chalk');
  return fs.existsSync(chalk);
}

/** Resolve OpenClaw package root after npm pack extract (package/ at top level) */
function resolvePackageRoot(): string | null {
  const packageDir = path.join(SUDOCLAW_CLI_DIR, 'package');
  const pkgJson = path.join(packageDir, 'package.json');
  if (fs.existsSync(pkgJson)) return packageDir;
  // Fallback: maybe extracted flat
  const flatPkg = path.join(SUDOCLAW_CLI_DIR, 'package.json');
  if (fs.existsSync(flatPkg)) return SUDOCLAW_CLI_DIR;
  return null;
}

function resolveEntryFile(): string | null {
  const pkgRoot = resolvePackageRoot();
  if (!pkgRoot) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf-8'));
    const bin = pkg.bin;
    if (!bin) return null;
    const entry = typeof bin === 'string' ? bin : (Object.values(bin)[0] as string);
    return path.join(pkgRoot, entry);
  } catch {
    return null;
  }
}

/** Launcher script: fixes argv for Commander when run via Electron (no local Node required) */
const LAUNCHER_CONTENT = `#!/usr/bin/env node
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
try {
  const { app } = require('electron');
  const hideFromDock = () => {
    if (process.platform === 'darwin' && typeof app?.setActivationPolicy === 'function') {
      app.setActivationPolicy('accessory');
    }
    if (app?.dock) {
      try { app.dock.hide(); } catch {}
    }
  };
  hideFromDock();
  app.once('will-finish-launching', hideFromDock);
  if (!app.isReady()) app.once('ready', hideFromDock);
} catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openclawPath = path.join(__dirname, 'openclaw.mjs');
let userArgs = process.argv.slice(2);
const isElectronOrNodePath = (s) => typeof s === 'string' && (s.includes('Electron') || s.includes('electron') || /node(\\.exe)?$/i.test(path.basename(s)));
while (userArgs.length > 0 && isElectronOrNodePath(userArgs[0])) userArgs = userArgs.slice(1);
process.argv = ['node', openclawPath, ...userArgs];
if (process.versions.electron) delete process.versions.electron;
await import('./openclaw.mjs');
`;

function writeLauncher(pkgRoot: string): string {
  const launcherPath = path.join(pkgRoot, 'launcher.mjs');
  fs.writeFileSync(launcherPath, LAUNCHER_CONTENT, 'utf-8');
  return launcherPath;
}

function createUnixWrapper(launcherFile: string): void {
  const wrapperPath = path.join(SUDOCLAW_BIN_DIR, 'openclaw');
  const content =
    [
      '#!/bin/sh',
      '# openclaw wrapper — managed by Sudowork (Sudoclaw), Electron-only (no local Node required)',
      `CLI="${launcherFile}"`,
      `STATE_DIR="${SUDOCLAW_DIR}"`,
      'ELECTRON_PATH_FILE="$HOME/.nexus/electron-path"',
      '',
      'run_electron() {',
      '  exec env ELECTRON_RUN_AS_NODE=1 OPENCLAW_STATE_DIR="$STATE_DIR" "$1" "$CLI" "$@"',
      '}',
      '',
      'if [ -f "$ELECTRON_PATH_FILE" ]; then',
      '  ELECTRON=$(cat "$ELECTRON_PATH_FILE")',
      '  if [ -x "$ELECTRON" ]; then run_electron "$ELECTRON" "$@"; exit $?; fi',
      'fi',
      '',
      'if command -v mdfind >/dev/null 2>&1; then',
      '  APP=$(mdfind "kMDItemCFBundleIdentifier == \'com.sudowork.app\'" 2>/dev/null | head -1)',
      '  if [ -n "$APP" ]; then',
      '    ELECTRON="$APP/Contents/MacOS/Sudowork"',
      '    if [ -x "$ELECTRON" ]; then run_electron "$ELECTRON" "$@"; exit $?; fi',
      '  fi',
      'fi',
      '',
      'if command -v sudowork >/dev/null 2>&1; then',
      '  run_electron "$(command -v sudowork)" "$@"; exit $?',
      'fi',
      '',
      'echo "Error: Sudowork not found. Please launch Sudowork first." >&2',
      'exit 1',
    ].join('\n') + '\n';
  fs.writeFileSync(wrapperPath, content, { mode: 0o755 });
}

function createWindowsWrapper(launcherFile: string): void {
  const wrapperPath = path.join(SUDOCLAW_BIN_DIR, 'openclaw.cmd');
  const content = ['@echo off', 'setlocal enabledelayedexpansion', `set "CLI=${launcherFile}"`, `set "OPENCLAW_STATE_DIR=${SUDOCLAW_DIR}"`, 'set "ELECTRON_PATH_FILE=%USERPROFILE%\\.nexus\\electron-path"', 'set "ELECTRON="', '', 'if exist "%ELECTRON_PATH_FILE%" (', '  set /p ELECTRON=<"%ELECTRON_PATH_FILE%"', ')', 'if defined ELECTRON (', '  if exist "!ELECTRON!" (', '    set ELECTRON_RUN_AS_NODE=1', '    "!ELECTRON!" "!CLI!" %*', '    exit /b %ERRORLEVEL%', '  )', ')', '', 'echo Error: Sudowork not found. Please launch Sudowork first.', 'exit /b 1'].join('\r\n') + '\r\n';
  fs.writeFileSync(wrapperPath, content);
}

/** Repair openclaw.json schema — add models array to providers, remove unrecognized keys */
function repairOpenClawConfig(): void {
  const configPath = path.join(SUDOCLAW_DIR, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) return;
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    let changed = false;
    const providers = config.models as { providers?: Record<string, { models?: unknown }> } | undefined;
    if (providers?.providers) {
      for (const [key, prov] of Object.entries(providers.providers)) {
        if (prov && typeof prov === 'object' && !Array.isArray(prov.models)) {
          (prov as { models: string[] }).models = [];
          changed = true;
        }
      }
    }
    if ('lastRunMode' in config) {
      delete config.lastRunMode;
      changed = true;
    }
    const gw = config.gateway as { mode?: string; port?: number } | undefined;
    if (gw && typeof gw === 'object' && !gw.mode) {
      (gw as { mode: string }).mode = 'local';
      changed = true;
    }
    if (gw && typeof gw === 'object' && gw.port === 18789) {
      gw.port = SUDOCLAW_DEFAULT_PORT;
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      console.log('[Sudoclaw] Repaired openclaw.json schema');
    }
  } catch {
    // ignore parse errors
  }
}

function ensureDefaultConfig(): void {
  const configPath = path.join(SUDOCLAW_DIR, CONFIG_FILENAME);
  if (fs.existsSync(configPath)) return;

  const defaultConfig = {
    agents: {
      defaults: {
        workspace: SUDOCLAW_WORKSPACE_DIR,
        model: { primary: 'anthropic/claude-sonnet-4-5', fallbacks: [] as string[] },
        models: {},
      },
      list: [{ id: 'main', identity: { name: 'OpenClaw', emoji: '🦞' } }],
    },
    gateway: { port: SUDOCLAW_DEFAULT_PORT, mode: 'local' as const, auth: { mode: 'none' as const } },
  };

  fs.mkdirSync(SUDOCLAW_DIR, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(configPath, 0o600);
    } catch {
      // ignore
    }
  }
}

/**
 * Ensure OpenClaw is installed in ~/.sudoclaw.
 * Called on app startup — runs silently, no user prompt.
 */
export async function ensureSudoclawInstalled(): Promise<{ installed: boolean; cliPath: string | null }> {
  repairOpenClawConfig();

  const binName = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
  const managedBin = path.join(SUDOCLAW_BIN_DIR, binName);
  const entryFile = resolveEntryFile();
  const pkgRoot = resolvePackageRoot();

  if (fs.existsSync(managedBin) && entryFile && fs.existsSync(entryFile) && pkgRoot && hasDistEntry(pkgRoot) && hasNodeModules(pkgRoot)) {
    syncElectronPath();
    const launcherPath = writeLauncher(pkgRoot);
    if (process.platform === 'win32') {
      createWindowsWrapper(launcherPath);
    } else {
      createUnixWrapper(launcherPath);
    }
    return { installed: true, cliPath: managedBin };
  }

  if (!hasTgzResource()) {
    console.log('[Sudoclaw] openclaw.tgz not found, skipping built-in install');
    return { installed: false, cliPath: null };
  }

  try {
    fs.mkdirSync(SUDOCLAW_CLI_DIR, { recursive: true });
    fs.mkdirSync(SUDOCLAW_BIN_DIR, { recursive: true });
    syncElectronPath();

    // Re-extract if existing install lacks node_modules (old tgz format)
    const existingPkg = resolvePackageRoot();
    if (existingPkg && hasDistEntry(existingPkg) && !hasNodeModules(existingPkg)) {
      console.log('[Sudoclaw] Re-extracting (missing node_modules)...');
      fs.rmSync(SUDOCLAW_CLI_DIR, { recursive: true, force: true });
      fs.mkdirSync(SUDOCLAW_CLI_DIR, { recursive: true });
    }

    const tgzPath = resolveTgzPath();
    await tar.x({ file: tgzPath, cwd: SUDOCLAW_CLI_DIR });

    const pkgRoot = resolvePackageRoot();
    if (!pkgRoot || !hasDistEntry(pkgRoot)) {
      throw new Error('openclaw.tgz missing dist/. Run: bun run openclaw:download:force');
    }
    if (!hasNodeModules(pkgRoot)) {
      throw new Error('openclaw.tgz missing node_modules. Run: bun run openclaw:download:force');
    }

    const resolvedEntry = resolveEntryFile();
    if (!resolvedEntry) {
      throw new Error('Cannot determine OpenClaw CLI entry file');
    }

    const launcherPath = writeLauncher(pkgRoot);
    if (process.platform === 'win32') {
      createWindowsWrapper(launcherPath);
    } else {
      createUnixWrapper(launcherPath);
    }

    ensureDefaultConfig();
    fs.mkdirSync(SUDOCLAW_WORKSPACE_DIR, { recursive: true });

    console.log('[Sudoclaw] OpenClaw installed to', SUDOCLAW_DIR);
    return { installed: true, cliPath: managedBin };
  } catch (err) {
    console.error('[Sudoclaw] Install failed:', err);
    return { installed: false, cliPath: null };
  }
}

/** Get the Sudoclaw CLI path if installed (dist/ and node_modules exist) */
export function getSudoclawCliPath(): string | null {
  const binName = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
  const managedBin = path.join(SUDOCLAW_BIN_DIR, binName);
  const entryFile = resolveEntryFile();
  const pkgRoot = resolvePackageRoot();
  if (fs.existsSync(managedBin) && entryFile && fs.existsSync(entryFile) && pkgRoot && hasDistEntry(pkgRoot) && hasNodeModules(pkgRoot)) {
    return managedBin;
  }
  return null;
}

/** Sudoclaw CLI path — always use this (no system openclaw). Returns path even when not installed. */
export function getSudoclawCliPathAlways(): string {
  const binName = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
  return path.join(SUDOCLAW_BIN_DIR, binName);
}
