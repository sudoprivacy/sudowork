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
import * as https from 'https';
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

/** COS base URL for downloading sudoclaw archives at runtime */
const SUDOCLAW_COS_BASE_URL = 'https://sudoclaw-1309794936.cos.ap-beijing.myqcloud.com';
/** GitHub base URL for downloading sudoclaw archives at runtime */
const SUDOCLAW_GITHUB_RELEASE_BASE_URL = 'https://github.com/sudoprivacy/sudorepo/releases/download';

/** Platform name mapping: Node.js process.platform → sudoclaw archive OS name */
const SUDOCLAW_OS_NAME_MAP: Record<string, string> = { darwin: 'macos', win32: 'windows' };
/** Architecture mapping: Node.js process.arch → sudoclaw archive arch name */
const SUDOCLAW_ARCH_NAME_MAP: Record<string, string> = { arm64: 'arm64', x64: 'x64' };

export const CONFIG_FILENAME = 'sudoclaw.json';

/** Full path to sudoclaw.json config file */
export const SUDOCLAW_CONFIG_PATH = path.join(SUDOCLAW_DIR, CONFIG_FILENAME);

const SUDOCLAW_DEFAULT_GATEWAY_RELOAD = {
  mode: 'hot' as const,
};

/** Remove only the extracted Sudoclaw CLI runtime, preserving user config and workspace data. */
export function removeSudoclawCli(): void {
  if (fs.existsSync(SUDOCLAW_CLI_DIR)) {
    fs.rmSync(SUDOCLAW_CLI_DIR, { recursive: true, force: true });
  }
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

export function getBundledOpenclawArchiveFileName(): string | null {
  const version = runtimeVersions.sudoclaw;
  if (!version) return null;
  const osName = SUDOCLAW_OS_NAME_MAP[process.platform];
  const archName = SUDOCLAW_ARCH_NAME_MAP[process.arch];
  if (!osName || !archName) return null;
  return `${version}-sudoclaw-${osName}-${archName}.tgz`;
}

function getSudoclawReleaseVersion(): string | undefined {
  const version = runtimeVersions.sudoclaw;
  if (typeof version !== 'string') return undefined;
  const releaseVersion = version.split('-')[0]?.trim();
  return releaseVersion || undefined;
}

export function getBundledOpenclawManifestFileName(): string | null {
  const archiveFileName = getBundledOpenclawArchiveFileName();
  if (!archiveFileName) return null;
  return archiveFileName.replace(/\.tgz$/i, '.manifest.json');
}

function getBundledOpenclawManifestPath(): string | null {
  const manifestFileName = getBundledOpenclawManifestFileName();
  if (!manifestFileName) return null;

  if (app.isPackaged) {
    const packagedPath = path.join(process.resourcesPath, manifestFileName);
    if (fs.existsSync(packagedPath)) return packagedPath;
  }

  const devPath = path.join(app.getAppPath(), 'resources', manifestFileName);
  if (fs.existsSync(devPath)) return devPath;

  return null;
}

function readBundledOpenclawManifest(): SudoclawInstallManifest | null {
  const bundledManifestPath = getBundledOpenclawManifestPath();
  const bundledManifest = bundledManifestPath ? readJsonFile<unknown>(bundledManifestPath) : null;
  return isValidInstallManifest(bundledManifest) ? bundledManifest : null;
}

function getExpectedSudoclawInstallManifest(): SudoclawInstallManifest | null {
  const bundledManifest = readBundledOpenclawManifest();
  const bundledVersion = getSudoclawBundledVersion();
  if (!bundledVersion) return null;

  if (isValidInstallManifest(bundledManifest)) {
    return {
      ...bundledManifest,
      version: bundledVersion,
    };
  }

  return {
    version: bundledVersion,
    platform: process.platform,
    arch: process.arch,
  };
}

function validateBundledOpenclawVersion(): string | null {
  const bundledVersion = getSudoclawBundledVersion();
  if (!bundledVersion) return null;

  const bundledManifest = readBundledOpenclawManifest();
  if (!bundledManifest) return null;

  if (bundledManifest.version !== bundledVersion) {
    return `Bundled OpenClaw resource version mismatch: manifest=${bundledManifest.version}, runtime=${bundledVersion}`;
  }

  return null;
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
  const manifestVersion = readSudoclawInstallManifest()?.version;
  return typeof manifestVersion === 'string' && manifestVersion.trim() ? manifestVersion.trim() : undefined;
}

export function getSudoclawBundledVersion(): string | undefined {
  const value = runtimeVersions.sudoclaw;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getSudoclawVersionState(): { installedVersion?: string; bundledVersion?: string; needsUpgrade: boolean } {
  const installedVersion = getSudoclawInstalledVersion();
  const bundledVersion = getSudoclawBundledVersion();

  if (!installedVersion || !bundledVersion) {
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

export function isSudoclawInstalled(): boolean {
  const versionState = getSudoclawVersionState();
  return Boolean(versionState.installedVersion) && !versionState.needsUpgrade;
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

    // "imageAnalysisModel" is not in the gateway zod schema; migrate to "imageModel"
    const agentDefaults = (config.agents as { defaults?: Record<string, unknown> } | undefined)?.defaults;
    if (agentDefaults?.imageAnalysisModel !== undefined) {
      if (agentDefaults.imageModel === undefined) {
        agentDefaults.imageModel = agentDefaults.imageAnalysisModel;
      }
      delete agentDefaults.imageAnalysisModel;
      changed = true;
    }

    // Ensure gateway config exists with auth: { mode: 'none' }
    if (!config.gateway || typeof config.gateway !== 'object') {
      (config as Record<string, unknown>).gateway = {
        port: SUDOCLAW_DEFAULT_PORT,
        mode: 'local',
        auth: { mode: 'none' },
        reload: { ...SUDOCLAW_DEFAULT_GATEWAY_RELOAD },
      };
      changed = true;
      mainLog('Sudoclaw', 'Added missing gateway config');
    } else {
      const gw = config.gateway as {
        mode?: string;
        port?: number;
        auth?: { mode?: string };
        reload?: Record<string, unknown> & { mode?: string };
      };
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
      if (!gw.reload || typeof gw.reload !== 'object' || gw.reload.mode !== SUDOCLAW_DEFAULT_GATEWAY_RELOAD.mode || Object.keys(gw.reload).some((key) => key !== 'mode')) {
        gw.reload = { ...SUDOCLAW_DEFAULT_GATEWAY_RELOAD };
        changed = true;
        mainLog('Sudoclaw', 'Fixed gateway reload config to hot mode');
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
    ensureUserMdIdentityStatement();
  } catch (err) {
    mainWarn('Sudoclaw', `Failed to ensure workspace/USER.md during config repair: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function ensureDefaultConfig(): void {
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
          models: [{ id: 'gemini-3-flash-preview', name: 'gemini-3-flash-preview', input: ['text', 'image'] }],
        },
        'sudorouter-gemini-3-flash-preview': {
          baseUrl: 'https://hk.sudorouter.ai/v1',
          api: 'google-generative-ai',
          models: [{ id: 'gemini-3-flash-preview', name: 'gemini-3-flash-preview', input: ['text', 'image'] }],
        },
        ollama: {
          baseUrl: 'https://hk.sudorouter.ai/search/ollama',
        },
      },
    },
    gateway: {
      port: SUDOCLAW_DEFAULT_PORT,
      mode: 'local' as const,
      auth: { mode: 'none' as const },
      reload: { ...SUDOCLAW_DEFAULT_GATEWAY_RELOAD },
    },
    tools: {
      web: {
        search: {
          provider: 'ollama' as const,
        },
      },
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

/** Marker used to identify the safety-rules section inside USER.md */
const USER_MD_SAFETY_MARKER = '<!-- SUDOCLAW_DELETE_SAFETY_RULES -->';

/** Marker used to identify the identity-statement section inside USER.md */
const USER_MD_IDENTITY_MARKER = '<!-- SUDOCLAW_IDENTITY_STATEMENT -->';

/**
 * Update or insert a marker-based block in USER.md
 * If marker exists, replace the entire block; if not, append it
 */
function updateMarkerBlock(existingContent: string, marker: string, newBlock: string): string {
  if (!existingContent.includes(marker)) {
    // Marker not found - append the new block
    return existingContent + '\n' + newBlock;
  }

  // Find all markers in the file to determine boundaries
  const markers = [USER_MD_SAFETY_MARKER, USER_MD_IDENTITY_MARKER];
  const markerPositions: { marker: string; pos: number }[] = [];

  for (const m of markers) {
    const pos = existingContent.indexOf(m);
    if (pos !== -1) {
      markerPositions.push({ marker: m, pos });
    }
  }

  // Sort by position
  markerPositions.sort((a, b) => a.pos - b.pos);

  // Find the start position of the current marker's block
  const currentMarkerIndex = markerPositions.findIndex((m) => m.marker === marker);
  const startPos = markerPositions[currentMarkerIndex].pos;

  // Find the end position (start of next marker block, or end of file)
  let endPos: number;
  if (currentMarkerIndex + 1 < markerPositions.length) {
    endPos = markerPositions[currentMarkerIndex + 1].pos;
  } else {
    endPos = existingContent.length;
  }

  // Replace the block
  const before = existingContent.substring(0, startPos);
  const after = existingContent.substring(endPos);
  return before + newBlock + after;
}

/**
 * 文件删除安全规则 — 写入 USER.md
 *
 * Ensures that the workspace USER.md contains a "file deletion safety rules"
 * section. If USER.md does not exist it is created; if the marker exists the
 * block is updated; otherwise it is appended.
 *
 * This guarantees that fresh installs *and* upgrades always have the latest prompt.
 */
export function ensureUserMdSafetyRules(): void {
  const userMdPath = path.join(SUDOCLAW_WORKSPACE_DIR, 'USER.md');
  const safetyRulesBlock = `
${USER_MD_SAFETY_MARKER}
## 文件删除安全规则 / File Deletion Safety Rules

**中文：**

在执行任何文件或文件夹删除操作前，必须先向用户确认。你需要：

1. **停止操作**并告知用户即将删除的具体路径；
2. **明确请求用户确认**（如：确认删除 /path/to/file？请回复"确认"或"取消"）；
3. **等待用户明确同意**后才执行删除；
4. 若用户**拒绝或未确认**，则放弃删除操作。

此规则适用于所有删除场景：单文件删除、文件夹递归删除、批量删除、rm/rmdir/del 等命令。

**English:**

Before performing any file or folder deletion, you must first confirm with the user. You need to:

1. **Stop the operation** and inform the user of the specific path to be deleted;
2. **Explicitly request user confirmation** (e.g., "Confirm deletion of /path/to/file? Please reply 'confirm' or 'cancel'");
3. **Wait for explicit user consent** before executing the deletion;
4. If the user **refuses or does not confirm**, abandon the deletion operation.

This rule applies to all deletion scenarios: single file deletion, recursive folder deletion, batch deletion, rm/rmdir/del commands, etc.
`;

  try {
    if (!fs.existsSync(userMdPath)) {
      // USER.md does not exist — create it with a header + safety rules
      const content = `# User\n${safetyRulesBlock}`;
      fs.writeFileSync(userMdPath, content, 'utf-8');
      mainLog('Sudoclaw', 'Created USER.md with file-deletion safety rules');
    } else {
      const existing = fs.readFileSync(userMdPath, 'utf-8');
      const updated = updateMarkerBlock(existing, USER_MD_SAFETY_MARKER, safetyRulesBlock);
      if (updated !== existing) {
        fs.writeFileSync(userMdPath, updated, 'utf-8');
        if (existing.includes(USER_MD_SAFETY_MARKER)) {
          mainLog('Sudoclaw', 'Updated file-deletion safety rules in USER.md');
        } else {
          mainLog('Sudoclaw', 'Appended file-deletion safety rules to USER.md');
        }
      }
    }
  } catch (err) {
    mainWarn('Sudoclaw', 'Failed to ensure USER.md safety rules', err);
  }
}

/**
 * 身份声明规则 — 写入 USER.md
 *
 * Ensures that the workspace USER.md contains an "identity statement"
 * section. If USER.md does not exist it is created; if the marker exists the
 * block is updated; otherwise it is appended.
 */
export function ensureUserMdIdentityStatement(): void {
  const userMdPath = path.join(SUDOCLAW_WORKSPACE_DIR, 'USER.md');
  const identityBlock = `
${USER_MD_IDENTITY_MARKER}
## Identity Statement

**CRITICAL: Determine your identity BEFORE answering any identity-related question.**

### Step 1: Check for explicit identity in your context/rules

Look at the beginning of your system rules/context. If you see a statement like:
- "你是 XX 助手" (You are XX assistant)
- "你是 **XX**，一个..." (You are **XX**, a...)
- "I am XX assistant"
- Or any clear role/identity definition

**USE THAT EXACT NAME as your identity.** This is your primary identity source.

### Step 2: If no explicit identity in rules, check the conversation context

If no identity is defined in your rules but you know you are serving as a specific assistant (from conversation title, context, or user's selection), use that assistant name.

### Step 3: Default fallback

Only if no identity is found in rules or context:
- **Chinese (中文)**: "我是你的智能助手，有什么需要帮助的吗？"
- **English**: "I am your AI assistant. How can I help you?"

### Identity Questions Response Template

**General identity questions** (e.g., "你是谁？", "Who are you?"):
- With explicit identity from rules: "我是你的{助手名称}，有什么需要帮助的吗？" / "I am your {assistant name}. How can I help you?"
- Without explicit identity: Use Step 3 default response

**OpenClaw/Platform-related questions** (e.g., "你是OpenClaw吗？", "What is your relationship with OpenClaw?"):
- With explicit identity: "我是{助手名称}，运行于SudoClaw平台。OpenClaw是平台的AI引擎组件之一。有什么可以帮助你的吗？"
- Without explicit identity: "我是智能助手，运行于SudoClaw平台。有什么可以帮助你的吗？" / "I am an AI assistant running on the SudoClaw platform. How can I help you?"

### Examples

If your rules start with "你是 Cowork 助手" → You are "Cowork 助手"
If your rules start with "你是 **Copilot**，一个任务编排助手" → You are "Copilot"
If your rules start with "你是 CC晨，一个..." → You are "CC晨"

Response guidelines:
- 简洁明确，直接告知用户身份 / Be concise and clear
- 保持友好、专业的态度 / Maintain a friendly, professional attitude
- ALWAYS check your rules FIRST before using default identity
`;

  try {
    if (!fs.existsSync(userMdPath)) {
      const content = `# User\n${identityBlock}`;
      fs.writeFileSync(userMdPath, content, 'utf-8');
      mainLog('Sudoclaw', 'Created USER.md with identity statement');
    } else {
      const existing = fs.readFileSync(userMdPath, 'utf-8');
      const updated = updateMarkerBlock(existing, USER_MD_IDENTITY_MARKER, identityBlock);
      if (updated !== existing) {
        fs.writeFileSync(userMdPath, updated, 'utf-8');
        if (existing.includes(USER_MD_IDENTITY_MARKER)) {
          mainLog('Sudoclaw', 'Updated identity statement in USER.md');
        } else {
          mainLog('Sudoclaw', 'Appended identity statement to USER.md');
        }
      }
    }
  } catch (err) {
    mainWarn('Sudoclaw', 'Failed to ensure USER.md identity statement', err);
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

function getSudoclawGitHubDownloadUrl(): string | null {
  const version = getSudoclawReleaseVersion();
  const fileName = getBundledOpenclawArchiveFileName();
  if (!version || !fileName) return null;
  return `${SUDOCLAW_GITHUB_RELEASE_BASE_URL}/${version}/${fileName}`;
}

function getSudoclawCosDownloadUrl(): string | null {
  const version = getSudoclawReleaseVersion();
  const fileName = getBundledOpenclawArchiveFileName();
  if (!version || !fileName) return null;
  return `${SUDOCLAW_COS_BASE_URL}/${version}/${fileName}`;
}

/**
 * Download a file from URL (HTTPS) with redirect support.
 * Returns a promise that resolves on success, rejects on failure.
 */
function downloadFileFromUrl(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let redirects = 0;

    const doRequest = (requestUrl: string): void => {
      if (redirects++ > 10) {
        reject(new Error('Too many redirects'));
        return;
      }

      https
        .get(requestUrl, (response) => {
          if ([301, 302, 307, 308].includes(response.statusCode!) && response.headers.location) {
            mainLog('Sudoclaw', `Download redirect → ${response.headers.location}`);
            doRequest(response.headers.location);
            return;
          }

          if (response.statusCode !== 200) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }

          const file = fs.createWriteStream(destPath);

          response.pipe(file);

          file.on('finish', () => {
            file.close();
            resolve();
          });

          file.on('error', (err) => {
            try {
              fs.unlinkSync(destPath);
            } catch {
              // Ignore cleanup failures.
            }
            reject(err);
          });
        })
        .on('error', (err) => {
          try {
            fs.unlinkSync(destPath);
          } catch {
            // Ignore cleanup failures.
          }
          reject(err);
        });
    };

    doRequest(url);
  });
}

/**
 * Download sudoclaw archive from GitHub (primary) or COS (fallback).
 * Returns the path to the downloaded file, or null if all sources fail.
 */
async function downloadSudoclawFromRemote(): Promise<string | null> {
  const downloadAttempts: { label: string; url: string | null }[] = [
    { label: 'GitHub', url: getSudoclawGitHubDownloadUrl() },
    { label: 'COS', url: getSudoclawCosDownloadUrl() },
  ];

  const downloadDir = path.join(os.tmpdir(), 'sudoclaw-download');
  fs.mkdirSync(downloadDir, { recursive: true });
  const destPath = path.join(downloadDir, getBundledOpenclawArchiveFileName() ?? 'openclaw.tgz');

  let lastError: string | null = null;

  for (const attempt of downloadAttempts) {
    if (!attempt.url) {
      mainWarn('Sudoclaw', `${attempt.label} download URL not available for ${process.platform}-${process.arch}`);
      continue;
    }

    mainLog('Sudoclaw', `Downloading sudoclaw from ${attempt.label}: ${attempt.url}`);

    try {
      await downloadFileFromUrl(attempt.url, destPath);
      mainLog('Sudoclaw', `Downloaded sudoclaw archive from ${attempt.label} to ${destPath}`);
      return destPath;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      mainWarn('Sudoclaw', `${attempt.label} download failed: ${lastError}`);
      // Clean up partial download
      try {
        fs.unlinkSync(destPath);
      } catch {
        // Ignore cleanup failures.
      }
    }
  }

  mainError('Sudoclaw', `All download sources failed. Last error: ${lastError ?? 'unknown'}`);
  return null;
}

/** Get the bundled OpenClaw resource path (from packaged app or development) */
function getBundledOpenclawPath(): string | null {
  const archiveFileName = getBundledOpenclawArchiveFileName();
  if (!archiveFileName) return null;

  if (app.isPackaged) {
    const packagedPath = path.join(process.resourcesPath, archiveFileName);
    if (fs.existsSync(packagedPath)) return packagedPath;
  }

  // Development mode
  const devPath = path.join(app.getAppPath(), 'resources', archiveFileName);
  if (fs.existsSync(devPath)) return devPath;

  return null;
}

/**
 * Ensure OpenClaw is installed in ~/.nexus/sudoclaw.
 * Called on app startup — runs silently, no user prompt.
 * Note: ensureNodeInstalled() is called before this in process/index.ts
 *
 * On Windows, NSIS installer may have already extracted files to:
 * - ~/.nexus/sudoclaw/cli/package/... (extracted from the bundled OpenClaw archive)
 * The tgz includes launcher.mjs created at pack time.
 */
export async function ensureSudoclawInstalled(options?: { forceReinstall?: boolean; onProgress?: (percent: number) => void }): Promise<SudoclawInstallResult> {
  const forceReinstall = options?.forceReinstall === true;
  migrateLegacySudoclaw();
  migrateConfigFilename();
  ensureDefaultConfig();
  repairOpenClawConfig();
  fs.mkdirSync(SUDOCLAW_WORKSPACE_DIR, { recursive: true });
  ensureUserMdSafetyRules();
  ensureUserMdIdentityStatement();

  const pkgRoot = resolvePackageRoot();
  const versionState = getSudoclawVersionState();
  const bundledVersionError = validateBundledOpenclawVersion();

  if (bundledVersionError) {
    mainError('Sudoclaw', bundledVersionError);
    return { installed: false, cliPath: null, error: bundledVersionError };
  }

  if (!forceReinstall && isSudoclawInstalled()) {
    mainLog('Sudoclaw', `Existing Sudoclaw ${versionState.installedVersion} detected, skipping re-extract`);
    return { installed: true, cliPath: pkgRoot ? getLauncherPath(pkgRoot) : null };
  }

  let downloadedTempPath: string | null = null;

  try {
    fs.mkdirSync(SUDOCLAW_DIR, { recursive: true });
    removeDirIfExists(SUDOCLAW_CLI_STAGING_DIR);
    removeDirIfExists(SUDOCLAW_CLI_BACKUP_DIR);
    fs.mkdirSync(SUDOCLAW_CLI_STAGING_DIR, { recursive: true });

    // Re-extract if existing install is incomplete or version upgrade is required
    if (pkgRoot || forceReinstall) {
      mainLog('Sudoclaw', forceReinstall ? 'Extracting staged Sudoclaw update...' : 'Extracting staged Sudoclaw install...');
    }

    // Try bundled resource first, then download from GitHub/COS
    let bundledPath = getBundledOpenclawPath();
    if (!bundledPath) {
      mainWarn('Sudoclaw', 'Bundled OpenClaw resource not found, attempting remote download...');
      const downloadedPath = await downloadSudoclawFromRemote();
      if (!downloadedPath) {
        const error = 'OpenClaw resource not found (bundled missing, remote download failed)';
        mainError('Sudoclaw', error);
        return { installed: false, cliPath: null, error };
      }
      bundledPath = downloadedPath;
      downloadedTempPath = downloadedPath;
    }

    mainLog('Sudoclaw', `Using OpenClaw from ${bundledPath}...`);

    try {
      await extractTarGzWithProgress(bundledPath, SUDOCLAW_CLI_STAGING_DIR, options?.onProgress);
    } catch (err) {
      const error = formatInstallError('Failed to extract bundled OpenClaw archive', err);
      mainError('Sudoclaw', error, err);
      return { installed: false, cliPath: null, error };
    }

    const newPkgRoot = resolvePackageRootFrom(SUDOCLAW_CLI_STAGING_DIR);
    if (!newPkgRoot) {
      const error = 'Extracted OpenClaw package could not be resolved';
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
    ensureUserMdIdentityStatement();
    writeSudoclawInstallManifest();

    mainLog('Sudoclaw', `OpenClaw installed to ${SUDOCLAW_DIR}`);
    return { installed: true, cliPath: getLauncherPath(activePkgRoot) };
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
    // Clean up downloaded temp file (not the bundled one)
    if (downloadedTempPath) {
      try {
        fs.unlinkSync(downloadedTempPath);
      } catch {
        // Ignore cleanup errors.
      }
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
