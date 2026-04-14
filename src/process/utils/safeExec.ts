/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TTY-safe command execution utilities.
 *
 * Uses `child_process.spawn` with `detached: true` so each child runs in its
 * own process group.  This prevents CLI tools that write to `/dev/tty`
 * (e.g. `gemini mcp add`, `claude mcp remove`) from triggering SIGTTOU on
 * the parent Electron process, which would otherwise cause:
 *   zsh: suspended (tty output)  npm start
 */

import { spawn } from 'child_process';
import { platform } from 'os';

type ExecResult = { stdout: string; stderr: string };

interface SafeExecOptions {
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Get the appropriate shell for the current platform.
 * - Unix (darwin, linux): uses 'sh'
 * - Windows: uses 'cmd.exe'
 */
function getShell(): { shell: string; flag: string } {
  if (platform() === 'win32') {
    return { shell: 'cmd.exe', flag: '/c' };
  }
  return { shell: 'sh', flag: '-c' };
}

/**
 * Shell-based command execution (replacement for `child_process.exec`).
 * Runs the command in a shell with `detached: true` for cross-platform compatibility.
 */
export function safeExec(command: string, options: SafeExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const { shell, flag } = getShell();
    const child = spawn(shell, [flag, command], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = options.timeout
      ? setTimeout(() => {
          if (!settled) {
            settled = true;
            // Kill the entire process group (negative PID)
            try {
              process.kill(-child.pid!, 'SIGTERM');
            } catch {
              /* already exited */
            }
            reject(Object.assign(new Error(`Command timed out after ${options.timeout}ms`), { stdout, stderr, killed: true }));
          }
        }, options.timeout)
      : null;

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        reject(err);
      }
    });

    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(Object.assign(new Error(`Command failed with exit code ${code}`), { stdout, stderr, code }));
        }
      }
    });

    // Don't let the detached child prevent Node from exiting
    child.unref();
  });
}

/**
 * Direct executable invocation (replacement for `child_process.execFile`).
 * Does NOT use a shell — safer against injection.
 */
export function safeExecFile(file: string, args: string[], options: SafeExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = options.timeout
      ? setTimeout(() => {
          if (!settled) {
            settled = true;
            try {
              process.kill(-child.pid!, 'SIGTERM');
            } catch {
              /* already exited */
            }
            reject(Object.assign(new Error(`Command timed out after ${options.timeout}ms`), { stdout, stderr, killed: true }));
          }
        }, options.timeout)
      : null;

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        reject(err);
      }
    });

    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        if (timer) clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(Object.assign(new Error(`Command failed with exit code ${code}`), { stdout, stderr, code }));
        }
      }
    });

    child.unref();
  });
}
