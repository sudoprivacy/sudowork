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

import { execFileSync } from 'child_process';
import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import runtimeVersions from '@/shared/runtime-versions.json';
import { extractTarGzWithProgress } from '../archiveProgress';

type SudoclawInstallResult = {
  installed: boolean;
  cliPath: string | null;
  error?: string;
};

/** Legacy path for migration from ~/.sudoclaw */
const LEGACY_SUDOCLAW_DIR = path.join(os.homedir(), '.sudoclaw');

/** Legacy path for migration from ~/.nexus/.sudoclaw (dot-prefixed) */
const LEGACY_SUDOCLAW_DIR_V2 = path.join(os.homedir(), '.nexus', '.sudoclaw');

/** Sudoclaw root: ~/.nexus/sudoclaw (macOS/Linux) or %USERPROFILE%\.nexus\sudoclaw (Windows) */
export const SUDOCLAW_DIR = path.join(os.homedir(), '.nexus', 'sudoclaw');

/** Default gateway port for Sudoclaw (17863) — avoids conflict with system OpenClaw (18789) */
export const SUDOCLAW_DEFAULT_PORT = 17863;

const SUDOCLAW_CLI_DIR = path.join(SUDOCLAW_DIR, 'cli');
const SUDOCLAW_CLI_STAGING_DIR = path.join(SUDOCLAW_DIR, 'cli.new');
const SUDOCLAW_CLI_BACKUP_DIR = path.join(SUDOCLAW_DIR, 'cli.old');
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

/** Check if the esbuild-bundled openclaw.mjs exists (produced by bundle-openclaw.js) */
function hasBundledEntry(pkgRoot: string): boolean {
  return fs.existsSync(path.join(pkgRoot, 'openclaw.mjs'));
}

/**
 * Check if node_modules exists with correct platform-specific bindings.
 * Checks for the @snazzah/davey binding for the current platform/arch.
 * Returns false if the correct binding is missing (triggers npm install).
 *
 * In bundled mode (openclaw.mjs exists), only native bindings are required
 * since JS dependencies like chalk are inlined into the bundle.
 */
function hasNodeModules(pkgRoot: string): boolean {
  const nm = path.join(pkgRoot, 'node_modules');
  if (!fs.existsSync(nm) || !fs.statSync(nm).isDirectory()) return false;

  // Check for correct platform-specific @snazzah/davey binding
  const daveyBinding = getDaveyBindingName();
  const daveyPath = path.join(nm, daveyBinding);
  if (!fs.existsSync(daveyPath)) return false;

  // In bundled mode, chalk and other JS deps are inlined - only native bindings matter
  if (hasBundledEntry(pkgRoot)) return true;

  // Legacy (unbundled) mode: also check for chalk
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

  // In bundled mode, only native bindings are required
  if (hasBundledEntry(pkgRoot)) {
    if (fs.existsSync(daveyPath)) {
      mainLog('Sudoclaw', 'Platform dependencies OK (bundled mode)');
      return true;
    }
    mainWarn('Sudoclaw', `Platform dependencies missing (bundled mode): ${daveyPath}`);
    return false;
  }

  // Legacy (unbundled) mode: check both native bindings and JS deps
  const chalk = path.join(pkgRoot, 'node_modules', 'chalk');
  if (fs.existsSync(daveyPath) && fs.existsSync(chalk)) {
    mainLog('Sudoclaw', 'Platform dependencies OK');
    return true;
  }

  mainWarn('Sudoclaw', `Platform dependencies missing: ${daveyPath}, ${chalk}`);
  return false;
}

/** Resolve OpenClaw package root after npm pack extract (package/ at top level) */
function resolvePackageRootFrom(cliDir: string): string | null {
  const packageDir = path.join(cliDir, 'package');
  const pkgJson = path.join(packageDir, 'package.json');
  if (fs.existsSync(pkgJson)) return packageDir;
  const launcherPath = path.join(packageDir, 'launcher.mjs');
  if (fs.existsSync(launcherPath)) return packageDir;
  // Fallback: maybe extracted flat
  const flatPkg = path.join(cliDir, 'package.json');
  if (fs.existsSync(flatPkg)) return cliDir;
  const flatLauncherPath = path.join(cliDir, 'launcher.mjs');
  if (fs.existsSync(flatLauncherPath)) return cliDir;
  return null;
}

function resolvePackageRoot(): string | null {
  return resolvePackageRootFrom(SUDOCLAW_CLI_DIR);
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

function formatInstallError(message: string, err?: unknown): string {
  if (err instanceof Error && err.message) {
    return `${message}: ${err.message}`;
  }
  if (typeof err === 'string' && err.trim()) {
    return `${message}: ${err}`;
  }
  return message;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removeDirIfExists(targetPath: string): void {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function getPidsListeningOnPort(port: number): number[] {
  if (process.platform !== 'win32') {
    return [];
  }

  try {
    const stdout = execFileSync('cmd.exe', ['/c', 'netstat -ano -p tcp'], {
      encoding: 'utf-8',
      windowsHide: true,
    });
    const matches = stdout
      .split(/\r?\n/)
      .filter((line) => line.includes(`:${port}`) && line.includes('LISTENING'))
      .map((line) => line.trim().split(/\s+/).pop())
      .filter((value): value is string => Boolean(value))
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value) && value > 0);
    return [...new Set(matches)];
  } catch {
    return [];
  }
}

function killWindowsProcessTree(pid: number): void {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    // Best effort only.
  }
}

function cleanupSudoclawWindowsLocks(): void {
  if (process.platform !== 'win32') {
    return;
  }

  for (const pid of getPidsListeningOnPort(SUDOCLAW_DEFAULT_PORT)) {
    mainWarn('Sudoclaw', `Killing process tree on port ${SUDOCLAW_DEFAULT_PORT} (pid=${pid}) before directory switch`);
    killWindowsProcessTree(pid);
  }

  try {
    const script = ["$patterns = @('.nexus\\\\sudoclaw\\\\cli', 'launcher.mjs gateway', 'openclaw.mjs gateway')", 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | Where-Object {', '  $cmd = $_.CommandLine', '  foreach ($pattern in $patterns) { if ($cmd -like "*${pattern}*") { return $true } }', '  return $false', '} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'].join('; ');
    execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    // Best effort only.
  }
}

async function switchCliDirectory(stagingDir: string): Promise<void> {
  const maxAttempts = process.platform === 'win32' ? 5 : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      removeDirIfExists(SUDOCLAW_CLI_BACKUP_DIR);

      if (fs.existsSync(SUDOCLAW_CLI_DIR)) {
        fs.renameSync(SUDOCLAW_CLI_DIR, SUDOCLAW_CLI_BACKUP_DIR);
      }

      fs.renameSync(stagingDir, SUDOCLAW_CLI_DIR);

      try {
        removeDirIfExists(SUDOCLAW_CLI_BACKUP_DIR);
      } catch (cleanupErr) {
        mainWarn('Sudoclaw', `Failed to remove backup directory after switch: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
      }
      return;
    } catch (err) {
      lastError = err;

      if (!fs.existsSync(SUDOCLAW_CLI_DIR) && fs.existsSync(SUDOCLAW_CLI_BACKUP_DIR)) {
        try {
          fs.renameSync(SUDOCLAW_CLI_BACKUP_DIR, SUDOCLAW_CLI_DIR);
        } catch {
          // Leave backup in place for manual recovery.
        }
      }

      if (attempt === maxAttempts || process.platform !== 'win32') {
        throw err;
      }

      mainWarn('Sudoclaw', `CLI directory switch failed on attempt ${attempt}/${maxAttempts}: ${err instanceof Error ? err.message : String(err)}`);
      cleanupSudoclawWindowsLocks();
      await wait(attempt * 500);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Check if launcher.mjs exists in package (created at pack time) */
function hasLauncher(pkgRoot: string): boolean {
  return fs.existsSync(path.join(pkgRoot, 'launcher.mjs'));
}

function getLauncherPath(pkgRoot: string): string {
  return path.join(pkgRoot, 'launcher.mjs');
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

  // Ensure workspace directory and USER.md safety rules exist on every startup.
  // This covers scenarios where macOS upgrades or filesystem changes remove the
  // workspace directory or USER.md file after the initial installation.
  try {
    fs.mkdirSync(SUDOCLAW_WORKSPACE_DIR, { recursive: true });
    ensureUserMdSafetyRules();
  } catch (err) {
    mainWarn('Sudoclaw', `Failed to ensure workspace/USER.md during config repair: ${err instanceof Error ? err.message : String(err)}`);
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

/** Marker used to identify the safety-rules section inside USER.md */
const USER_MD_SAFETY_MARKER = '<!-- SUDOCLAW_DELETE_SAFETY_RULES -->';

/**
 * 文件删除安全规则 — 写入 USER.md
 *
 * Ensures that the workspace USER.md contains a "file deletion safety rules"
 * section.  If USER.md does not exist it is created; if it already exists but
 * does not contain the marker the rules are appended.  If the marker is already
 * present the file is left untouched.
 *
 * This guarantees that fresh installs *and* upgrades always carry the prompt.
 */
export function ensureUserMdSafetyRules(): void {
  const userMdPath = path.join(SUDOCLAW_WORKSPACE_DIR, 'USER.md');
  const safetyRulesBlock = `
${USER_MD_SAFETY_MARKER}
## 文件删除安全规则

在执行任何文件或文件夹删除操作前，必须先向用户确认。你需要：

1. **停止操作**并告知用户即将删除的具体路径；
2. **明确请求用户确认**（如：确认删除 /path/to/file？请回复"确认"或"取消"）；
3. **等待用户明确同意**后才执行删除；
4. 若用户**拒绝或未确认**，则放弃删除操作。

此规则适用于所有删除场景：单文件删除、文件夹递归删除、批量删除、rm/rmdir/del 等命令。
`;

  try {
    if (!fs.existsSync(userMdPath)) {
      // USER.md does not exist — create it with a header + safety rules
      const content = `# User\n${safetyRulesBlock}`;
      fs.writeFileSync(userMdPath, content, 'utf-8');
      mainLog('Sudoclaw', 'Created USER.md with file-deletion safety rules');
    } else {
      const existing = fs.readFileSync(userMdPath, 'utf-8');
      if (!existing.includes(USER_MD_SAFETY_MARKER)) {
        // Append safety rules to the existing USER.md
        fs.appendFileSync(userMdPath, `\n${safetyRulesBlock}`, 'utf-8');
        mainLog('Sudoclaw', 'Appended file-deletion safety rules to existing USER.md');
      }
    }
  } catch (err) {
    mainWarn('Sudoclaw', 'Failed to ensure USER.md safety rules', err);
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
export async function ensureSudoclawInstalled(options?: { forceReinstall?: boolean; onProgress?: (percent: number) => void }): Promise<SudoclawInstallResult> {
  const forceReinstall = options?.forceReinstall === true;
  migrateLegacySudoclaw();
  migrateConfigFilename();
  ensureDefaultConfig();
  repairOpenClawConfig();
  fs.mkdirSync(SUDOCLAW_WORKSPACE_DIR, { recursive: true });
  ensureUserMdSafetyRules();

  const pkgRoot = resolvePackageRoot();

  // Check if already fully installed with all required files (tgz includes launcher and bin)
  if (!forceReinstall && pkgRoot && hasLauncher(pkgRoot)) {
    if (!isSudoclawInstallManifestCurrent()) {
      writeSudoclawInstallManifest();
    }
    mainLog('Sudoclaw', 'Existing launcher detected, skipping re-extract');
    return { installed: true, cliPath: getLauncherPath(pkgRoot) };
  }

  try {
    fs.mkdirSync(SUDOCLAW_DIR, { recursive: true });
    removeDirIfExists(SUDOCLAW_CLI_STAGING_DIR);
    removeDirIfExists(SUDOCLAW_CLI_BACKUP_DIR);
    fs.mkdirSync(SUDOCLAW_CLI_STAGING_DIR, { recursive: true });

    // Re-extract if existing install is incomplete or version upgrade is required
    if (pkgRoot || forceReinstall) {
      mainLog('Sudoclaw', forceReinstall ? 'Extracting staged Sudoclaw update...' : 'Extracting staged Sudoclaw install...');
    }

    // Use bundled resource only (no OSS fallback)
    const bundledPath = getBundledOpenclawPath();
    if (!bundledPath) {
      const error = 'Bundled OpenClaw resource not found';
      mainError('Sudoclaw', error);
      return { installed: false, cliPath: null, error };
    }

    mainLog('Sudoclaw', `Using bundled OpenClaw from ${bundledPath}...`);

    try {
      await extractTarGzWithProgress(bundledPath, SUDOCLAW_CLI_STAGING_DIR, options?.onProgress);
    } catch (err) {
      const error = formatInstallError('Failed to extract bundled OpenClaw archive', err);
      mainError('Sudoclaw', error, err);
      return { installed: false, cliPath: null, error };
    }

    const newPkgRoot = resolvePackageRootFrom(SUDOCLAW_CLI_STAGING_DIR);
    if (!newPkgRoot || !hasDistEntry(newPkgRoot) || !hasLauncher(newPkgRoot) || !hasBinWrapper(newPkgRoot)) {
      const error = 'Extracted OpenClaw package is missing required files';
      mainError('Sudoclaw', error);
      return { installed: false, cliPath: null, error };
    }

    if (!checkPlatformDependencies(newPkgRoot)) {
      const deps = hasBundledEntry(newPkgRoot) ? getDaveyBindingName() : `${getDaveyBindingName()}, chalk`;
      const error = `Platform dependencies missing after extraction (${deps})`;
      mainError('Sudoclaw', error);
      return { installed: false, cliPath: null, error };
    }

    await switchCliDirectory(SUDOCLAW_CLI_STAGING_DIR);

    const activePkgRoot = resolvePackageRoot();
    if (!activePkgRoot) {
      const error = 'Activated Sudoclaw package could not be resolved after directory switch';
      mainError('Sudoclaw', error);
      return { installed: false, cliPath: null, error };
    }

    ensureDefaultConfig();
    repairOpenClawConfig(); // Ensure config is fully repaired after creation
    fs.mkdirSync(SUDOCLAW_WORKSPACE_DIR, { recursive: true });
    ensureUserMdSafetyRules();
    writeSudoclawInstallManifest();

    mainLog('Sudoclaw', `OpenClaw installed to ${SUDOCLAW_DIR}`);
    const binName = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
    return { installed: true, cliPath: path.join(activePkgRoot, 'bin', binName) };
  } catch (err) {
    const error = formatInstallError('Sudoclaw install failed', err);
    mainError('Sudoclaw', error, err);
    return { installed: false, cliPath: null, error };
  } finally {
    try {
      removeDirIfExists(SUDOCLAW_CLI_STAGING_DIR);
    } catch {
      // Ignore staging cleanup errors.
    }
  }
}

/** Get the Sudoclaw CLI path if installed */
export function getSudoclawCliPath(): string | null {
  const pkgRoot = resolvePackageRoot();
  if (!pkgRoot || !hasLauncher(pkgRoot)) {
    return null;
  }
  return getLauncherPath(pkgRoot);
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

  throw new Error(result.error ?? 'Failed to install Sudoclaw. Please check the logs for details.');
}
