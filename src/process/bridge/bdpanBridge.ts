/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { ipcBridge } from '../../common';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';

/** Resolves bdpan binary path — respects PATH including ~/.local/bin */
function getBdpanPath(): string {
  // Ensure ~/.local/bin is on PATH for Electron which may not inherit shell PATH
  const localBin = `${os.homedir()}/.local/bin`;
  if (!process.env.PATH?.includes(localBin)) {
    process.env.PATH = `${localBin}:${process.env.PATH ?? ''}`;
  }
  return 'bdpan';
}

/** Run `bdpan <args> --json` and collect full stdout/stderr */
function runBdpan(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const bin = getBdpanPath();
    mainLog('Bdpan', `Running: bdpan ${args.join(' ')}`);
    const child = spawn(bin, args, {
      env: { ...process.env, HOME: os.homedir() },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    child.on('error', (err) => {
      mainError('Bdpan', `spawn error: ${err.message}`);
      resolve({ stdout: '', stderr: err.message, code: 1 });
    });
  });
}

/** Parse the last complete JSON value (object or array) from a potentially multi-line output */
function parseLastJson(text: string): unknown {
  const lines = text.trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {}
  }
  // Try parsing full text as single JSON blob
  try {
    return JSON.parse(text.trim());
  } catch {}
  return null;
}

export function initBdpanBridge(): void {
  // ── whoami ──────────────────────────────────────────────────────────────────
  ipcBridge.bdpan.whoami.provider(async () => {
    const { stdout, stderr, code } = await runBdpan(['whoami', '--json']);
    if (code !== 0) {
      return { success: false, data: { authenticated: false, has_valid_token: false, error: stderr || 'bdpan whoami failed' } };
    }
    const json = parseLastJson(stdout) as Record<string, unknown> | null;
    if (!json || Array.isArray(json)) {
      return { success: false, data: { authenticated: false, has_valid_token: false, error: 'Invalid JSON from bdpan whoami' } };
    }
    return {
      success: true,
      data: {
        authenticated: json['authenticated'] === true,
        has_valid_token: json['has_valid_token'] === true,
        username: json['username'] as string | undefined,
        error: json['error'] as string | undefined,
      },
    };
  });

  // ── loginInteractive ─────────────────────────────────────────────────────────
  // Spawns bdpan login, intercepts the auth URL to open in system browser,
  // then sends the auth code via stdin and waits for final result.
  ipcBridge.bdpan.loginInteractive.provider(async () => {
    return new Promise((resolve) => {
      const bin = getBdpanPath();
      const child = spawn(bin, ['login', '--accept-disclaimer', '--json'], {
        env: { ...process.env, HOME: os.homedir() },
      });

      let stdout = '';
      let resolved = false;

      const done = (result: { success: boolean; data: { type: string; message?: string } }) => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        mainLog('Bdpan', `login stdout: ${text.trim()}`);

        // Check for success/error JSON in line
        for (const line of text.split('\n').filter(Boolean)) {
          const json = parseLastJson(line) as Record<string, unknown> | null;
          if (json && !Array.isArray(json) && (json['message'] === '登录成功' || json['authenticated'] === true || json['success'] === true)) {
            done({ success: true, data: { type: 'success' } });
          } else if (json && !Array.isArray(json) && json['error']) {
            done({ success: false, data: { type: 'error', message: String(json['error']) } });
          } else if (line.includes('登录成功') || line.includes('授权成功')) {
            done({ success: true, data: { type: 'success' } });
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        mainWarn('Bdpan', `login stderr: ${chunk.toString().trim()}`);
      });

      child.on('close', (code) => {
        if (code === 0) {
          done({ success: true, data: { type: 'success' } });
        } else {
          const json = parseLastJson(stdout) as Record<string, unknown> | null;
          const errMsg = json && !Array.isArray(json) && json['error'] ? String(json['error']) : null;
          done({ success: false, data: { type: 'error', message: errMsg ?? '' } });
        }
      });

      child.on('error', (err) => {
        done({ success: false, data: { type: 'error', message: err.message } });
      });
    });
  });

  // ── logout ───────────────────────────────────────────────────────────────────
  ipcBridge.bdpan.logout.provider(async () => {
    const { code } = await runBdpan(['logout', '--json']);
    return { success: code === 0, data: { success: code === 0 } };
  });

  // ── download ─────────────────────────────────────────────────────────────────
  // Downloads a remote bdpan file to destDir, using the remote filename.
  ipcBridge.bdpan.download.provider(async ({ remotePath, destDir }) => {
    const filename = remotePath.split('/').filter(Boolean).pop() ?? 'bdpan_file';
    const localPath = path.join(destDir, filename);
    const { stdout, stderr, code } = await runBdpan(['download', remotePath, localPath, '--json']);
    if (code !== 0) {
      mainError('Bdpan', `download failed: ${stderr || stdout}`);
      return { success: false, data: { localPath: '' } };
    }
    mainLog('Bdpan', `downloaded ${remotePath} → ${localPath}`);
    return { success: true, data: { localPath } };
  });

  // ── ls ───────────────────────────────────────────────────────────────────────
  ipcBridge.bdpan.ls.provider(async ({ path: dirPath }) => {
    const { stdout, stderr, code } = await runBdpan(['ls', dirPath, '--json']);
    if (code !== 0) {
      return { success: false, data: { files: [], error: stderr || 'bdpan ls failed' } };
    }
    const json = parseLastJson(stdout);
    if (!json) {
      return { success: false, data: { files: [], error: 'Invalid JSON from bdpan ls' } };
    }
    // bdpan ls returns a top-level array; also handle object wrappers for robustness
    const rawList: unknown[] = Array.isArray(json)
      ? json
      : (((json as Record<string, unknown>)['list'] ?? (json as Record<string, unknown>)['files'] ?? (json as Record<string, unknown>)['data'] ?? []) as unknown[]);
    const files: BdpanFileEntry[] = rawList.map((item) => {
      const r = item as Record<string, unknown>;
      return {
        filename: (r['server_filename'] ?? r['filename'] ?? '') as string,
        path: r['path'] as string,
        isdir: r['isdir'] === true || r['isdir'] === 1,
        size: (r['size'] as number) ?? 0,
        server_mtime: (r['server_mtime'] as number) ?? 0,
      };
    });
    return { success: true, data: { files } };
  });
}

export interface BdpanFileEntry {
  filename: string;
  path: string;
  isdir: boolean;
  size: number;
  server_mtime: number;
}
