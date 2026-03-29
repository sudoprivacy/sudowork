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

  // ── loginGetAuthUrl ──────────────────────────────────────────────────────────
  // Step 1: get the OAuth auth URL from bdpan
  ipcBridge.bdpan.loginGetAuthUrl.provider(async () => {
    const { stdout, stderr, code } = await runBdpan(['login', '--accept-disclaimer', '--get-auth-url', '--json']);
    mainLog('Bdpan', `loginGetAuthUrl exit=${code} stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`);
    const json = parseLastJson(stdout) as Record<string, unknown> | null;
    mainLog('Bdpan', `loginGetAuthUrl parsed json=${JSON.stringify(json)}`);
    // auth_url is nested under json.data; error is at top level (empty string means no error)
    const authUrl = json && !Array.isArray(json) && (json['data'] as Record<string, unknown>)?.['auth_url'];
    if (authUrl) {
      return { success: true, data: { auth_url: String(authUrl) } };
    }
    const errMsg = (json && !Array.isArray(json) && json['error']) ? String(json['error']) : (stderr || stdout || 'Failed to get auth URL');
    mainError('Bdpan', `loginGetAuthUrl failed: ${errMsg}`);
    return { success: false, data: { error: errMsg } };
  });

  // ── loginSetCode ─────────────────────────────────────────────────────────────
  // Step 2: submit the auth code the user retrieved from browser
  ipcBridge.bdpan.loginSetCode.provider(async ({ code }) => {
    const { stdout, stderr, code: exitCode } = await runBdpan(['login', '--set-code', code, '--json']);
    mainLog('Bdpan', `loginSetCode exit=${exitCode} stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`);
    const json = parseLastJson(stdout) as Record<string, unknown> | null;
    // Success: exit 0 AND no non-empty error field
    const errField = json && !Array.isArray(json) ? String(json['error'] ?? '') : '';
    if (exitCode === 0 && !errField) {
      return { success: true, data: { type: 'success' } };
    }
    const errMsg = errField || stderr || stdout || 'Login failed';
    mainError('Bdpan', `loginSetCode failed: ${errMsg}`);
    return { success: false, data: { type: 'error', message: errMsg } };
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
    const { stdout, stderr } = await runBdpan(['download', remotePath, localPath, '--json']);
    const json = parseLastJson(stdout) as Record<string, unknown> | null;
    if (!json || json['code'] !== 0) {
      const errMsg = (json?.['error'] as string | undefined) || stderr || stdout || 'bdpan download failed';
      mainError('Bdpan', `download failed: ${errMsg}`);
      return { success: false, data: { localPath: '' } };
    }
    mainLog('Bdpan', `downloaded ${remotePath} → ${localPath}`);
    return { success: true, data: { localPath } };
  });

  // ── upload ───────────────────────────────────────────────────────────────────
  ipcBridge.bdpan.upload.provider(async ({ localPath, remotePath }) => {
    const { stdout, stderr, code } = await runBdpan(['upload', localPath, remotePath, '--json']);
    mainLog('Bdpan', `upload exit=${code} stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`);
    if (code === 0) {
      return { success: true, data: {} };
    }
    const json = parseLastJson(stdout) as Record<string, unknown> | null;
    const errMsg = (json?.['error'] as string | undefined) || (json?.['message'] as string | undefined) || stderr || stdout || 'bdpan upload failed';
    mainError('Bdpan', `upload failed: ${errMsg}`);
    return { success: false, data: { error: errMsg } };
  });

  // ── mkdir ────────────────────────────────────────────────────────────────────
  ipcBridge.bdpan.mkdir.provider(async ({ path: dirPath }) => {
    const { stdout, stderr, code } = await runBdpan(['mkdir', dirPath, '--json']);
    mainLog('Bdpan', `mkdir exit=${code} stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`);
    const json = parseLastJson(stdout) as Record<string, unknown> | null;
    const jsonCode = json ? (json['code'] as number | undefined) : undefined;
    if (code === 0 && (jsonCode === undefined || jsonCode === 0)) {
      return { success: true, data: {} };
    }
    const errMsg = (json?.['error'] as string | undefined) || (json?.['message'] as string | undefined) || stderr || stdout || 'bdpan mkdir failed';
    mainError('Bdpan', `mkdir failed: ${errMsg}`);
    return { success: false, data: { error: errMsg } };
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
