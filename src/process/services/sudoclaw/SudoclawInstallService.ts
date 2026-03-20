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
import * as https from 'https';
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
const SUDOCLAW_BIN_DIR = path.join(SUDOCLAW_DIR, 'bin');
const SUDOCLAW_WORKSPACE_DIR = path.join(SUDOCLAW_DIR, 'workspace');

/** Nexus skills dir (~/.nexus/config/skills) — loaded by OpenClaw via skills.load.extraDirs */
const NEXUS_SKILLS_DIR = path.join(os.homedir(), '.nexus', 'config', 'skills');
const CONFIG_FILENAME = 'openclaw.json';

/** OSS download URL for OpenClaw */
const OSS_BASE_URL = 'https://sudoclaw-1309794936.cos.ap-beijing.myqcloud.com/sudoclaw';

function getOpenclawOssUrl(): string {
  const platform = process.platform === 'win32' ? 'windows' : 'macos';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${OSS_BASE_URL}/openclaw-${platform}-${arch}.tgz`;
}

/** Download file from URL to destination path */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          // Follow redirect
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error(`Redirect without location header from ${url}`));
            return;
          }
          file.close();
          fs.unlinkSync(dest);
          downloadFile(redirectUrl, dest).then(resolve).catch(reject);
          return;
        }
        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', (err) => {
        file.close();
        fs.unlinkSync(dest);
        reject(err);
      });
  });
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

/** Repair openclaw.json schema — add models array to providers, remove unrecognized keys, fix workspace path after migration */
function repairOpenClawConfig(): void {
  const configPath = path.join(SUDOCLAW_DIR, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) return;
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    let changed = false;

    // Update workspace path if it still references legacy ~/.sudoclaw (after migration)
    const agents = config.agents as { defaults?: { workspace?: string } } | undefined;
    const workspace = agents?.defaults?.workspace;
    if (typeof workspace === 'string' && workspace.includes(LEGACY_SUDOCLAW_DIR)) {
      const newWorkspace = workspace.replace(LEGACY_SUDOCLAW_DIR, SUDOCLAW_DIR);
      if (agents.defaults) agents.defaults.workspace = newWorkspace;
      changed = true;
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

/**
 * Ensure OpenClaw is installed in ~/.nexus/.sudoclaw.
 * Called on app startup — runs silently, no user prompt.
 * Note: ensureNodeInstalled() is called before this in process/index.ts
 */
export async function ensureSudoclawInstalled(): Promise<{ installed: boolean; cliPath: string | null }> {
  migrateLegacySudoclaw();
  repairOpenClawConfig();

  const binName = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
  const managedBin = path.join(SUDOCLAW_BIN_DIR, binName);
  const entryFile = resolveEntryFile();
  const pkgRoot = resolvePackageRoot();

  if (fs.existsSync(managedBin) && entryFile && fs.existsSync(entryFile) && pkgRoot && hasDistEntry(pkgRoot) && hasNodeModules(pkgRoot)) {
    const launcherPath = writeLauncher(pkgRoot);
    if (process.platform === 'win32') {
      createWindowsWrapper(launcherPath);
    } else {
      createUnixWrapper(launcherPath);
    }
    return { installed: true, cliPath: managedBin };
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

    // Download from OSS
    const ossUrl = getOpenclawOssUrl();
    const tmpTgzPath = path.join(os.tmpdir(), `openclaw-${Date.now()}.tgz`);

    console.log(`[Sudoclaw] Downloading OpenClaw from ${ossUrl}...`);
    try {
      await downloadFile(ossUrl, tmpTgzPath);
    } catch (err) {
      console.error('[Sudoclaw] Download failed:', err);
      return { installed: false, cliPath: null };
    }

    try {
      await tar.x({ file: tmpTgzPath, cwd: SUDOCLAW_CLI_DIR });
    } finally {
      // Clean up downloaded temp file
      try {
        fs.unlinkSync(tmpTgzPath);
      } catch {
        // ignore cleanup errors
      }
    }

    const pkgRoot = resolvePackageRoot();
    if (!pkgRoot || !hasDistEntry(pkgRoot)) {
      throw new Error('Downloaded package missing dist/');
    }
    if (!hasNodeModules(pkgRoot)) {
      throw new Error('Downloaded package missing node_modules');
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
