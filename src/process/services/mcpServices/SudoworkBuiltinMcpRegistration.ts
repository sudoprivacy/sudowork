/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import { safeExec } from '@process/utils/safeExec';
import { getNodeBinaryPath } from '@process/services/claudeCli/NodeRuntimeService';
import { mainError, mainLog, mainWarn } from '@process/utils/mainLogger';

/**
 * Auto-register the sudowork-browser MCP server into the user's Claude Code
 * config so Claude can spawn it as a stdio MCP subprocess.
 *
 * Lifecycle:
 *  - Called once per app boot, AFTER bundled Node and Claude CLI are installed
 *    (see CliInstallService).
 *  - `claude mcp list` is parsed for our entry. If absent or pointing at a
 *    stale path, we `claude mcp remove` + `claude mcp add`. Same `name` keeps
 *    the entry stable across upgrades.
 *  - Errors are logged but never re-thrown — registration failure must not
 *    block startup. The user can fall back to /browser slash commands.
 *  - We do NOT clean up on sudowork uninstall (Electron has no uninstall
 *    hook). The MCP child returns a structured browser_unavailable error
 *    when the loopback HTTP server isn't reachable, so the stale entry
 *    degrades gracefully rather than crashing Claude.
 */

const MCP_NAME = 'sudowork-browser';
const TIMEOUT_MS = 15_000;

const getExecEnv = () => ({ env: { ...getEnhancedEnv(), NODE_OPTIONS: '', TERM: 'dumb', NO_COLOR: '1' } as NodeJS.ProcessEnv });

/** Resolve the path to the bundled MCP server entry JS in both dev and packaged modes. */
function getMcpScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'sudowork-browser-mcp', 'index.js');
  }
  return path.join(app.getAppPath(), 'resources', 'sudowork-browser-mcp', 'index.js');
}

/** Discovery file the MCP child reads to find the sudowork main loopback server. */
function getDiscoveryFilePath(): string {
  return path.join(app.getPath('userData'), 'sudowork-browser-mcp.json');
}

interface ExistingEntry {
  present: boolean;
  /** Raw line text — used for mismatch detection. */
  rawLine?: string;
}

async function detectExistingEntry(): Promise<ExistingEntry> {
  try {
    const { stdout } = await safeExec('claude mcp list', { timeout: TIMEOUT_MS, ...getExecEnv() });
    if (!stdout || stdout.includes('No MCP servers configured')) return { present: false };
    /* eslint-disable no-control-regex */
    const lines = stdout
      .split('\n')
      .map((line) => line.replace(/\[[0-9;]*m/g, '').replace(/\[[0-9;]*m/g, '').trim())
      .filter(Boolean);
    /* eslint-enable no-control-regex */
    for (const line of lines) {
      if (line.startsWith(`${MCP_NAME}:`)) {
        return { present: true, rawLine: line };
      }
    }
    return { present: false };
  } catch (err) {
    mainWarn('SudoworkBuiltinMcp', `claude mcp list failed: ${String(err)}`);
    return { present: false };
  }
}

function quoteForShell(s: string): string {
  return `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
}

async function addEntry(scriptPath: string, nodePath: string): Promise<void> {
  // claude mcp add -s user <name> -- <command> [args...]
  //
  // We intentionally do NOT pass `-e SUDOWORK_BROWSER_MCP_DISCOVERY=...`
  // here: claude's CLI uses commander's variadic env flag (`-e <env...>`),
  // which greedily consumes the following positional name. The MCP server
  // already falls back to the platform-default discovery path
  // (~/Library/Application Support/sudowork/sudowork-browser-mcp.json on
  // macOS, %APPDATA%/sudowork/... on Windows, $XDG_CONFIG_HOME/sudowork/...
  // on Linux), which matches what BrowserPanelHttpServer writes via
  // app.getPath('userData'). The discovery env override is still honored
  // by the child when set externally (tests, custom installs).
  const cmd = `claude mcp add -s user ${quoteForShell(MCP_NAME)} -- ${quoteForShell(nodePath)} ${quoteForShell(scriptPath)}`;
  mainLog('SudoworkBuiltinMcp', `claude mcp add ${MCP_NAME}: ${cmd}`);
  await safeExec(cmd, { timeout: TIMEOUT_MS, ...getExecEnv() });
}

async function removeEntry(): Promise<void> {
  const cmd = `claude mcp remove -s user ${quoteForShell(MCP_NAME)}`;
  try {
    await safeExec(cmd, { timeout: TIMEOUT_MS, ...getExecEnv() });
  } catch (err) {
    mainWarn('SudoworkBuiltinMcp', `claude mcp remove (precondition) failed: ${String(err)}`);
  }
}

/**
 * Ensure the sudowork-browser MCP server is registered with Claude Code.
 * Idempotent and non-throwing — safe to call from startup paths.
 */
export async function ensureSudoworkBuiltinMcpInstalled(): Promise<void> {
  try {
    const scriptPath = getMcpScriptPath();
    if (!fs.existsSync(scriptPath)) {
      mainWarn('SudoworkBuiltinMcp', `bundled MCP script not found at ${scriptPath} — skipping registration`);
      return;
    }
    const nodePath = getNodeBinaryPath();
    if (!fs.existsSync(nodePath)) {
      mainWarn('SudoworkBuiltinMcp', `bundled node not found at ${nodePath} — skipping registration`);
      return;
    }

    const discoveryFilePath = getDiscoveryFilePath();
    void discoveryFilePath; // reserved for future env injection if claude's CLI gains a non-variadic env flag
    const existing = await detectExistingEntry();
    const expectedNeedle = scriptPath; // we re-add whenever the path doesn't appear in the entry line

    if (existing.present && existing.rawLine && existing.rawLine.includes(expectedNeedle) && existing.rawLine.includes(nodePath)) {
      mainLog('SudoworkBuiltinMcp', `entry already current: ${existing.rawLine}`);
      return;
    }

    if (existing.present) {
      mainLog('SudoworkBuiltinMcp', `entry stale, re-adding: ${existing.rawLine}`);
      await removeEntry();
    } else {
      mainLog('SudoworkBuiltinMcp', 'entry missing, adding…');
    }

    await addEntry(scriptPath, nodePath);
    mainLog('SudoworkBuiltinMcp', 'registration complete');
  } catch (err) {
    mainError('SudoworkBuiltinMcp', `unexpected failure: ${String(err)}`);
    // Swallow — must not block startup.
  }
}
