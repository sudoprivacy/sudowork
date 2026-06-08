/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Backend-specific ACP connector logic and environment helpers.
 * Extracted from AcpConnection to keep the main class focused on
 * process lifecycle, messaging, and session management.
 */

import type { ChildProcess, SpawnOptions } from 'child_process';
import { execFile as execFileCb, execFileSync, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, promises as fs, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { CLAUDE_ACP_NPX_PACKAGE, CODEBUDDY_ACP_NPX_PACKAGE, CODEX_ACP_BRIDGE_VERSION, CODEX_ACP_NPX_PACKAGE } from '@/types/acpTypes';
import { findSuitableNodeBin, getEnhancedEnv, resolveNpxPath } from '@process/utils/shellEnv';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { isSafetyHookEnabled } from '@process/services/safety/SafetyPollingService';
import { app } from 'electron';

const execFile = promisify(execFileCb);

// Safety hooks are temporarily disabled because the current implementation is obsolete.
// Keep the injection path intact for future restoration.
const SAFETY_HOOKS_ENABLED = false;

/** Enable ACP performance diagnostics via ACP_PERF=1 */
export const ACP_PERF_LOG = process.env.ACP_PERF === '1';

/**
 * Get path to hook.js for child process injection.
 * The hook will intercept file and network operations for safety checks.
 */
function getHookJsPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'hook.js');
  }
  return path.join(app.getAppPath(), 'hook/node/dist/hook.js');
}

/**
 * Build a --require node option with proper quoting for paths containing spaces.
 * On Windows, backslashes are normalized to forward slashes and the path is
 * wrapped in double quotes so that NODE_OPTIONS parsing is not broken by spaces
 * in the installation directory (e.g. "C:\Program Files\...").
 */
function buildRequireNodeOption(modulePath: string): string {
  const normalizedPath = process.platform === 'win32' ? modulePath.replace(/\\/g, '/') : modulePath;
  const escapedPath = normalizedPath.replace(/"/g, '\\"');
  return `--require="${escapedPath}"`;
}

function getHookPythonWhlPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'hook-0.0.1-py3-none-any.whl');
  }
  return path.join(app.getAppPath(), 'hook/python/dist/hook-0.0.1-py3-none-any.whl');
}

function getHookPythonPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'pythonpath');
  }
  return path.join(app.getAppPath(), 'hook/python/pythonpath');
}

// ── Environment helpers ─────────────────────────────────────────────

type PrepareCleanEnvOptions = {
  injectSafetyHook?: boolean;
};

type ScodeAuthMode = 'subscription' | 'proxy' | 'api-key';

const SCODE_AUTH_MODE_PRIORITY: ScodeAuthMode[] = ['subscription', 'proxy', 'api-key'];

function scodeCliPathIncludesAuthFlag(cliPath: string): boolean {
  return /(?:^|\s)--auth(?:\s|$)/.test(cliPath);
}

function scodeArgsIncludeAuthFlag(args: string[] | undefined): boolean {
  return Array.isArray(args) && args.includes('--auth');
}

export function resolveScodeAcpArgs(cliPath: string, acpArgs: string[] | undefined, env: Record<string, string | undefined>, authMode?: ScodeAuthMode | null): string[] | undefined {
  const baseArgs = acpArgs ?? ['acp'];

  if (scodeCliPathIncludesAuthFlag(cliPath) || scodeArgsIncludeAuthFlag(baseArgs)) {
    return baseArgs;
  }

  if (authMode) {
    return ['--auth', authMode, ...baseArgs];
  }

  if (env.PROXY_AUTH_TOKEN && env.PROXY_BASE_URL) {
    return ['--auth', 'proxy', ...baseArgs];
  }

  return baseArgs;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function resolveScodeAuthModeFromConfig(config: unknown, settings: unknown, modelOverride?: string | null): ScodeAuthMode | null {
  const configRecord = asRecord(config);
  if (!configRecord) return null;

  const settingsRecord = asRecord(settings);
  const currentModel = typeof modelOverride === 'string' && modelOverride.trim() ? modelOverride.trim() : typeof settingsRecord?.model === 'string' && settingsRecord.model.trim() ? settingsRecord.model.trim() : typeof configRecord.default_model === 'string' && configRecord.default_model.trim() ? configRecord.default_model.trim() : null;
  if (!currentModel) return null;

  const models = asRecord(configRecord.models);
  if (!models) return null;

  const modelEntry =
    asRecord(models[currentModel]) ||
    Object.values(models)
      .map(asRecord)
      .find((entry) => entry && typeof entry.alias === 'string' && entry.alias === currentModel);
  const providers = asRecord(modelEntry?.providers);
  if (!providers) return null;

  return SCODE_AUTH_MODE_PRIORITY.find((mode) => asRecord(providers[mode])) || null;
}

function readScodeAuthModeFromDisk(modelOverride?: string | null): ScodeAuthMode | null {
  try {
    const scodeDir = path.join(os.homedir(), '.nexus', 'sudocode');
    const configPath = path.join(scodeDir, 'sudocode.json');
    const settingsPath = path.join(scodeDir, 'settings.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as unknown;
    let settings: unknown = {};
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as unknown;
    } catch {
      // settings.json is optional; default_model in sudocode.json is enough.
    }
    return resolveScodeAuthModeFromConfig(config, settings, modelOverride);
  } catch {
    return null;
  }
}

function removePathEntry(envPath: string | undefined, entry: string): string | undefined {
  if (!envPath) return undefined;

  const normalize = (value: string) => {
    const normalized = path.normalize(value);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };

  const normalizedEntry = normalize(entry);
  const filtered = envPath.split(path.delimiter).filter((part) => part.length > 0 && normalize(part) !== normalizedEntry);

  return filtered.length > 0 ? filtered.join(path.delimiter) : undefined;
}

/**
 * Prepare a clean environment for ACP backends.
 * Removes Electron-injected NODE_OPTIONS, npm lifecycle vars, and other
 * env vars that interfere with child Node.js processes.
 *
 * Also injects safety hook via NODE_OPTIONS if safety hook is enabled.
 */
export function prepareCleanEnv({ injectSafetyHook = true }: PrepareCleanEnvOptions = {}): Record<string, string | undefined> {
  const cleanEnv = getEnhancedEnv();
  delete cleanEnv.NODE_OPTIONS;
  delete cleanEnv.NODE_INSPECT;
  delete cleanEnv.NODE_DEBUG;
  delete cleanEnv.HOOK_PYTHON_WHL;
  delete cleanEnv.SUDOWORK_ACP_CHILD;
  // Remove CLAUDECODE env var to prevent claude-agent-sdk from detecting
  // a nested session when Sudowork itself is launched from Claude Code.
  delete cleanEnv.CLAUDECODE;
  // Remove ANTHROPIC_MODEL to prevent scode from inheriting a stale model alias
  // from the user's shell (e.g. "glm-5.1"). The model is controlled by sudowork
  // via settings.json and ACP session/set_model RPC.
  delete cleanEnv.ANTHROPIC_MODEL;
  // Strip npm lifecycle vars inherited from parent `npm start` process.
  // These (npm_config_*, npm_lifecycle_*, npm_package_*) can cause npx to
  // behave as if running inside an npm script, interfering with package
  // resolution and child process startup.
  for (const key of Object.keys(cleanEnv)) {
    if (key.startsWith('npm_')) {
      delete cleanEnv[key];
    }
  }

  // On Windows, inject UTF-8 environment variables to ensure child processes
  // output UTF-8 regardless of the system's default code page (e.g. CP936/GBK
  // on Chinese Windows 10).  This replaces the previous approach of running
  // `chcp 65001` through a cmd.exe shell wrapper and covers the most common
  // runtimes that scode (or its skill scripts) may spawn:
  //   - Python:  PYTHONUTF8 (PEP 540) + PYTHONIOENCODING
  //   - Node.js / Go / Rust: already UTF-8 on pipes, but LANG/LC_ALL helps
  //     when they call libc locale functions
  //   - Ruby / Perl / other POSIX-aware tools: read LANG / LC_ALL
  //
  // 在 Windows 上注入 UTF-8 环境变量，确保子进程无论系统默认代码页如何都输出
  // UTF-8。这替代了之前通过 cmd.exe 执行 `chcp 65001` 的方式，覆盖了绝大部分
  // 运行时。即使 sudowork 异常退出，因为不再依赖 cmd.exe 中介，进程清理也能
  // 正常工作。
  if (process.platform === 'win32') {
    // Python 3.7+ UTF-8 mode (PEP 540) — forces stdin/stdout/stderr to UTF-8
    if (!cleanEnv.PYTHONUTF8) cleanEnv.PYTHONUTF8 = '1';
    // Explicit Python I/O encoding fallback (covers Python < 3.7 and edge cases)
    if (!cleanEnv.PYTHONIOENCODING) cleanEnv.PYTHONIOENCODING = 'utf-8';
    // POSIX locale — many cross-platform runtimes (Ruby, Perl, Rust locale crate,
    // git, etc.) check LANG / LC_ALL even on Windows
    if (!cleanEnv.LANG) cleanEnv.LANG = 'C.UTF-8';
    if (!cleanEnv.LC_ALL) cleanEnv.LC_ALL = 'C.UTF-8';
  }

  // Do NOT set AI_DEV_BROWSER_PORT — let ai-dev-browser launch its own
  // Chrome instance (port 9350+) via browser_start instead of connecting
  // to Sudowork's Electron CDP port, which would navigate the app's own
  // renderer tab and break the UI.
  // Do NOT force AI_DEV_BROWSER_HEADLESS — let the agent decide. Sites
  // with strict bot detection (Akamai, Cloudflare) detect headless mode
  // beyond navigator.webdriver. Non-headless is the default, matching
  // real user behavior.

  const basePythonPath = removePathEntry(cleanEnv.PYTHONPATH, getHookPythonPath());
  if (basePythonPath) {
    cleanEnv.PYTHONPATH = basePythonPath;
  } else {
    delete cleanEnv.PYTHONPATH;
  }

  // Inject safety hook via NODE_OPTIONS if enabled.
  // Also set SUDOWORK_ACP_CHILD=1 so the hook skips in ACP bridge child processes
  // (the hook is inherited via NODE_OPTIONS but must not intercept stdio JSON-RPC).
  if (SAFETY_HOOKS_ENABLED && injectSafetyHook && isSafetyHookEnabled()) {
    const hookJsPath = getHookJsPath();
    const hookOption = buildRequireNodeOption(hookJsPath);
    cleanEnv.NODE_OPTIONS = hookOption;
    cleanEnv.SUDOWORK_ACP_CHILD = '1';
    console.log(`[ACP] Injecting safety hook via NODE_OPTIONS: ${hookOption}`);

    const pythonpath = getHookPythonPath();
    cleanEnv.HOOK_PYTHON_WHL = getHookPythonWhlPath();
    cleanEnv.PYTHONPATH = basePythonPath ? `${pythonpath}${path.delimiter}${basePythonPath}` : pythonpath;
    console.log(`[ACP] Injecting python safety hook via PYTHONPATH: ${pythonpath}`);
  }

  // PYTHONPATH for ai_dev_browser module resolution (browser tool).
  // The browser skill dir contains ai_dev_browser (symlinked from vendor).
  // Python silently ignores non-existent entries, so no existence check needed.
  const browserSkillDir = path.join(os.homedir(), '.nexus', 'skills', '_system', '_builtin', 'browser');
  const prevPythonPath = cleanEnv.PYTHONPATH || '';
  cleanEnv.PYTHONPATH = prevPythonPath ? `${browserSkillDir}${path.delimiter}${prevPythonPath}` : browserSkillDir;

  // Add sudoclaw/bin to PATH so the `browser` CLI wrapper is available to ACP agents.
  const sudoclawBinDir = path.join(os.homedir(), '.nexus', 'sudoclaw', 'bin');
  const prevPath = cleanEnv.PATH || '';
  if (existsSync(sudoclawBinDir) && !prevPath.includes(sudoclawBinDir)) {
    cleanEnv.PATH = `${sudoclawBinDir}${path.delimiter}${prevPath}`;
  }

  return cleanEnv;
}

/**
 * Pre-check Node.js version and auto-correct PATH if too old.
 * Requires Node >= minMajor.minMinor for ACP backends.
 * Mutates cleanEnv.PATH when auto-correction is needed.
 */
export function ensureMinNodeVersion(cleanEnv: Record<string, string | undefined>, minMajor: number, minMinor: number, backendLabel: string): void {
  const isWindows = process.platform === 'win32';
  let versionTooOld = false;
  let detectedVersion = '';

  try {
    detectedVersion = execFileSync(isWindows ? 'node.exe' : 'node', ['--version'], { env: cleanEnv, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();

    const match = detectedVersion.match(/^v(\d+)\.(\d+)\./);
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      if (major < minMajor || (major === minMajor && minor < minMinor)) {
        versionTooOld = true;
      }
    }
  } catch {
    // node not found — let spawn attempt handle it
    console.warn('[ACP] Node.js version check skipped: node not found in PATH');
  }

  if (versionTooOld) {
    const suitableBinDir = findSuitableNodeBin(minMajor, minMinor);
    if (suitableBinDir) {
      const sep = isWindows ? ';' : ':';
      cleanEnv.PATH = suitableBinDir + sep + (cleanEnv.PATH || '');

      // Verify the corrected PATH actually resolves to a good node (npx uses the same PATH)
      try {
        const correctedVersion = execFileSync(isWindows ? 'node.exe' : 'node', ['--version'], { env: cleanEnv, encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        console.log(`[ACP] Node.js ${detectedVersion} is below v${minMajor}.${minMinor}.0 — auto-corrected to ${correctedVersion} from: ${suitableBinDir}`);
      } catch {
        console.warn(`[ACP] PATH corrected with ${suitableBinDir} but node verification failed — proceeding anyway`);
      }
    } else {
      throw new Error(`Node.js ${detectedVersion} is too old for ${backendLabel}. ` + `Minimum required: v${minMajor}.${minMinor}.0. ` + `Please upgrade Node.js: https://nodejs.org/`);
    }
  }
}

// ── Generic spawn config ────────────────────────────────────────────

/**
 * Creates spawn configuration for ACP CLI commands.
 * Exported for unit testing.
 *
 * @param cliPath - CLI command path (e.g., 'goose', 'npx @pkg/cli')
 * @param workingDir - Working directory for the spawned process
 * @param acpArgs - Arguments to enable ACP mode (e.g., ['acp'] for goose, ['--acp'] for auggie, ['exec','--output-format','acp'] for droid)
 * @param customEnv - Custom environment variables
 * @param prebuiltEnv - Pre-built env to use directly (skips internal getEnhancedEnv)
 */
export function createGenericSpawnConfig(cliPath: string, workingDir: string, acpArgs?: string[], customEnv?: Record<string, string>, prebuiltEnv?: Record<string, string>) {
  const isWindows = process.platform === 'win32';
  // Use prebuilt env if provided (already cleaned by caller), otherwise build from shell env
  const env = prebuiltEnv ?? getEnhancedEnv(customEnv);

  // Default to --experimental-acp only if acpArgs is strictly undefined.
  // This allows passing an empty array [] to bypass default flags.
  const effectiveAcpArgs = acpArgs === undefined ? ['--experimental-acp'] : acpArgs;

  let spawnCommand: string;
  let spawnArgs: string[];

  // Whether this is an npx-based command that needs cmd.exe to run .cmd batch files
  const isNpxCommand = cliPath.startsWith('npx ');

  if (isNpxCommand) {
    // For "npx @package/name [extra-args]", split into command and arguments
    const parts = cliPath.split(' ').filter(Boolean);
    spawnCommand = resolveNpxPath(env);
    spawnArgs = [...parts.slice(1), ...effectiveAcpArgs];
  } else {
    // Direct CLI command or path (e.g., "scode", "/usr/local/bin/goose",
    // "C:\Users\xxx\.nexus\sudocode\scode.exe").
    // If cliPath contains inline args (e.g., "goose acp"), parse into
    // command + args by splitting on whitespace.
    const parts = cliPath.split(/\s+/);
    spawnCommand = parts[0];
    spawnArgs = [...parts.slice(1), ...effectiveAcpArgs];
  }

  const options: SpawnOptions = {
    cwd: workingDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    // On Windows, only use shell for npx-based commands (npx.cmd is a batch file
    // that requires cmd.exe to execute).  For direct executables (scode.exe,
    // goose.exe, etc.), spawn without cmd.exe intermediary so that:
    //   1. ProcessSupervisor tracks the actual runtime PID (not cmd.exe)
    //   2. taskkill /T is no longer needed to kill the process tree
    //   3. Cleanup on abnormal exit is reliable — the OS kills the direct child
    //
    // UTF-8 encoding is handled via environment variables (PYTHONUTF8, LANG,
    // etc.) injected by prepareCleanEnv() instead of the previous `chcp 65001`
    // through cmd.exe.
    //
    // 在 Windows 上，仅在运行 npx 批处理文件时使用 shell。对于直接可执行文件
    // （scode.exe 等），直接 spawn 而不经过 cmd.exe 中介，从而确保异常退出时
    // 进程清理可靠工作。
    shell: isWindows && isNpxCommand,
  };

  return {
    command: spawnCommand,
    args: spawnArgs,
    options,
  };
}

// ── Spawn result type ───────────────────────────────────────────────

export type SpawnResult = { child: ChildProcess; isDetached: boolean };

/** Return type for npx backend prepare functions (prepareClaude, prepareCodex, prepareCodebuddy). */
export type NpxPrepareResult = {
  cleanEnv: Record<string, string | undefined>;
  npxCommand: string;
  extraArgs?: string[];
};

// ── Backend-specific connectors ─────────────────────────────────────

/**
 * Spawn an npx-based ACP backend package.
 * Used by Claude, Codex, and CodeBuddy connectors.
 */
export function spawnNpxBackend(
  backend: string,
  npxPackage: string,
  npxCommand: string,
  cleanEnv: Record<string, string | undefined>,
  workingDir: string,
  isWindows: boolean,
  preferOffline: boolean,
  {
    extraArgs = [],
    detached = false,
  }: {
    extraArgs?: string[];
    detached?: boolean;
  } = {}
): SpawnResult {
  const spawnArgs = ['--yes', ...(preferOffline ? ['--prefer-offline'] : []), npxPackage, ...extraArgs];

  const spawnStart = Date.now();
  // detached: true creates a new session (setsid) so the child has no controlling terminal.
  // Required for backends (e.g. CodeBuddy) that write to /dev/tty — without it, SIGTTOU
  // would suspend the entire Electron process group and freeze the UI.
  //
  // UTF-8 encoding: previously used `chcp 65001 >nul && ${npxCommand}` on Windows
  // to switch the console code page. Now handled via environment variables
  // (PYTHONUTF8, LANG, LC_ALL, etc.) injected by prepareCleanEnv(), which
  // covers all major runtimes without requiring a cmd.exe code-page switch.
  const child = spawn(npxCommand, spawnArgs, {
    cwd: workingDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: cleanEnv,
    shell: isWindows,
    detached,
  });
  // Prevent the detached child from keeping the parent alive when the parent wants to exit normally.
  if (detached) {
    child.unref();
  }
  if (ACP_PERF_LOG) {
    console.log(`[ACP-PERF] ${backend}: process spawned ${Date.now() - spawnStart}ms (preferOffline=${preferOffline})`);
  }

  return { child, isDetached: detached };
}

/** Prepare clean env + resolve npx for Claude ACP bridge. */
function prepareClaude(customEnv?: Record<string, string>): NpxPrepareResult {
  const cleanEnv = prepareCleanEnv();
  if (customEnv) Object.assign(cleanEnv, customEnv);
  ensureMinNodeVersion(cleanEnv, 20, 10, 'Claude ACP bridge');
  return { cleanEnv, npxCommand: resolveNpxPath(cleanEnv) };
}

/** Prepare clean env + resolve npx + run diagnostics for Codex ACP bridge. */
async function prepareCodex(customEnv?: Record<string, string>): Promise<NpxPrepareResult> {
  const cleanEnv = prepareCleanEnv();
  if (customEnv) Object.assign(cleanEnv, customEnv);
  ensureMinNodeVersion(cleanEnv, 20, 10, 'Codex ACP bridge');

  const codexCommand = process.platform === 'win32' ? 'codex.cmd' : 'codex';
  const diagnostics: {
    bridgeVersion: string;
    bridgePackage: string;
    codexCliVersion: string;
    loginStatus: string;
    hasCodexApiKey: boolean;
    hasOpenAiApiKey: boolean;
    hasChatGptSession: boolean;
  } = {
    bridgeVersion: CODEX_ACP_BRIDGE_VERSION,
    bridgePackage: CODEX_ACP_NPX_PACKAGE,
    codexCliVersion: 'unknown',
    loginStatus: 'unknown',
    hasCodexApiKey: Boolean(cleanEnv.CODEX_API_KEY),
    hasOpenAiApiKey: Boolean(cleanEnv.OPENAI_API_KEY),
    hasChatGptSession: false,
  };

  try {
    const { stdout } = await execFile(codexCommand, ['--version'], {
      env: cleanEnv,
      timeout: 5000,
      windowsHide: true,
    });
    diagnostics.codexCliVersion = stdout.trim() || diagnostics.codexCliVersion;
  } catch (error) {
    mainWarn('[ACP codex]', 'Failed to read codex CLI version', error);
  }

  try {
    const { stdout } = await execFile(codexCommand, ['login', 'status'], {
      env: cleanEnv,
      timeout: 5000,
      windowsHide: true,
    });
    diagnostics.loginStatus = stdout.trim() || diagnostics.loginStatus;
    diagnostics.hasChatGptSession = /chatgpt/i.test(diagnostics.loginStatus);
  } catch (error) {
    mainWarn('[ACP codex]', 'Failed to read codex login status', error);
  }

  mainLog('[ACP codex]', 'Runtime diagnostics', diagnostics);
  return { cleanEnv, npxCommand: resolveNpxPath(cleanEnv) };
}

/** Prepare clean env + resolve npx + load MCP config for CodeBuddy. */
async function prepareCodebuddy(customEnv?: Record<string, string>): Promise<NpxPrepareResult> {
  const cleanEnv = prepareCleanEnv();
  if (customEnv) Object.assign(cleanEnv, customEnv);
  ensureMinNodeVersion(cleanEnv, 20, 10, 'CodeBuddy ACP');

  // Load user's MCP config if available (~/.codebuddy/mcp.json)
  // CodeBuddy CLI in --acp mode does not auto-load mcp.json, so we pass it explicitly
  const mcpConfigPath = path.join(os.homedir(), '.codebuddy', 'mcp.json');
  const extraArgs: string[] = [];
  try {
    await fs.access(mcpConfigPath);
    extraArgs.push('--mcp-config', mcpConfigPath);
    console.error(`[ACP] Loading CodeBuddy MCP config from ${mcpConfigPath}`);
  } catch {
    console.error('[ACP] No CodeBuddy MCP config found, starting without MCP servers');
  }

  return { cleanEnv, npxCommand: resolveNpxPath(cleanEnv), extraArgs };
}

/**
 * Read proxy credentials from sudocode.json auth_modes.proxy.sudorouter.
 * Returns apiKey and baseUrl (with /v1 suffix stripped since scode appends it).
 */
function readProxyCredsFromSudocode(): { apiKey: string; baseUrl: string } | null {
  try {
    const configPath = path.join(os.homedir(), '.nexus', 'sudocode', 'sudocode.json');
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    const sudorouter = config?.auth_modes?.proxy?.sudorouter;
    if (sudorouter && typeof sudorouter.apiKey === 'string' && typeof sudorouter.baseUrl === 'string') {
      const baseUrl = sudorouter.baseUrl.replace(/\/v1\/?$/, '');
      return { apiKey: sudorouter.apiKey, baseUrl };
    }
  } catch {
    // sudocode.json not found or unreadable — fall through
  }
  return null;
}

/**
 * Read Anthropic-compatible credentials from sudoclaw.json providers.
 * Looks for the first provider with api=anthropic-messages and returns
 * its apiKey and baseUrl (with /v1 suffix stripped since scode appends it).
 */
function readAnthropicCredsFromSudoclaw(): { apiKey: string; baseUrl: string } | null {
  try {
    const configPath = path.join(os.homedir(), '.nexus', 'sudoclaw', 'sudoclaw.json');
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    const providers = config?.models?.providers;
    if (!providers || typeof providers !== 'object') return null;
    for (const provider of Object.values(providers) as Array<Record<string, unknown>>) {
      if (provider.api === 'anthropic-messages' && typeof provider.apiKey === 'string' && typeof provider.baseUrl === 'string') {
        // Strip trailing /v1 since scode appends it internally
        const baseUrl = (provider.baseUrl as string).replace(/\/v1\/?$/, '');
        return { apiKey: provider.apiKey as string, baseUrl };
      }
    }
  } catch {
    // sudoclaw.json not found or unreadable — fall through
  }
  return null;
}

/**
 * Spawn a generic ACP backend with clean env and Node version check.
 * Many generic backends are Node.js CLIs (#!/usr/bin/env node) that break
 * when Electron's inherited env resolves to an old Node version.
 * Safe for native binaries too — they ignore NODE_OPTIONS and Node version checks.
 */
export async function spawnGenericBackend(backend: string, cliPath: string, workingDir: string, acpArgs?: string[], customEnv?: Record<string, string>): Promise<SpawnResult> {
  try {
    await fs.mkdir(workingDir, { recursive: true });
  } catch {
    // best-effort: if mkdir fails, let spawn report the actual error
  }

  const cleanEnv = prepareCleanEnv({
    injectSafetyHook: backend !== 'scode',
  });
  if (customEnv) {
    Object.assign(cleanEnv, customEnv);
  }

  const requestedScodeModel = backend === 'scode' && typeof cleanEnv.SUDOCODE_CURRENT_MODEL_ID === 'string' && cleanEnv.SUDOCODE_CURRENT_MODEL_ID.trim() ? cleanEnv.SUDOCODE_CURRENT_MODEL_ID.trim() : null;
  const scodeAuthMode = backend === 'scode' ? readScodeAuthModeFromDisk(requestedScodeModel) : null;

  // Inject proxy credentials for scode - scode uses PROXY_AUTH_TOKEN + PROXY_BASE_URL
  // for proxy mode, not ANTHROPIC_API_KEY (which triggers direct api.anthropic.com)
  if (backend === 'scode' && scodeAuthMode === 'proxy' && !cleanEnv.PROXY_AUTH_TOKEN && !cleanEnv.ANTHROPIC_API_KEY) {
    // Prefer sudocode.json, fallback to sudoclaw.json (transition period)
    const sudocodeCreds = readProxyCredsFromSudocode();
    const creds = sudocodeCreds ?? readAnthropicCredsFromSudoclaw();
    const source = sudocodeCreds ? 'sudocode.json' : 'sudoclaw.json';
    if (creds) {
      // Detect if baseUrl is a proxy (e.g., sudorouter) and use proxy env vars
      // Otherwise fall back to direct API key injection
      if (creds.baseUrl.includes('sudorouter') || creds.baseUrl.includes('proxy')) {
        cleanEnv.PROXY_AUTH_TOKEN = creds.apiKey;
        cleanEnv.PROXY_BASE_URL = creds.baseUrl;
        mainLog('[ACP scode]', `Injected proxy credentials (PROXY_AUTH_TOKEN) from ${source}`);
      } else {
        cleanEnv.ANTHROPIC_API_KEY = creds.apiKey;
        cleanEnv.ANTHROPIC_BASE_URL = creds.baseUrl;
        mainLog('[ACP scode]', `Injected Anthropic credentials from ${source}`);
      }
    }
  }

  // Inject SUDOCODE_CONFIG_PATH for scode so skill bash scripts can locate sudocode.json
  // even when claude-code overrides $HOME to a sandbox directory (.sandbox-home/).
  if (backend === 'scode' && !cleanEnv.SUDOCODE_CONFIG_PATH) {
    cleanEnv.SUDOCODE_CONFIG_PATH = path.join(os.homedir(), '.nexus', 'sudocode', 'sudocode.json');
    mainLog('[ACP scode]', `Injected SUDOCODE_CONFIG_PATH: ${cleanEnv.SUDOCODE_CONFIG_PATH}`);
  }

  // Inject image generation config as env vars for skill bash scripts.
  // On Windows with WSL bash, SUDOCODE_CONFIG_PATH (Windows path) is unreadable,
  // so we pass the resolved values directly via IMAGE_MODEL / PROVIDER_BASE_URL / PROVIDER_API_KEY.
  if (backend === 'scode' && !cleanEnv.IMAGE_MODEL) {
    try {
      const { resolveImageConfig } = await import('@process/bridge/imageGenerationBridge');
      const imageConfig = await resolveImageConfig();
      if (imageConfig) {
        cleanEnv.IMAGE_MODEL = imageConfig.model;
        cleanEnv.PROVIDER_BASE_URL = imageConfig.baseUrl;
        cleanEnv.PROVIDER_API_KEY = imageConfig.apiKey;
        mainLog('[ACP scode]', `Injected image gen env: IMAGE_MODEL=${imageConfig.model}, PROVIDER_BASE_URL=${imageConfig.baseUrl}`);
      } else {
        mainLog('[ACP scode]', 'No image generation config found, skipping IMAGE_MODEL/PROVIDER injection');
      }
    } catch (e) {
      mainLog('[ACP scode]', `Failed to inject image gen env: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Inject HOME for scode (Rust binary) to locate ~/.nexus/sudocode/sudocode.json
  // On Windows packaged Electron, HOME is not set (Windows uses USERPROFILE instead)
  // scode has 5+ paths that depend on HOME without USERPROFILE fallback
  if (backend === 'scode' && !cleanEnv.HOME) {
    cleanEnv.HOME = os.homedir();
    mainLog('[ACP scode]', `Injected HOME: ${cleanEnv.HOME}`);
  }

  // Inject web search base URL for scode so WebSearch tool is available in ACP mode
  if (backend === 'scode' && !cleanEnv.SUDOCODE_WEB_SEARCH_BASE_URL) {
    cleanEnv.SUDOCODE_WEB_SEARCH_BASE_URL = 'https://html.duckduckgo.com/html/';
    mainLog('[ACP scode]', 'Injected SUDOCODE_WEB_SEARCH_BASE_URL (DuckDuckGo)');
  }

  // Inject Claude Code OAuth token for scode subscription auth if available
  if (backend === 'scode' && !cleanEnv.CLAUDE_CODE_OAUTH_TOKEN) {
    try {
      const keychain = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-a', os.userInfo().username, '-w'], { encoding: 'utf-8', timeout: 3000 }).trim();
      const payload = JSON.parse(keychain);
      if (payload?.claudeAiOauth?.accessToken) {
        cleanEnv.CLAUDE_CODE_OAUTH_TOKEN = payload.claudeAiOauth.accessToken;
        mainLog('[ACP scode]', 'Injected Claude Code OAuth token from keychain');
      }
    } catch {
      // Claude Code credentials not available — scode will use other auth methods
    }
  }

  // Ensure settings.json model is valid before spawning scode.
  // scode reads settings.json on startup and crashes (exit 1) if the model is not in sudocode.json models.
  // This prevents a death loop: crash → reconnect → read bad settings.json → crash again.
  if (backend === 'scode') {
    try {
      const scodeDir = path.join(os.homedir(), '.nexus', 'sudocode');
      const settingsPath = path.join(scodeDir, 'settings.json');
      let settings: Record<string, unknown> = {};
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      } catch {
        /* no settings */
      }
      const scodeConfigPath = path.join(scodeDir, 'sudocode.json');
      let scodeConfig: Record<string, unknown> = {};
      try {
        scodeConfig = JSON.parse(readFileSync(scodeConfigPath, 'utf-8'));
      } catch {
        /* no config */
      }
      const availableModels = scodeConfig.models && typeof scodeConfig.models === 'object' ? Object.keys(scodeConfig.models as Record<string, unknown>) : [];
      const currentModel = typeof settings.model === 'string' ? settings.model : undefined;
      if (requestedScodeModel && availableModels.includes(requestedScodeModel) && currentModel !== requestedScodeModel) {
        settings.model = requestedScodeModel;
        mkdirSync(scodeDir, { recursive: true });
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
        mainLog('[ACP scode]', `Synced settings.json model to requested model "${requestedScodeModel}" before spawn`);
      } else if (requestedScodeModel && availableModels.length > 0 && !availableModels.includes(requestedScodeModel)) {
        mainWarn('[ACP scode]', `Requested model "${requestedScodeModel}" is not in sudocode.json models`);
      }

      const effectiveCurrentModel = typeof settings.model === 'string' ? settings.model : currentModel;
      if (effectiveCurrentModel && availableModels.length > 0 && !availableModels.includes(effectiveCurrentModel)) {
        settings.model = availableModels[0];
        mkdirSync(scodeDir, { recursive: true });
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
        mainLog('[ACP scode]', `Corrected settings.json model from "${effectiveCurrentModel}" to "${availableModels[0]}"`);
      }
    } catch {
      /* best-effort */
    }
  }

  ensureMinNodeVersion(cleanEnv, 18, 17, `${backend} ACP`);

  const spawnStart = Date.now();
  const effectiveAcpArgs = backend === 'scode' ? resolveScodeAcpArgs(cliPath, acpArgs, cleanEnv, scodeAuthMode) : acpArgs;
  if (backend === 'scode' && scodeAuthMode && effectiveAcpArgs !== acpArgs) {
    mainLog('[ACP scode]', `Using ${scodeAuthMode} auth mode for current model`);
  }
  const config = createGenericSpawnConfig(cliPath, workingDir, effectiveAcpArgs, undefined, cleanEnv as Record<string, string>);
  const child = spawn(config.command, config.args, config.options);
  if (ACP_PERF_LOG) console.log(`[ACP-PERF] connect: ${backend} process spawned ${Date.now() - spawnStart}ms`);

  return { child, isDetached: false };
}

/** Callbacks for wiring a spawned child into the AcpConnection instance. */
export type NpxConnectHooks = {
  /** Wire the spawned child into the connection (e.g. attach protocol handlers). */
  setup: (result: SpawnResult) => Promise<void>;
  /** Terminate a failed Phase-1 child before retrying. */
  cleanup: () => Promise<void>;
};

/**
 * Connect to an npx-based ACP backend with Phase 1/2 retry strategy.
 * Phase 1: --prefer-offline for fast startup (~1-2s).
 * Phase 2: fresh registry lookup on failure (~3-5s).
 */
async function connectNpxBackend(config: {
  backend: string;
  npxPackage: string;
  prepareFn: () => NpxPrepareResult | Promise<NpxPrepareResult>;
  workingDir: string;
  /** Wire the spawned child into the connection (e.g. attach protocol handlers). */
  setup: (result: SpawnResult) => Promise<void>;
  /** Terminate a failed Phase-1 child before retrying. */
  cleanup: () => Promise<void>;
  extraArgs?: string[];
  detached?: boolean;
}): Promise<void> {
  const { backend, npxPackage, prepareFn, workingDir, setup, cleanup } = config;

  const envStart = Date.now();
  const { cleanEnv, npxCommand, extraArgs: prepExtraArgs = [] } = await prepareFn();
  if (ACP_PERF_LOG) console.log(`[ACP-PERF] ${backend}: env prepared ${Date.now() - envStart}ms`);

  const isWindows = process.platform === 'win32';
  const opts = {
    extraArgs: [...(config.extraArgs ?? []), ...prepExtraArgs],
    detached: config.detached ?? false,
  };

  // Phase 1: Try with --prefer-offline for fast startup
  try {
    await setup(spawnNpxBackend(backend, npxPackage, npxCommand, cleanEnv, workingDir, isWindows, true, opts));
  } catch (firstError) {
    // Phase 2: Retry without --prefer-offline to refresh stale cache
    console.warn(`[ACP] ${backend} --prefer-offline failed, retrying with fresh registry lookup:`, firstError instanceof Error ? firstError.message : String(firstError));

    await cleanup();

    await setup(spawnNpxBackend(backend, npxPackage, npxCommand, cleanEnv, workingDir, isWindows, false, opts));
  }
}

// ── Exported per-backend connect functions ───────────────────────────

/** Connect to Claude ACP bridge via npx. */
export function connectClaude(workingDir: string, hooks: NpxConnectHooks, customEnv?: Record<string, string>): Promise<void> {
  return connectNpxBackend({ backend: 'claude', npxPackage: CLAUDE_ACP_NPX_PACKAGE, prepareFn: () => prepareClaude(customEnv), workingDir, ...hooks });
}

/** Connect to Codex ACP bridge via npx. */
export function connectCodex(workingDir: string, hooks: NpxConnectHooks, customEnv?: Record<string, string>): Promise<void> {
  return connectNpxBackend({ backend: 'codex', npxPackage: CODEX_ACP_NPX_PACKAGE, prepareFn: () => prepareCodex(customEnv), workingDir, ...hooks });
}

/** Connect to CodeBuddy ACP via npx. */
export function connectCodebuddy(workingDir: string, hooks: NpxConnectHooks, customEnv?: Record<string, string>): Promise<void> {
  return connectNpxBackend({ backend: 'codebuddy', npxPackage: CODEBUDDY_ACP_NPX_PACKAGE, prepareFn: () => prepareCodebuddy(customEnv), workingDir, ...hooks, extraArgs: ['--acp'], detached: process.platform !== 'win32' });
}
