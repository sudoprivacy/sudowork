/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import type { IPwdLoginParams, IPwdLoginResult } from '@/common/ipcBridge';
import { BaseApprovalStore, type IApprovalKey } from '@/common/approval/ApprovalStore';
import { PermissionType } from '@/common/codex/types/permissionTypes';
import { FetchClient, NetworkError, NotFoundError, resolveConfig, ServerError, TimeoutError } from '@/common/nexus';
import { mainError, mainLog } from '@process/utils/mainLogger';
import { pythonRuntimeService } from '@/process/services/python/PythonRuntimeService';
import { PwdLoginErrorCode } from './errors';
import { findAdapterByTitle, type PwdAdapter } from './pwdAdapters';
import { passwordStringToBuffer, zeroBuffer } from './memorySafety';

/**
 * Singleton ApprovalStore for credential_autologin decisions. Session-scoped:
 * cleared on sudowork process restart. Key = {action: 'credential_autologin',
 * identifier: title} — rename-in-vault invalidates, as documented in v2 spec §1.
 */
const approvalStore = new BaseApprovalStore();

function credentialKey(title: string): IApprovalKey {
  return { action: PermissionType.CREDENTIAL_AUTOLOGIN, identifier: title };
}

/**
 * Shape of nexus PasswordVaultService GET /password_vault/{title} response.
 * We only pluck `password`; other fields (username, url, totp_secret, ...)
 * are ignored for Phase 1.
 */
interface NexusPasswordEntryResponse {
  title: string;
  username?: string;
  password: string;
  url?: string;
  totp_secret?: string | null;
  // ... other fields intentionally untyped — we don't depend on them
}

/**
 * Build the nexus audit query string. v0.9.33 ignores these unknown params;
 * v0.9.34+ will parse them into the audit log. See spec §4.
 */
function buildAuditQuery(conversationId?: string): string {
  const params = new URLSearchParams();
  params.set('access_context', 'auto_login');
  params.set('client_id', 'sudowork');
  if (conversationId) {
    // v2 spec §4: "current agent session id". For Phase 1 user-triggered flow
    // we pass conversation_id as the closest analogue.
    params.set('agent_session', conversationId);
  }
  return params.toString();
}

/**
 * Fetch the password for `title` from nexus. Returns the bytes as a Buffer
 * ready for zeroing; the intermediate String lifetime is the acknowledged
 * residue from v2 spec §7.
 *
 * Throws structured PwdLoginErrorCode via thrown object so callers can map
 * to IPwdLoginResult cleanly.
 */
async function fetchPasswordBuffer(title: string, conversationId: string | undefined): Promise<{ username: string; passwordBuf: Buffer }> {
  const config = resolveConfig();
  const client = new FetchClient(config);
  const query = buildAuditQuery(conversationId);
  const reqPath = `/api/v2/password_vault/${encodeURIComponent(title)}?${query}`;

  try {
    const entry = await client.get<NexusPasswordEntryResponse>(reqPath);
    if (!entry || typeof entry.password !== 'string') {
      throw { code: PwdLoginErrorCode.EntryNotFound } as const;
    }

    // Username is non-secret — keep as a plain string to fill the form.
    const username = typeof entry.username === 'string' ? entry.username : '';
    // Narrow the String → Buffer boundary. After this line, the caller
    // zeroes the buffer; the source String is unreachable and GC-reclaimed.
    const passwordBuf = passwordStringToBuffer(entry.password);
    // Overwrite the only reference we hold — further protects against log
    // frameworks that dump local variables on unhandled exceptions.
    (entry as unknown as { password: unknown }).password = '';
    return { username, passwordBuf };
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      throw err;
    }
    if (err instanceof NotFoundError) {
      throw { code: PwdLoginErrorCode.EntryNotFound } as const;
    }
    if (err instanceof NetworkError || err instanceof TimeoutError || err instanceof ServerError) {
      throw { code: PwdLoginErrorCode.NexusUnreachable } as const;
    }
    // Unknown error — log the error type only, never the body (which may have password)
    mainError('pwdLogin', `unexpected nexus error: ${err instanceof Error ? err.name : typeof err}`);
    throw { code: PwdLoginErrorCode.NexusUnreachable } as const;
  }
}

/** Resolve the bundled pwd_fill.py path in dev and packaged builds. */
function getFillerScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'pwdLogin', 'pwd_fill.py');
  }
  return path.join(app.getAppPath(), 'resources', 'pwdLogin', 'pwd_fill.py');
}

/** sudoclaw.json holds the vision-model creds the filler uses to read captchas. */
function getSudoclawConfigPath(): string {
  return path.join(os.homedir(), '.nexus', 'sudoclaw', 'sudoclaw.json');
}

/**
 * Perform the real login-form fill in the already-running browser via the
 * bundled pwd_fill.py (ai-dev-browser core fns).
 *
 * SECURITY: the plaintext password is delivered ONLY via the child's stdin —
 * never argv, never the temp config file (which holds non-secret selectors +
 * username + the sudoclaw.json path only), never logged. The buffer is zeroed
 * as soon as it has been flushed to the pipe. The filler never returns the
 * password and we never read it back.
 */
async function dispatchPwdFill(adapter: PwdAdapter, username: string, passwordBuf: Buffer): Promise<{ tab_id: string }> {
  const status = await pythonRuntimeService.checkInstalled();
  if (!status.installed || !status.path) {
    zeroBuffer(passwordBuf);
    throw { code: PwdLoginErrorCode.AdapterError, detail: 'python runtime not available' } as const;
  }
  const script = getFillerScriptPath();
  if (!fs.existsSync(script)) {
    zeroBuffer(passwordBuf);
    throw { code: PwdLoginErrorCode.AdapterError, detail: 'pwd_fill.py not found' } as const;
  }

  // Non-secret config → temp file (mode 0600). NO password here.
  const cfg = {
    url: adapter.loginUrl,
    usernameSelector: adapter.usernameSelector,
    passwordSelector: adapter.passwordSelector,
    submitSelector: adapter.submitSelector,
    captchaSelector: adapter.captchaSelector,
    captchaImageSelector: adapter.captchaImageSelector,
    strategy: adapter.strategy,
    username,
    sudoclawConfigPath: getSudoclawConfigPath(),
  };
  const cfgPath = path.join(os.tmpdir(), `pwdfill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg), { mode: 0o600 });

  try {
    const result = await new Promise<{ ok: boolean; url_after?: string; error?: string }>((resolve, reject) => {
      const child = spawn(status.path!, [script, '--config', cfgPath], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err) => {
        zeroBuffer(passwordBuf);
        reject(err);
      });
      child.on('close', () => {
        // The filler prints exactly one JSON object on the last stdout line.
        const line = stdout
          .trim()
          .split(/\r?\n/)
          .filter((l) => l.trim().startsWith('{'))
          .pop();
        if (!line) {
          mainError('pwdLogin', `pwd_fill produced no JSON result (stderr: ${stderr.slice(-200)})`);
          return reject(new Error('no result'));
        }
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error('bad result json'));
        }
      });
      // Deliver the password via stdin, then zero the buffer once flushed.
      child.stdin.end(passwordBuf, () => zeroBuffer(passwordBuf));
    });

    if (!result.ok) {
      throw { code: PwdLoginErrorCode.AdapterError, detail: result.error || 'fill failed' } as const;
    }
    mainLog('pwdLogin', `pwd_fill completed for "${adapter.title}" (navigated=${result.url_after ? 'yes' : 'n/a'})`);
    return { tab_id: result.url_after || 'active' };
  } finally {
    try {
      fs.rmSync(cfgPath, { force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Main handler for the pwd_login flow. Invoked from the IPC bridge when the
 * renderer calls `ipcBridge.pwdLogin.start.invoke(...)`.
 */
export async function handlePwdLogin(params: IPwdLoginParams): Promise<IPwdLoginResult> {
  const title = (params.title || '').trim();
  if (!title) {
    return { ok: false, error: PwdLoginErrorCode.EntryNotFound };
  }

  const approvalKey = credentialKey(title);

  // 1. Approval check — respect explicit decision first, then fall back to cache.
  if (params.optionId) {
    if (params.optionId === 'reject_once' || params.optionId === 'reject_always') {
      return { ok: false, error: PwdLoginErrorCode.ApprovalRejected };
    }
    if (params.optionId === 'allow_always') {
      approvalStore.approve(approvalKey);
    }
    // allow_once / allow_always both proceed
  } else if (!approvalStore.isApproved(approvalKey)) {
    // No explicit decision and no cached approval — caller should have opened
    // the approval modal first. Return rejected as a safe default.
    return { ok: false, error: PwdLoginErrorCode.ApprovalRejected };
  }

  // 2. Resolve adapter.
  const adapter = findAdapterByTitle(title);
  if (!adapter) {
    // Phase 1 intentionally does not run the generic DOM heuristic client-side
    // because sidechannel dispatch is stubbed. Returning login_form_not_found
    // preserves the v2 §3.f ordering for future wiring.
    return { ok: false, error: PwdLoginErrorCode.LoginFormNotFound };
  }
  if (adapter.strategy !== 'single_step') {
    // Phase 1 scope: single-step forms only. Two-step sites (Google, Linear,
    // etc.) are registered but deferred.
    return { ok: false, error: PwdLoginErrorCode.LoginFormNotFound, detail: 'two_step sites deferred to Phase 2' };
  }

  // 3. Fetch credentials (password Buffer-managed; username is non-secret).
  let passwordBuf: Buffer | null = null;
  let username = '';
  try {
    const creds = await fetchPasswordBuffer(title, params.conversation_id);
    username = creds.username;
    passwordBuf = creds.passwordBuf;
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      return { ok: false, error: (err as { code: string }).code };
    }
    return { ok: false, error: PwdLoginErrorCode.NexusUnreachable };
  }

  // 4. Dispatch the real fill to the running browser via pwd_fill.py.
  try {
    const result = await dispatchPwdFill(adapter, username, passwordBuf);
    // dispatchPwdFill zeroes the buffer internally once flushed to the child.
    passwordBuf = null;
    return { ok: true, tab_id: result.tab_id };
  } catch (err) {
    // Always zero the buffer, even on dispatch error.
    zeroBuffer(passwordBuf);
    passwordBuf = null;
    if (err && typeof err === 'object' && 'code' in err) {
      const { code, detail } = err as { code: string; detail?: string };
      return { ok: false, error: code, detail };
    }
    return { ok: false, error: PwdLoginErrorCode.AdapterError };
  }
}

/** Test-only: reset approval cache between test cases. */
export function __resetPwdLoginApprovalsForTest(): void {
  approvalStore.clear();
}
