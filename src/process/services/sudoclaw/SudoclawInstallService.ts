/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sudoclaw Install Service
 *
 * Built-in OpenClaw installation for Sudowork. Installs to ~/.nexus/sudoclaw (separate
 * from official ~/.openclaw) so users get a one-click experience without system
 * Node.js. Uses bundled Node.js runtime to avoid macOS Dock bounce.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import runtimeVersions from '@/shared/runtime-versions.json';
import { extractTarGzWithProgress } from '../archiveProgress';

/** Legacy path for migration from ~/.sudoclaw */
const LEGACY_SUDOCLAW_DIR = path.join(os.homedir(), '.sudoclaw');

/** Legacy path for migration from ~/.nexus/.sudoclaw (dot-prefixed) */
const LEGACY_SUDOCLAW_DIR_V2 = path.join(os.homedir(), '.nexus', '.sudoclaw');

/** Sudoclaw root: ~/.nexus/sudoclaw (macOS/Linux) or %USERPROFILE%\.nexus\sudoclaw (Windows) */
export const SUDOCLAW_DIR = path.join(os.homedir(), '.nexus', 'sudoclaw');

/** Default gateway port for Sudoclaw (17863) — avoids conflict with system OpenClaw (18789) */
export const SUDOCLAW_DEFAULT_PORT = 17863;

const SUDOCLAW_CLI_DIR = path.join(SUDOCLAW_DIR, 'cli');
/** CLI bin path: ~/.nexus/sudoclaw/cli/package/bin/ (included in tgz) */
export const SUDOCLAW_BIN_DIR = path.join(SUDOCLAW_CLI_DIR, 'package', 'bin');
const SUDOCLAW_WORKSPACE_DIR = path.join(SUDOCLAW_DIR, 'workspace');
const SUDOCLAW_INSTALL_MANIFEST_PATH = path.join(SUDOCLAW_DIR, 'install-manifest.json');
const BUNDLED_OPENCLAW_MANIFEST_NAME = 'openclaw.manifest.json';

export const CONFIG_FILENAME = 'sudoclaw.json';

/** Full path to sudoclaw.json config file */
export const SUDOCLAW_CONFIG_PATH = path.join(SUDOCLAW_DIR, CONFIG_FILENAME);

/** Remove only the extracted Sudoclaw CLI runtime, preserving user config and workspace data. */
export function removeSudoclawCli(): void {
  if (fs.existsSync(SUDOCLAW_CLI_DIR)) {
    fs.rmSync(SUDOCLAW_CLI_DIR, { recursive: true, force: true });
  }
}

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
    mainLog('Sudoclaw', 'Platform dependencies OK');
    return true;
  }

  mainWarn('Sudoclaw', `Platform dependencies missing: ${daveyPath}, ${chalk}`);
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

type SudoclawInstallManifest = {
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  daveyBinding?: string;
  generatedAt?: string;
};

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function isValidInstallManifest(value: unknown): value is SudoclawInstallManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<SudoclawInstallManifest>;
  return typeof manifest.version === 'string' && typeof manifest.platform === 'string' && typeof manifest.arch === 'string';
}

function readSudoclawInstallManifest(): SudoclawInstallManifest | null {
  const manifest = readJsonFile<unknown>(SUDOCLAW_INSTALL_MANIFEST_PATH);
  return isValidInstallManifest(manifest) ? manifest : null;
}

function getBundledOpenclawManifestPath(): string | null {
  if (app.isPackaged) {
    const packagedPath = path.join(process.resourcesPath, BUNDLED_OPENCLAW_MANIFEST_NAME);
    if (fs.existsSync(packagedPath)) return packagedPath;
  }

  const devPath = path.join(app.getAppPath(), 'resources', BUNDLED_OPENCLAW_MANIFEST_NAME);
  if (fs.existsSync(devPath)) return devPath;

  return null;
}

function getExpectedSudoclawInstallManifest(): SudoclawInstallManifest | null {
  const bundledManifestPath = getBundledOpenclawManifestPath();
  const bundledManifest = bundledManifestPath ? readJsonFile<unknown>(bundledManifestPath) : null;
  if (isValidInstallManifest(bundledManifest)) {
    return bundledManifest;
  }

  const bundledVersion = getSudoclawBundledVersion();
  if (!bundledVersion) return null;

  return {
    version: bundledVersion,
    platform: process.platform,
    arch: process.arch,
  };
}

function isSudoclawInstallManifestCurrent(): boolean {
  const installed = readSudoclawInstallManifest();
  const expected = getExpectedSudoclawInstallManifest();
  if (!installed || !expected) return false;

  return installed.version === expected.version && installed.platform === expected.platform && installed.arch === expected.arch;
}

function writeSudoclawInstallManifest(): void {
  const manifest = getExpectedSudoclawInstallManifest();
  if (!manifest) return;

  try {
    fs.mkdirSync(SUDOCLAW_DIR, { recursive: true });
    fs.writeFileSync(SUDOCLAW_INSTALL_MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
  } catch (err) {
    mainWarn('Sudoclaw', `Failed to write install manifest: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function getSudoclawInstalledVersion(): string | undefined {
  const pkgRoot = resolvePackageRoot();
  if (pkgRoot) {
    try {
      const pkgJsonPath = path.join(pkgRoot, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')) as { version?: unknown };
        if (typeof pkg.version === 'string' && pkg.version.trim()) {
          return pkg.version.trim();
        }
      }
    } catch {
      // fall back to install manifest below
    }
  }

  const manifestVersion = normalizeVersion(readSudoclawInstallManifest()?.version);
  return manifestVersion;
}

export function getSudoclawBundledVersion(): string | undefined {
  const value = runtimeVersions.sudoclaw;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeVersion(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^v/i, '');
}

export function getSudoclawVersionState(): { installedVersion?: string; bundledVersion?: string; needsUpgrade: boolean } {
  const bundledPath = getBundledOpenclawPath();
  const installedVersion = normalizeVersion(getSudoclawInstalledVersion());
  const bundledVersion = normalizeVersion(getSudoclawBundledVersion());

  if (!bundledPath || !installedVersion || !bundledVersion) {
    return {
      installedVersion,
      bundledVersion,
      needsUpgrade: false,
    };
  }

  return {
    installedVersion,
    bundledVersion,
    needsUpgrade: installedVersion !== bundledVersion,
  };
}

/** Check if launcher.mjs exists in package (created at pack time) */
function hasLauncher(pkgRoot: string): boolean {
  return fs.existsSync(path.join(pkgRoot, 'launcher.mjs'));
}

/** Check if bin wrapper exists in package (created at pack time) */
function hasBinWrapper(pkgRoot: string): boolean {
  const binDir = path.join(pkgRoot, 'bin');
  if (process.platform === 'win32') {
    return fs.existsSync(path.join(binDir, 'openclaw.cmd'));
  }
  return fs.existsSync(path.join(binDir, 'openclaw'));
}

/** Migrate config filename from openclaw.json to sudoclaw.json */
function migrateConfigFilename(): void {
  const oldConfigPath = path.join(SUDOCLAW_DIR, 'openclaw.json');
  const newConfigPath = path.join(SUDOCLAW_DIR, CONFIG_FILENAME);
  if (fs.existsSync(oldConfigPath) && !fs.existsSync(newConfigPath)) {
    try {
      fs.renameSync(oldConfigPath, newConfigPath);
      mainLog('Sudoclaw', `Migrated openclaw.json to ${CONFIG_FILENAME}`);
    } catch {
      // ignore
    }
  }
}

/** Repair sudoclaw.json schema — add models array to providers and fill missing defaults without overwriting user workspace choices. */
export function repairOpenClawConfig(): void {
  const configPath = path.join(SUDOCLAW_DIR, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) return;
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    let changed = false;

    // Preserve user-selected workspaces. Only backfill when the field is absent/invalid.
    const agents = config.agents as { defaults?: { workspace?: string } } | undefined;
    if (agents?.defaults) {
      const currentWorkspace = agents.defaults.workspace;
      if (typeof currentWorkspace !== 'string' || !currentWorkspace.trim()) {
        agents.defaults.workspace = SUDOCLAW_WORKSPACE_DIR;
        changed = true;
        mainLog('Sudoclaw', `Filled missing workspace path: ${SUDOCLAW_WORKSPACE_DIR}`);
      }
    }

    const providers = config.models as { providers?: Record<string, { models?: unknown }> } | undefined;
    if (providers?.providers) {
      for (const [, prov] of Object.entries(providers.providers)) {
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

    // Ensure gateway config exists with auth: { mode: 'none' }
    if (!config.gateway || typeof config.gateway !== 'object') {
      (config as Record<string, unknown>).gateway = { port: SUDOCLAW_DEFAULT_PORT, mode: 'local', auth: { mode: 'none' } };
      changed = true;
      mainLog('Sudoclaw', 'Added missing gateway config');
    } else {
      const gw = config.gateway as { mode?: string; port?: number; auth?: { mode?: string } };
      if (!gw.mode) {
        gw.mode = 'local';
        changed = true;
      }
      if (gw.port === 18789 || gw.port === 18799) {
        gw.port = SUDOCLAW_DEFAULT_PORT;
        changed = true;
      }
      if (!gw.port) {
        gw.port = SUDOCLAW_DEFAULT_PORT;
        changed = true;
      }
      // CRITICAL: Ensure auth.mode is set to 'none' for local development
      if (!gw.auth || typeof gw.auth !== 'object' || gw.auth.mode !== 'none') {
        gw.auth = { mode: 'none' };
        changed = true;
        mainLog('Sudoclaw', 'Fixed gateway auth to mode: none');
      }
    }

    if (changed) {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      mainLog('Sudoclaw', 'Repaired sudoclaw.json schema');
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
      list: [{ id: 'main', identity: { name: 'SudoClaw', emoji: '🦞' } }],
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

/** Migrate from legacy paths (~/.sudoclaw or ~/.nexus/.sudoclaw) to ~/.nexus/sudoclaw */
function migrateLegacySudoclaw(): void {
  // Try migrating from the most recent legacy path first (v2: ~/.nexus/.sudoclaw)
  migrateLegacyDir(LEGACY_SUDOCLAW_DIR_V2, 'v2 (~/.nexus/.sudoclaw)');
  // Then try the oldest legacy path (~/.sudoclaw)
  migrateLegacyDir(LEGACY_SUDOCLAW_DIR, 'v1 (~/.sudoclaw)');
}

function migrateLegacyDir(legacyDir: string, label: string): void {
  if (!fs.existsSync(legacyDir)) return;
  if (fs.existsSync(SUDOCLAW_DIR)) {
    mainLog('Sudoclaw', `Skipped migrating ${label} because ~/.nexus/sudoclaw already exists`);
    return;
  }
  try {
    fs.mkdirSync(path.dirname(SUDOCLAW_DIR), { recursive: true });
    fs.renameSync(legacyDir, SUDOCLAW_DIR);
    mainLog('Sudoclaw', `Migrated ${label} to ~/.nexus/sudoclaw`);
  } catch (err) {
    mainError('Sudoclaw', `Migration from ${label} failed, falling back to copy`, err);
    try {
      fs.cpSync(legacyDir, SUDOCLAW_DIR, { recursive: true });
      fs.rmSync(legacyDir, { recursive: true, force: true });
      mainLog('Sudoclaw', `Migrated ${label} to ~/.nexus/sudoclaw (copy)`);
    } catch (copyErr) {
      mainError('Sudoclaw', `Migration from ${label} failed`, copyErr);
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
 * Ensure OpenClaw is installed in ~/.nexus/sudoclaw.
 * Called on app startup — runs silently, no user prompt.
 * Note: ensureNodeInstalled() is called before this in process/index.ts
 *
 * On Windows, NSIS installer may have already extracted files to:
 * - ~/.nexus/sudoclaw/cli/package/... (extracted from openclaw.tgz)
 * The tgz includes launcher.mjs and bin/openclaw(.cmd) created at pack time.
 */
export async function ensureSudoclawInstalled(options?: { forceReinstall?: boolean; onProgress?: (percent: number) => void }): Promise<{ installed: boolean; cliPath: string | null }> {
  const forceReinstall = options?.forceReinstall === true;
  migrateLegacySudoclaw();
  migrateConfigFilename();
  ensureDefaultConfig();
  repairOpenClawConfig();
  fs.mkdirSync(SUDOCLAW_WORKSPACE_DIR, { recursive: true });

  const pkgRoot = resolvePackageRoot();

  // Check if already fully installed with all required files (tgz includes launcher and bin)
  if (!forceReinstall && pkgRoot && hasDistEntry(pkgRoot) && hasNodeModules(pkgRoot) && hasLauncher(pkgRoot) && hasBinWrapper(pkgRoot)) {
    if (checkPlatformDependencies(pkgRoot)) {
      if (!isSudoclawInstallManifestCurrent()) {
        writeSudoclawInstallManifest();
      }
      mainLog('Sudoclaw', 'Already installed');
      const binName = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
      return { installed: true, cliPath: path.join(pkgRoot, 'bin', binName) };
    }
    mainLog('Sudoclaw', 'Platform dependencies missing, will re-extract...');
  }

  try {
    fs.mkdirSync(SUDOCLAW_CLI_DIR, { recursive: true });

    // Re-extract if existing install is incomplete or version upgrade is required
    if (pkgRoot || forceReinstall) {
      mainLog('Sudoclaw', forceReinstall ? 'Re-extracting (version upgrade)...' : 'Re-extracting (incomplete install)...');
      fs.rmSync(SUDOCLAW_CLI_DIR, { recursive: true, force: true });
      fs.mkdirSync(SUDOCLAW_CLI_DIR, { recursive: true });
    }

    // Use bundled resource only (no OSS fallback)
    const bundledPath = getBundledOpenclawPath();
    if (!bundledPath) {
      mainError('Sudoclaw', 'Bundled OpenClaw resource not found');
      return { installed: false, cliPath: null };
    }

    mainLog('Sudoclaw', `Using bundled OpenClaw from ${bundledPath}...`);

    try {
      await extractTarGzWithProgress(bundledPath, SUDOCLAW_CLI_DIR, options?.onProgress);
    } catch (err) {
      mainError('Sudoclaw', 'Failed to extract', err);
      return { installed: false, cliPath: null };
    }

    const newPkgRoot = resolvePackageRoot();
    if (!newPkgRoot || !hasDistEntry(newPkgRoot) || !hasLauncher(newPkgRoot) || !hasBinWrapper(newPkgRoot)) {
      mainError('Sudoclaw', 'Extracted package missing required files');
      return { installed: false, cliPath: null };
    }

    if (!checkPlatformDependencies(newPkgRoot)) {
      mainError('Sudoclaw', 'Platform dependencies check failed after extraction');
      return { installed: false, cliPath: null };
    }

    ensureDefaultConfig();
    repairOpenClawConfig(); // Ensure config is fully repaired after creation
    fs.mkdirSync(SUDOCLAW_WORKSPACE_DIR, { recursive: true });
    writeSudoclawInstallManifest();

    mainLog('Sudoclaw', `OpenClaw installed to ${SUDOCLAW_DIR}`);
    const binName = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
    return { installed: true, cliPath: path.join(newPkgRoot, 'bin', binName) };
  } catch (err) {
    mainError('Sudoclaw', 'Install failed', err);
    return { installed: false, cliPath: null };
  }
}

/** Get the Sudoclaw CLI path if installed */
export function getSudoclawCliPath(): string | null {
  const pkgRoot = resolvePackageRoot();
  if (!pkgRoot || !hasDistEntry(pkgRoot) || !hasNodeModules(pkgRoot) || !hasLauncher(pkgRoot) || !hasBinWrapper(pkgRoot)) {
    return null;
  }
  const binName = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
  return path.join(pkgRoot, 'bin', binName);
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
  mainLog('Sudoclaw', 'Ensuring Node.js is installed...');
  const nodeInstalled = await ensureNodeInstalled();
  if (!nodeInstalled) {
    throw new Error('Failed to install Node.js runtime. Please restart the application.');
  }

  // Check if already installed
  const existingResult = await ensureSudoclawInstalled();
  if (existingResult.installed) {
    mainLog('Sudoclaw', 'Already installed');
    onProgress?.('configuring', 100);
    return true;
  }

  // Perform installation
  onProgress?.('extracting', 10);
  const result = await ensureSudoclawInstalled({
    onProgress: (percent) => {
      onProgress?.('extracting', percent);
    },
  });

  if (result.installed) {
    onProgress?.('configuring', 100);
    return true;
  }

  throw new Error('Failed to install Sudoclaw. Please check the logs for details.');
}
