/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
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
   * Check whether lark-cli has any configured app.
   */
  async isConfigured(): Promise<boolean> {
    const cur = await this.run(['config', 'show'], { timeoutMs: 10000 });
    return cur.exitCode === 0 && !!cur.parsed && (cur.parsed as { ok?: boolean }).ok !== false;
  }

  /**
   * Return app credentials currently held by lark-cli's config, if any. Best-effort field extraction —
   * the exact field names depend on lark-cli version. Missing fields come back undefined.
   */
  async getConfigApp(): Promise<{ appId?: string; appSecret?: string }> {
    const cur = await this.run(['config', 'show'], { timeoutMs: 5000 });
    if (cur.exitCode !== 0 || !cur.parsed) return {};
    const raw = cur.parsed as { ok?: boolean; data?: Record<string, unknown> };
    if (raw.ok === false) return {};
    const data = (raw.data ?? raw) as Record<string, unknown>;
    return {
      appId: pickString(data, 'app_id', 'appId', 'AppID'),
      appSecret: pickString(data, 'app_secret', 'appSecret', 'AppSecret'),
    };
  }

  /**
   * Spawn `lark-cli config init --new --brand <brand>` and stream stdout looking for the
   * verification URL (e.g. https://open.feishu.cn/page/cli?...). The CLI blocks until the
   * user completes setup in the browser; we resolve with `success` when the process exits 0,
   * `failure` otherwise.
   *
   * Callers get the verification URL via `onUrl` as soon as it shows up in stdout, then await
   * the returned promise for the final exit status. Pass an AbortSignal to kill mid-flight.
   */
  startConfigInitNew(brand: LarkBrand, onUrl: (url: string) => void, signal?: AbortSignal): { url: Promise<string>; done: Promise<{ ok: boolean; error?: string }> } {
    if (!this.isInstalled()) {
      return {
        url: Promise.reject(new Error('lark-cli not installed')),
        done: Promise.resolve({ ok: false, error: 'lark-cli not installed' }),
      };
    }
    const bin = this.getBinPath();
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(bin, ['config', 'init', '--new', '--brand', brand], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { url: Promise.reject(new Error(msg)), done: Promise.resolve({ ok: false, error: msg }) };
    }

    let resolveUrl: (u: string) => void;
    let rejectUrl: (e: Error) => void;
    const url = new Promise<string>((resolve, reject) => {
      resolveUrl = resolve;
      rejectUrl = reject;
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    let urlEmitted = false;
    const urlRegex = /(https?:\/\/open\.(?:feishu|larksuite)\.cn\/page\/cli\?[^\s]+)/;

    const tryEmit = () => {
      if (urlEmitted) return;
      const m = (stdoutBuf + '\n' + stderrBuf).match(urlRegex);
      if (m) {
        urlEmitted = true;
        onUrl(m[1]);
        resolveUrl(m[1]);
      }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      tryEmit();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      // lark-cli writes its QR + verification URL to stderr when stdout is not a TTY.
      stderrBuf += chunk.toString();
      tryEmit();
    });

    const done = new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const onAbort = () => {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      child.on('error', (err) => {
        if (!urlEmitted) rejectUrl(err instanceof Error ? err : new Error(String(err)));
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
      child.on('close', (code) => {
        if (!urlEmitted) {
          rejectUrl(new Error(`config init exited before emitting URL (code ${code})`));
        }
        if (code === 0) {
          resolve({ ok: true });
        } else if (signal?.aborted) {
          resolve({ ok: false, error: 'cancelled' });
        } else {
          const last = (stderrBuf.trim() || stdoutBuf.trim()).split('\n').slice(-3).join(' ');
          resolve({ ok: false, error: last || `config init exited with code ${code}` });
        }
      });
    });

    // Watchdog: if no URL surfaces within 15s, give up — the CLI may have failed earlier.
    setTimeout(() => {
      if (!urlEmitted) {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        rejectUrl(new Error('Timed out waiting for verification URL from lark-cli config init'));
      }
    }, 15000);

    return { url, done };
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
    const deviceCode = pickString(data, 'device_code', 'deviceCode');
    const expiresIn = pickNumber(data, 'expires_in', 'expiresIn');
    const intervalSec = pickNumber(data, 'interval', 'intervalSec') ?? 3;

    if (!verificationUrl || !deviceCode) {
      mainWarn(TAG, 'unexpected auth login payload', data);
      return { ok: false, error: 'lark-cli returned unexpected payload (missing verification_url / device_code)' };
    }
    // user_code is usually a top-level field, but newer lark-cli embeds it as a query param on verification_url instead.
    let userCode = pickString(data, 'user_code', 'userCode', 'code') ?? '';
    if (!userCode) {
      try {
        userCode = new URL(verificationUrl).searchParams.get('user_code') ?? '';
      } catch {
        // verification_url may not be a parseable URL — leave userCode empty
      }
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
