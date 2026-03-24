/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sudoclaw Install Service
 *
 * Built-in OpenClaw installation for Sudowork. Installs to ~/.nexus/.sudoclaw (separate
 * from official ~/.openclaw) so users get a one-click experience without system
 * Node.js. Uses bundled Node.js runtime to avoid macOS Dock bounce.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as tar from 'tar';
import { getNodeBinaryPath } from '../claudeCli/NodeRuntimeService';

/** Legacy path for migration from ~/.sudoclaw */
const LEGACY_SUDOCLAW_DIR = path.join(os.homedir(), '.sudoclaw');

/** Sudoclaw root: ~/.nexus/.sudoclaw (macOS/Linux) or %USERPROFILE%\.nexus\.sudoclaw (Windows) */
export const SUDOCLAW_DIR = path.join(os.homedir(), '.nexus', '.sudoclaw');

/** Default gateway port for Sudoclaw (17863) — avoids conflict with system OpenClaw (18789) */
export const SUDOCLAW_DEFAULT_PORT = 17863;

const SUDOCLAW_CLI_DIR = path.join(SUDOCLAW_DIR, 'cli');
export const SUDOCLAW_BIN_DIR = path.join(SUDOCLAW_DIR, 'bin');
const SUDOCLAW_WORKSPACE_DIR = path.join(SUDOCLAW_DIR, 'workspace');

/** Nexus skills dir (~/.nexus/config/skills) — loaded by OpenClaw via skills.load.extraDirs */
const NEXUS_SKILLS_DIR = path.join(os.homedir(), '.nexus', 'config', 'skills');
const CONFIG_FILENAME = 'openclaw.json';

/** Check if dist/entry.mjs exists. The bundled openclaw.tgz is pre-built at pack time. */
function hasDistEntry(pkgRoot: string): boolean {
  const entryMjs = path.join(pkgRoot, 'dist', 'entry.mjs');
  const entryJs = path.join(pkgRoot, 'dist', 'entry.js');
  return fs.existsSync(entryMjs) || fs.existsSync(entryJs);
}

/**
 * Check if node_modules exists with correct platform-specific bindings.
 * Checks for the @snazzah/davey binding for the current platform/arch.
 * Returns false if the correct binding is missing (triggers npm install).
 */
function hasNodeModules(pkgRoot: string): boolean {
  const nm = path.join(pkgRoot, 'node_modules');
  if (!fs.existsSync(nm) || !fs.statSync(nm).isDirectory()) return false;

  // Check for correct platform-specific @snazzah/davey binding
  const daveyBinding = getDaveyBindingName();
  const daveyPath = path.join(nm, daveyBinding);
  if (!fs.existsSync(daveyPath)) return false;

  // Also check for chalk (dependency used by OpenClaw)
  const chalk = path.join(nm, 'chalk');
  return fs.existsSync(chalk);
}

/** @snazzah/davey platform binding name for current platform */
function getDaveyBindingName(): string {
  const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const suffix = platform === 'win32' ? 'msvc' : platform === 'linux' ? 'gnu' : '';
  return `@snazzah/davey-${platform}-${arch}${suffix ? `-${suffix}` : ''}`;
}

/**
 * Check if platform-specific dependencies are installed.
 * The bundled tgz is built for the target platform at pack time, so no runtime npm install needed.
 * @returns true if dependencies look correct
 */
function checkPlatformDependencies(pkgRoot: string): boolean {
  const daveyBinding = getDaveyBindingName();
  const daveyPath = path.join(pkgRoot, 'node_modules', daveyBinding);
  const chalk = path.join(pkgRoot, 'node_modules', 'chalk');

  if (fs.existsSync(daveyPath) && fs.existsSync(chalk)) {
    console.log('[Sudoclaw] Platform dependencies OK');
    return true;
  }

  console.warn('[Sudoclaw] Platform dependencies missing:', { daveyPath, chalk });
  return false;
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

/** Launcher script: fixes argv for Commander when run via bundled Node.js */
const LAUNCHER_CONTENT = `#!/usr/bin/env node
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

function writeLauncher(pkgRoot: string): string {
  const launcherPath = path.join(pkgRoot, 'launcher.mjs');
  fs.writeFileSync(launcherPath, LAUNCHER_CONTENT, 'utf-8');
  return launcherPath;
}

function createUnixWrapper(launcherFile: string): void {
  const wrapperPath = path.join(SUDOCLAW_BIN_DIR, 'openclaw');
  const nodePath = getNodeBinaryPath();

  // Simple wrapper: use bundled Node.js only (no Electron, no system Node fallback)
  const lines = ['#!/bin/sh', '# openclaw wrapper — managed by Sudowork (Sudoclaw)', `CLI="${launcherFile}"`, `STATE_DIR="${SUDOCLAW_DIR}"`, `BUNDLED_NODE="${nodePath}"`, '', 'if [ ! -x "$BUNDLED_NODE" ]; then', '  echo "Error: Bundled Node.js not found at $BUNDLED_NODE" >&2', '  echo "Please restart Sudowork to install it." >&2', '  exit 1', 'fi', '', 'exec env OPENCLAW_STATE_DIR="$STATE_DIR" "$BUNDLED_NODE" "$CLI" "$@"'];

  fs.writeFileSync(wrapperPath, lines.join('\n') + '\n', { mode: 0o755 });
}

function createWindowsWrapper(launcherFile: string): void {
  const wrapperPath = path.join(SUDOCLAW_BIN_DIR, 'openclaw.cmd');
  const nodePath = getNodeBinaryPath();

  // Simple wrapper: use bundled Node.js only (no Electron, no system Node fallback)
  const lines = ['@echo off', `set "CLI=${launcherFile}"`, `set "OPENCLAW_STATE_DIR=${SUDOCLAW_DIR}"`, `set "BUNDLED_NODE=${nodePath}"`, '', 'if not exist "%BUNDLED_NODE%" (', '  echo Error: Bundled Node.js not found at %BUNDLED_NODE%', '  echo Please restart Sudowork to install it.', '  exit /b 1', ')', '', '"%BUNDLED_NODE%" "%CLI%" %*'];

  fs.writeFileSync(wrapperPath, lines.join('\r\n') + '\r\n');
}

/** Repair openclaw.json schema — add models array to providers, remove unrecognized keys, fix workspace path to ensure isolation from system OpenClaw */
function repairOpenClawConfig(): void {
  const configPath = path.join(SUDOCLAW_DIR, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) return;
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    let changed = false;

    // CRITICAL: Force workspace to Sudoclaw directory to ensure complete isolation from system OpenClaw
    // This prevents Sudoclaw from accidentally using ~/.sudoclaw or ~/.openclaw workspace
    const agents = config.agents as { defaults?: { workspace?: string } } | undefined;
    if (agents?.defaults) {
      const currentWorkspace = agents.defaults.workspace;
      if (typeof currentWorkspace !== 'string' || (!currentWorkspace.includes(SUDOCLAW_DIR) && !currentWorkspace.includes('.nexus'))) {
        // Workspace points outside ~/.nexus/.sudoclaw - force reset to isolated directory
        agents.defaults.workspace = SUDOCLAW_WORKSPACE_DIR;
        changed = true;
        console.log('[Sudoclaw] Fixed workspace path to isolated directory:', SUDOCLAW_WORKSPACE_DIR);
      }
    }

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
    if (gw && typeof gw === 'object' && (gw.port === 18789 || gw.port === 18799)) {
      gw.port = SUDOCLAW_DEFAULT_PORT;
      changed = true;
    }
    // Ensure ~/.nexus/config/skills is in skills.load.extraDirs for default skill loading
    const skills = config.skills as { load?: { extraDirs?: string[] } } | undefined;
    const extraDirs = skills?.load?.extraDirs;
    if (!Array.isArray(extraDirs) || !extraDirs.includes(NEXUS_SKILLS_DIR)) {
      if (!config.skills) (config as Record<string, unknown>).skills = {};
      const s = config.skills as { load?: { extraDirs?: string[] } };
      if (!s.load) s.load = {};
      const dirs = Array.isArray(s.load.extraDirs) ? [...s.load.extraDirs] : [];
      if (!dirs.includes(NEXUS_SKILLS_DIR)) dirs.push(NEXUS_SKILLS_DIR);
      s.load.extraDirs = dirs;
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
        model: { primary: 'sudorouter/gemini-3-flash-preview', fallbacks: [] as string[] },
        models: {},
      },
      list: [{ id: 'main', identity: { name: 'OpenClaw', emoji: '🦞' } }],
    },
    models: {
      mode: 'merge' as const,
      providers: {
        sudorouter: {
          baseUrl: 'https://hk.sudorouter.ai/v1',
          api: 'google-generative-ai',
          models: [{ id: 'gemini-3-flash-preview', name: 'gemini-3-flash-preview' }],
        },
      },
    },
    gateway: { port: SUDOCLAW_DEFAULT_PORT, mode: 'local' as const, auth: { mode: 'none' as const } },
    skills: {
      load: { extraDirs: [NEXUS_SKILLS_DIR] },
    },
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

/** Migrate from legacy ~/.sudoclaw to ~/.nexus/.sudoclaw */
function migrateLegacySudoclaw(): void {
  if (!fs.existsSync(LEGACY_SUDOCLAW_DIR)) return;
  if (fs.existsSync(SUDOCLAW_DIR)) {
    // New already exists, remove legacy to avoid confusion
    try {
      fs.rmSync(LEGACY_SUDOCLAW_DIR, { recursive: true, force: true });
      console.log('[Sudoclaw] Removed legacy ~/.sudoclaw (already migrated)');
    } catch {
      // ignore
    }
    return;
  }
  try {
    fs.mkdirSync(path.dirname(SUDOCLAW_DIR), { recursive: true });
    fs.renameSync(LEGACY_SUDOCLAW_DIR, SUDOCLAW_DIR);
    console.log('[Sudoclaw] Migrated ~/.sudoclaw to ~/.nexus/.sudoclaw');
  } catch (err) {
    console.error('[Sudoclaw] Migration failed, falling back to copy:', err);
    try {
      fs.cpSync(LEGACY_SUDOCLAW_DIR, SUDOCLAW_DIR, { recursive: true });
      fs.rmSync(LEGACY_SUDOCLAW_DIR, { recursive: true, force: true });
      console.log('[Sudoclaw] Migrated ~/.sudoclaw to ~/.nexus/.sudoclaw (copy)');
    } catch (copyErr) {
      console.error('[Sudoclaw] Migration failed:', copyErr);
    }
  }
}

/** Get the bundled OpenClaw resource path (from packaged app or development) */
function getBundledOpenclawPath(): string | null {
  if (app.isPackaged) {
    const packagedPath = path.join(process.resourcesPath, 'openclaw.tgz');
    if (fs.existsSync(packagedPath)) return packagedPath;
  }

  // Development mode
  const devPath = path.join(app.getAppPath(), 'resources', 'openclaw.tgz');
  if (fs.existsSync(devPath)) return devPath;

  return null;
}

/**
 * Ensure OpenClaw is installed in ~/.nexus/.sudoclaw.
 * Called on app startup — runs silently, no user prompt.
 * Note: ensureNodeInstalled() is called before this in process/index.ts
 *
 * On Windows, NSIS installer may have already extracted files to:
 * - ~/.nexus/.sudoclaw/cli/package/... (extracted from openclaw.tgz)
 * This function detects that and creates the launcher/wrapper if missing.
 */
export async function ensureSudoclawInstalled(): Promise<{ installed: boolean; cliPath: string | null }> {
  migrateLegacySudoclaw();
  repairOpenClawConfig();

  const binName = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
  const managedBin = path.join(SUDOCLAW_BIN_DIR, binName);
  const pkgRoot = resolvePackageRoot();

  // Check if package was extracted by NSIS (has dist/ and node_modules but no launcher)
  if (pkgRoot && hasDistEntry(pkgRoot) && hasNodeModules(pkgRoot)) {
    console.log('[Sudoclaw] Package already extracted, checking launcher/wrapper...');

    const launcherPath = path.join(pkgRoot, 'launcher.mjs');
    const hasLauncher = fs.existsSync(launcherPath);
    const hasBinWrapper = fs.existsSync(managedBin);

    if (!hasLauncher || !hasBinWrapper) {
      console.log('[Sudoclaw] Creating missing launcher/wrapper...');
      writeLauncher(pkgRoot);
      if (process.platform === 'win32') {
        createWindowsWrapper(launcherPath);
      } else {
        createUnixWrapper(launcherPath);
      }
      ensureDefaultConfig();
      fs.mkdirSync(SUDOCLAW_WORKSPACE_DIR, { recursive: true });
    }

    if (checkPlatformDependencies(pkgRoot)) {
      console.log('[Sudoclaw] Sudoclaw ready');
      return { installed: true, cliPath: managedBin };
    }
  }

  // Check if already fully installed with correct platform bindings and launcher
  const entryFile = resolveEntryFile();
  const launcherPath = pkgRoot ? path.join(pkgRoot, 'launcher.mjs') : null;
  const hasLauncher = launcherPath ? fs.existsSync(launcherPath) : false;

  if (fs.existsSync(managedBin) && entryFile && fs.existsSync(entryFile) && pkgRoot && hasDistEntry(pkgRoot) && hasNodeModules(pkgRoot) && hasLauncher) {
    // Verify platform dependencies
    if (checkPlatformDependencies(pkgRoot)) {
      writeLauncher(pkgRoot); // Re-write launcher to ensure it's up-to-date
      if (process.platform === 'win32') {
        createWindowsWrapper(launcherPath!);
      } else {
        createUnixWrapper(launcherPath!);
      }
      return { installed: true, cliPath: managedBin };
    }
    // Platform deps missing, fall through to re-extract
    console.log('[Sudoclaw] Platform dependencies missing, will re-extract...');
  }

  try {
    fs.mkdirSync(SUDOCLAW_CLI_DIR, { recursive: true });
    fs.mkdirSync(SUDOCLAW_BIN_DIR, { recursive: true });

    // Re-extract if existing install lacks node_modules (old tgz format)
    const existingPkg = resolvePackageRoot();
    if (existingPkg && hasDistEntry(existingPkg) && !hasNodeModules(existingPkg)) {
      console.log('[Sudoclaw] Re-extracting (missing node_modules)...');
      fs.rmSync(SUDOCLAW_CLI_DIR, { recursive: true, force: true });
      fs.mkdirSync(SUDOCLAW_CLI_DIR, { recursive: true });
    }

    // Use bundled resource only (no OSS fallback)
    const bundledPath = getBundledOpenclawPath();
    if (!bundledPath) {
      console.error('[Sudoclaw] Bundled OpenClaw resource not found');
      return { installed: false, cliPath: null };
    }

    console.log(`[Sudoclaw] Using bundled OpenClaw from ${bundledPath}...`);

    try {
      await tar.x({ file: bundledPath, cwd: SUDOCLAW_CLI_DIR });
    } catch (err) {
      console.error('[Sudoclaw] Failed to extract:', err);
      return { installed: false, cliPath: null };
    }

    const newPkgRoot = resolvePackageRoot();
    if (newPkgRoot && !checkPlatformDependencies(newPkgRoot)) {
      console.error('[Sudoclaw] Platform dependencies check failed after extraction');
      return { installed: false, cliPath: null };
    }
    if (!newPkgRoot || !hasDistEntry(newPkgRoot)) {
      console.error('[Sudoclaw] Downloaded package missing dist/');
      return { installed: false, cliPath: null };
    }

    const resolvedEntry = resolveEntryFile();
    if (!resolvedEntry) {
      console.error('[Sudoclaw] Cannot determine OpenClaw CLI entry file');
      return { installed: false, cliPath: null };
    }

    const newLauncherPath = writeLauncher(newPkgRoot);
    if (process.platform === 'win32') {
      createWindowsWrapper(newLauncherPath);
    } else {
      createUnixWrapper(newLauncherPath);
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

/** Get the Sudoclaw CLI path if installed (dist/ and node_modules and launcher.mjs exist) */
export function getSudoclawCliPath(): string | null {
  const binName = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
  const managedBin = path.join(SUDOCLAW_BIN_DIR, binName);
  const entryFile = resolveEntryFile();
  const pkgRoot = resolvePackageRoot();
  const launcherPath = pkgRoot ? path.join(pkgRoot, 'launcher.mjs') : null;
  const hasLauncher = launcherPath ? fs.existsSync(launcherPath) : false;

  if (fs.existsSync(managedBin) && entryFile && fs.existsSync(entryFile) && pkgRoot && hasDistEntry(pkgRoot) && hasNodeModules(pkgRoot) && hasLauncher) {
    return managedBin;
  }
  return null;
}

/**
 * Install Sudoclaw manually (from About page).
 * Ensures Node.js is installed first, then installs Sudoclaw.
 * Returns true on success, throws on failure.
 */
export async function installSudoclawManually(onProgress?: (phase: 'extracting' | 'installing' | 'configuring', percent?: number) => void): Promise<boolean> {
  // Import ensureNodeInstalled dynamically to avoid circular dependency
  const { ensureNodeInstalled } = await import('../claudeCli/NodeRuntimeService');

  // Ensure Node.js is installed first
  onProgress?.('installing', 0);
  console.log('[Sudoclaw] Ensuring Node.js is installed...');
  const nodeInstalled = await ensureNodeInstalled();
  if (!nodeInstalled) {
    throw new Error('Failed to install Node.js runtime. Please restart the application.');
  }

  // Check if already installed
  const existingResult = await ensureSudoclawInstalled();
  if (existingResult.installed) {
    console.log('[Sudoclaw] Already installed');
    onProgress?.('configuring', 100);
    return true;
  }

  // Perform installation
  onProgress?.('extracting', 10);
  const result = await ensureSudoclawInstalled();

  if (result.installed) {
    onProgress?.('configuring', 100);
    return true;
  }

  throw new Error('Failed to install Sudoclaw. Please check the logs for details.');
}
