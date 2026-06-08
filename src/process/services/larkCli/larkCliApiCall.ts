/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { getDataPath } from '@/process/utils';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * Shell out to bundled `lark-cli api <method> <path>` and parse the JSON response.
 *
 * Used both from inside the live LarkPlugin instance and from IPC handlers that need to
 * exercise a user-scope API without a running plugin (e.g. the "Test OAuth" button).
 */
export async function callLarkCliApi(method: Method, apiPath: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const bin = path.join(getDataPath(), 'bin', process.platform === 'win32' ? 'lark-cli.cmd' : 'lark-cli');
  if (!fs.existsSync(bin)) {
    throw new Error(`lark-cli not found at ${bin}`);
  }
  const args = ['api', method, apiPath];
  if (body !== undefined) {
    args.push('--data', JSON.stringify(body));
  }
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      reject(new Error(`lark-cli api ${method} ${apiPath} timed out after 30s`));
    }, 30_000);
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`lark-cli api exited with code ${code}: ${(stderr || stdout).slice(-300)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch (err) {
        reject(new Error(`lark-cli api returned non-JSON: ${(err as Error).message}; raw=${stdout.slice(0, 300)}`));
      }
    });
  });
}

/**
 * Fetch the OAuth user identity (the human who completed lark-cli's QR login).
 * Uses /open-apis/authen/v1/user_info with whatever user_access_token lark-cli currently
 * holds. Returns null if the call fails or returns no usable identity.
 *
 * Soft-fail variant — discards error detail. Use {@link fetchLarkCliUserInfoOrThrow} when
 * the caller (e.g. the "Test OAuth" button) needs to surface the underlying error.
 */
export async function fetchLarkCliUserInfo(): Promise<{ name?: string; openId?: string; email?: string } | null> {
  try {
    return await fetchLarkCliUserInfoOrThrow();
  } catch {
    return null;
  }
}

export async function fetchLarkCliUserInfoOrThrow(): Promise<{ name?: string; openId?: string; email?: string }> {
  const resp = await callLarkCliApi('GET', '/open-apis/authen/v1/user_info');
  // Feishu Open API: { code: 0, msg: 'success', data: { name, open_id, ... } }
  const code = (resp as { code?: number }).code;
  if (typeof code === 'number' && code !== 0) {
    const msg = (resp as { msg?: string }).msg ?? 'unknown error';
    throw new Error(`Feishu API error code=${code}: ${msg}`);
  }
  const data = (resp as { data?: Record<string, unknown> }).data;
  if (!data) {
    throw new Error('Feishu API returned no data');
  }
  return {
    name: typeof data.name === 'string' ? data.name : undefined,
    openId: typeof data.open_id === 'string' ? data.open_id : undefined,
    email: typeof data.email === 'string' ? data.email : undefined,
  };
}
