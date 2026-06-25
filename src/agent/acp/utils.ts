/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChildProcess } from 'child_process';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { promises as fsAsync } from 'fs';
import * as os from 'os';
import * as path from 'path';

const execFile = promisify(execFileCb);

// ── Process utilities ───────────────────────────────────────────────

/** Check whether a process with the given PID is still running. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll until a process exits or the timeout expires. */
export async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Gracefully kill a child process with platform-specific handling.
 *
 * This is the *graceful* termination path: SIGTERM first, escalate to SIGKILL
 * if the process doesn't exit in time. It is called during normal application
 * shutdown (before-quit → WorkerManage.clear → AcpAgent.kill).
 *
 * The ProcessSupervisor provides a separate, *synchronous* safety net via
 * `process.on('exit')` that force-kills all tracked children. So even if this
 * async function never completes (timeout, crash, etc.), children will still
 * be cleaned up by the OS-level exit handler.
 *
 * 优雅终止子进程。先发 SIGTERM，超时后升级为 SIGKILL。
 * ProcessSupervisor 通过 process.on('exit') 提供同步安全网，即使本函数
 * 未能完成，子进程也会被清理。
 */
export async function killChild(child: ChildProcess, isDetached: boolean): Promise<void> {
  const pid = child.pid;
  if (process.platform === 'win32' && pid) {
    try {
      await execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
    } catch {
      // Process may already be dead
    }
    await waitForProcessExit(pid, 3000);
  } else if (isDetached && pid) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    await waitForProcessExit(pid, 2000);
    if (isProcessAlive(pid)) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already dead */
        }
      }
    }
  } else {
    child.kill('SIGTERM');
    if (pid) {
      await waitForProcessExit(pid, 2000);
      if (isProcessAlive(pid)) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already dead */
        }
      }
    }
  }
}

// ── File I/O utilities ──────────────────────────────────────────────

/** Read a text file from the filesystem. */
export async function readTextFile(filePath: string): Promise<{ content: string }> {
  try {
    const content = await fsAsync.readFile(filePath, 'utf-8');
    return { content };
  } catch (error) {
    throw new Error(`Failed to read file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Write a text file and emit a file-stream update to the preview panel. */
export async function writeTextFile(filePath: string, content: string): Promise<null> {
  try {
    await fsAsync.mkdir(path.dirname(filePath), { recursive: true });
    await fsAsync.writeFile(filePath, content, 'utf-8');

    // Send streaming content update to preview panel (for real-time updates)
    try {
      const { ipcBridge } = await import('@/common');
      const pathSegments = filePath.split(path.sep);
      const fileName = pathSegments[pathSegments.length - 1];
      const workspace = pathSegments.slice(0, -1).join(path.sep);

      ipcBridge.fileStream.contentUpdate.emit({
        filePath,
        content,
        workspace,
        relativePath: fileName,
        operation: 'write' as const,
      });
    } catch (emitError) {
      console.error('[ACP] Failed to emit file stream update:', emitError);
    }

    return null;
  } catch (error) {
    throw new Error(`Failed to write file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ── JSON-RPC I/O ────────────────────────────────────────────────────

/** Write a JSON-RPC message to a child process stdin (newline-delimited). */
export function writeJsonRpcMessage(child: ChildProcess, message: object): void {
  if (child.stdin) {
    const lineEnding = process.platform === 'win32' ? '\r\n' : '\n';
    child.stdin.write(JSON.stringify(message) + lineEnding);
  }
}

/** Write a JSON-RPC message using LSP Content-Length framing. */
export function writeJsonRpcMessageLsp(child: ChildProcess, message: object): void {
  if (child.stdin) {
    const body = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    child.stdin.write(header + body);
  }
}

// ── Agent settings ──────────────────────────────────────────────────

export interface ClaudeSettings {
  env?: {
    ANTHROPIC_MODEL?: string;
    [key: string]: string | undefined;
  };
}

/**
 * Get Claude settings file path (cross-platform)
 * - macOS/Linux: ~/.claude/settings.json
 * - Windows: %USERPROFILE%\.claude\settings.json
 */
export function getClaudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

/**
 * Read Claude settings from settings.json
 */
export function readClaudeSettings(): ClaudeSettings | null {
  try {
    const settingsPath = getClaudeSettingsPath();
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const content = fs.readFileSync(settingsPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Get ANTHROPIC_MODEL from Claude settings (under env object)
 */
export function getClaudeModel(): string | null {
  const settings = readClaudeSettings();
  return settings?.env?.ANTHROPIC_MODEL ?? null;
}

// --- CodeBuddy settings support ---
// Note: CodeBuddy settings (~/.codebuddy/settings.json) contains sandbox/trust config,
// NOT model preferences. Model selection is handled by the CLI itself.
// MCP servers are configured in ~/.codebuddy/mcp.json
