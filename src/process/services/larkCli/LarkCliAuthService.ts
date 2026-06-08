/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { getDataPath } from '@/process/utils';
import { mainLog, mainWarn } from '@/process/utils/mainLogger';

const TAG = 'LarkCliAuth';

export type LarkBrand = 'feishu' | 'lark';

export interface ILarkCliStartSuccess {
  ok: true;
  verificationUrl: string;
  userCode: string;
  deviceCode: string;
  expiresAt: number;
  intervalMs: number;
}

export interface ILarkCliStartFailure {
  ok: false;
  error: string;
  hint?: string;
}

export type LarkCliStartResult = ILarkCliStartSuccess | ILarkCliStartFailure;

export interface ILarkCliPollResult {
  status: 'pending' | 'success' | 'failed' | 'expired';
  user?: { id?: string; name?: string };
  token?: { accessToken: string; refreshToken?: string; expiresAt?: number };
  error?: string;
}

export interface ILarkCliStatus {
  installed: boolean;
  binPath: string;
  configured: boolean;
  loggedIn: boolean;
  user?: { id?: string; name?: string };
}

interface IRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  parsed?: Record<string, unknown>;
}

class LarkCliAuthService {
  getBinPath(): string {
    const exe = process.platform === 'win32' ? 'lark-cli.cmd' : 'lark-cli';
    return path.join(getDataPath(), 'bin', exe);
  }

  isInstalled(): boolean {
    try {
      return fs.existsSync(this.getBinPath());
    } catch {
      return false;
    }
  }

  private run(args: string[], opts: { stdin?: string; timeoutMs?: number } = {}): Promise<IRunResult> {
    const bin = this.getBinPath();
    const timeoutMs = opts.timeoutMs ?? 30000;
    return new Promise<IRunResult>((resolve) => {
      let settled = false;
      const finalize = (r: IRunResult) => {
        if (settled) return;
        settled = true;
        resolve(r);
      };

      let child;
      try {
        child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (err) {
        finalize({ exitCode: -1, stdout: '', stderr: err instanceof Error ? err.message : String(err) });
        return;
      }

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        finalize({ exitCode: -2, stdout, stderr: stderr + '\n[lark-cli timeout]' });
      }, timeoutMs);

      child.stdout?.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        finalize({ exitCode: -1, stdout, stderr: stderr + (err instanceof Error ? err.message : String(err)) });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        let parsed: Record<string, unknown> | undefined;
        try {
          const trimmed = stdout.trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            parsed = JSON.parse(trimmed) as Record<string, unknown>;
          }
        } catch {
          // not JSON; leave parsed undefined
        }
        finalize({ exitCode: code ?? -1, stdout, stderr, parsed });
      });

      if (opts.stdin !== undefined) {
        child.stdin?.write(opts.stdin);
      }
      child.stdin?.end();
    });
  }

  /**
   * Ensure lark-cli has an app configured. If `config show` reports success, leave it alone
   * (we don't reconfigure on every login — that would be destructive if the user added
   * additional named profiles via the CLI directly).
   */
  async ensureConfigured(appId: string, appSecret: string, brand: LarkBrand): Promise<{ ok: boolean; error?: string }> {
    const cur = await this.run(['config', 'show'], { timeoutMs: 10000 });
    if (cur.exitCode === 0 && cur.parsed && (cur.parsed as { ok?: boolean }).ok !== false) {
      return { ok: true };
    }

    mainLog(TAG, 'lark-cli not configured; running config init with provided creds');
    const init = await this.run(['config', 'init', '--app-id', appId, '--app-secret-stdin', '--brand', brand], {
      stdin: appSecret + '\n',
      timeoutMs: 30000,
    });
    if (init.exitCode !== 0) {
      const errMsg = this.extractErrorMessage(init) ?? 'lark-cli config init failed';
      return { ok: false, error: errMsg };
    }
    return { ok: true };
  }

  async startDeviceFlow(): Promise<LarkCliStartResult> {
    if (!this.isInstalled()) {
      return {
        ok: false,
        error: 'lark-cli not installed',
        hint: `Expected at ${this.getBinPath()}. Install via 'npx skills add larksuite/cli -g -y'.`,
      };
    }
    const r = await this.run(['auth', 'login', '--no-wait', '--json', '--recommend'], { timeoutMs: 30000 });
    if (r.exitCode !== 0 || !r.parsed) {
      const errMsg = this.extractErrorMessage(r) ?? 'lark-cli auth login failed';
      return { ok: false, error: errMsg };
    }
    const raw = r.parsed as { ok?: boolean; data?: Record<string, unknown>; error?: { message?: string } };
    if (raw.ok === false) {
      return { ok: false, error: raw.error?.message ?? 'auth login returned not-ok' };
    }
    const data = (raw.data ?? raw) as Record<string, unknown>;
    const verificationUrl = pickString(data, 'verification_url', 'verification_uri', 'verificationUrl', 'url');
    const userCode = pickString(data, 'user_code', 'userCode', 'code');
    const deviceCode = pickString(data, 'device_code', 'deviceCode');
    const expiresIn = pickNumber(data, 'expires_in', 'expiresIn');
    const intervalSec = pickNumber(data, 'interval', 'intervalSec') ?? 3;

    if (!verificationUrl || !userCode || !deviceCode) {
      mainWarn(TAG, 'unexpected auth login payload', data);
      return { ok: false, error: 'lark-cli returned unexpected payload (missing verification_url / user_code / device_code)' };
    }
    const expiresAt = Date.now() + (expiresIn ? expiresIn * 1000 : 5 * 60 * 1000);
    return { ok: true, verificationUrl, userCode, deviceCode, expiresAt, intervalMs: Math.max(1, intervalSec) * 1000 };
  }

  async pollDeviceCode(deviceCode: string): Promise<ILarkCliPollResult> {
    const r = await this.run(['auth', 'login', '--device-code', deviceCode, '--json'], { timeoutMs: 15000 });
    const raw = r.parsed as { ok?: boolean; data?: Record<string, unknown>; error?: { type?: string; subtype?: string; message?: string } } | undefined;

    if (raw && raw.ok === false) {
      const errType = (raw.error?.subtype ?? raw.error?.type ?? '').toLowerCase();
      const errMsg = (raw.error?.message ?? '').toLowerCase();
      const isPending = ['authorization_pending', 'pending', 'slow_down'].some((m) => errType.includes(m) || errMsg.includes(m));
      if (isPending) return { status: 'pending' };
      const isExpired = ['expired_token', 'expired', 'access_denied'].some((m) => errType.includes(m) || errMsg.includes(m));
      if (isExpired) return { status: 'expired' };
      return { status: 'failed', error: raw.error?.message ?? 'login failed' };
    }

    if (r.exitCode !== 0 || !raw) {
      const errMsg = this.extractErrorMessage(r);
      // Some lark-cli versions may exit nonzero while still pending — be conservative
      if (errMsg && /pending|slow_down/i.test(errMsg)) return { status: 'pending' };
      return { status: 'failed', error: errMsg ?? 'login failed' };
    }

    const data = (raw.data ?? raw) as Record<string, unknown>;
    const accessToken = pickString(data, 'access_token', 'accessToken') ?? '';
    const refreshToken = pickString(data, 'refresh_token', 'refreshToken');
    const expiresIn = pickNumber(data, 'expires_in', 'expiresIn');
    const expiresAt = pickNumber(data, 'expires_at', 'expiresAt') ?? (expiresIn ? Date.now() + expiresIn * 1000 : undefined);
    const userId = pickString(data, 'user_id', 'userId', 'open_id', 'openId');
    const userName = pickString(data, 'user_name', 'userName', 'name', 'display_name', 'displayName');

    return {
      status: 'success',
      user: { id: userId, name: userName },
      token: { accessToken, refreshToken, expiresAt },
    };
  }

  async getStatus(): Promise<ILarkCliStatus> {
    const installed = this.isInstalled();
    const binPath = this.getBinPath();
    if (!installed) {
      return { installed: false, binPath, configured: false, loggedIn: false };
    }
    const cfg = await this.run(['config', 'show'], { timeoutMs: 5000 });
    const configured = cfg.exitCode === 0 && !!cfg.parsed && (cfg.parsed as { ok?: boolean }).ok !== false;
    if (!configured) {
      return { installed: true, binPath, configured: false, loggedIn: false };
    }
    // `auth status` doesn't support --json — exit code 0 means we have a valid token.
    const status = await this.run(['auth', 'status'], { timeoutMs: 5000 });
    return {
      installed: true,
      binPath,
      configured: true,
      loggedIn: status.exitCode === 0,
    };
  }

  async logout(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isInstalled()) {
      return { ok: false, error: 'lark-cli not installed' };
    }
    const r = await this.run(['auth', 'logout'], { timeoutMs: 10000 });
    if (r.exitCode !== 0) {
      return { ok: false, error: this.extractErrorMessage(r) ?? 'logout failed' };
    }
    return { ok: true };
  }

  private extractErrorMessage(r: IRunResult): string | undefined {
    if (r.parsed) {
      const err = (r.parsed as { error?: { message?: string; hint?: string } }).error;
      if (err?.message) return err.hint ? `${err.message} (${err.hint})` : err.message;
    }
    const stderr = r.stderr?.trim();
    if (stderr) return stderr.split('\n').slice(-3).join(' ');
    const stdout = r.stdout?.trim();
    if (stdout) return stdout.split('\n').slice(-3).join(' ');
    return undefined;
  }
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.length > 0 && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

let instance: LarkCliAuthService | null = null;
export function getLarkCliAuthService(): LarkCliAuthService {
  if (!instance) instance = new LarkCliAuthService();
  return instance;
}
