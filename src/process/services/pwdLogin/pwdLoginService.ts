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
import { getSecretStore } from '@/common/nexus/secret-store';
import { putSecretResilient, getSecretResilient } from '@/common/nexus/nexus-secret-resilient';
import { buildNamespace } from '@/common/nexus/namespace';
import { mainError, mainLog } from '@process/utils/mainLogger';
import { ProcessConfig } from '@/process/initStorage';
import { pythonRuntimeService } from '@/process/services/python/PythonRuntimeService';
import { PwdLoginErrorCode } from './errors';
import { findAdapterByTitle, listAdapters, type PwdAdapter } from './pwdAdapters';
import { passwordStringToBuffer, zeroBuffer } from './memorySafety';

/**
 * Secret-store namespace for pwd_login credential entries. Keyed by the entry
 * title. The stored value is JSON `{username, password}` (preferred) or, for
 * back-compat, a raw password string. Consumer mode → `service:pwdlogin`.
 * (Enterprise/B端 would scope by userId; not needed for the Phase-2 flow yet.)
 */
const PWD_LOGIN_NAMESPACE = buildNamespace('pwdlogin');

/**
 * A registered pwd_login site (non-secret). Agent-discovered custom sites are
 * persisted here so they need no code change; built-in sites live in pwdAdapters.
 */
export interface PwdLoginEntry {
  title: string;
  url: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  captchaSelector?: string;
  captchaImageSelector?: string;
  strategy: 'single_step' | 'two_step';
}

/** UI-facing status row for the 秘钥管理 "网站自动登录" section. */
export interface PwdLoginEntryStatus {
  title: string;
  url: string;
  strategy: 'single_step' | 'two_step';
  hasCaptcha: boolean;
  source: 'builtin' | 'custom';
  /** Whether a credential secret has been saved for this entry. */
  hasCredential: boolean;
}

// Resilient wrappers (single → batch fallback for vault dylib builds missing
// the per-secret dispatch entries) moved to @common/nexus/nexus-secret-resilient
// so every secret-writing caller follows the same policy. Import above.

async function getRegistry(): Promise<PwdLoginEntry[]> {
  try {
    return (await ProcessConfig.get('pwdLogin.entries')) ?? [];
  } catch {
    return [];
  }
}

function entryToAdapter(e: PwdLoginEntry): PwdAdapter {
  return {
    title: e.title.trim().toLowerCase(),
    loginUrl: e.url,
    domains: [],
    usernameSelector: e.usernameSelector,
    passwordSelector: e.passwordSelector,
    submitSelector: e.submitSelector,
    captchaSelector: e.captchaSelector,
    captchaImageSelector: e.captchaImageSelector,
    strategy: e.strategy,
  };
}

/** Resolve a site's fill recipe: registry (custom) first, then built-in adapters. */
export async function resolvePwdAdapter(title: string): Promise<PwdAdapter | undefined> {
  const needle = title.trim().toLowerCase();
  const hit = (await getRegistry()).find((e) => e.title.trim().toLowerCase() === needle);
  return hit ? entryToAdapter(hit) : findAdapterByTitle(title);
}

/** True if a credential secret exists for the title (does not expose the value).
 *  Uses listSecrets (secret_list) — present even on plugin builds missing secret_get. */
function hasCredential(title: string): boolean {
  try {
    const key = title.trim();
    return getSecretStore()
      .listSecrets(PWD_LOGIN_NAMESPACE, false)
      .some((s) => s.key === key);
  } catch {
    return false;
  }
}

/**
 * Register (or update, by title) a custom pwd_login site. This is the
 * programmable interface the agent calls after exploring + selector-testing a
 * site, so it then appears in 秘钥管理 for the user to fill credentials.
 * Selectors are non-secret; NO password ever flows through here.
 */
export async function registerPwdLoginEntry(entry: PwdLoginEntry): Promise<void> {
  const title = entry.title.trim();
  if (!title || !entry.url || !entry.usernameSelector || !entry.passwordSelector || !entry.submitSelector) {
    throw new Error('pwd_login entry requires title, url, and username/password/submit selectors');
  }
  const reg = (await getRegistry()).filter((e) => e.title.trim().toLowerCase() !== title.toLowerCase());
  reg.push({ ...entry, title, strategy: entry.strategy || 'single_step' });
  await ProcessConfig.set('pwdLogin.entries', reg);
  mainLog('pwdLogin', `registered pwd_login entry "${title}" (${reg.length} custom total)`);
}

/**
 * Save credentials for a pwd_login entry into the Nexus secret store as JSON
 * {username, password} at service:pwdlogin/{title}. The password reaches here
 * from the renderer's form via IPC (renderer→main→Vault) — never the agent/LLM.
 */
export async function savePwdLoginCredential(title: string, username: string, password: string): Promise<void> {
  const key = title.trim();
  if (!key) throw new Error('title required');
  const value = JSON.stringify({ username, password });
  try {
    putSecretResilient(PWD_LOGIN_NAMESPACE, key, value, `pwd_login: ${key}`);
  } catch (err) {
    mainError('pwdLogin', `putSecret failed: ${err instanceof Error ? err.name : typeof err}`);
    throw err;
  }
}

/** Remove a custom pwd_login entry (built-in adapters are unaffected). */
export async function deletePwdLoginEntry(title: string): Promise<void> {
  const needle = title.trim().toLowerCase();
  const reg = (await getRegistry()).filter((e) => e.title.trim().toLowerCase() !== needle);
  await ProcessConfig.set('pwdLogin.entries', reg);
}

/** List all pwd_login sites (custom registry + built-in adapters) for the UI. */
export async function listPwdLoginEntries(): Promise<PwdLoginEntryStatus[]> {
  const out: PwdLoginEntryStatus[] = [];
  const seen = new Set<string>();
  for (const e of await getRegistry()) {
    const key = e.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: e.title, url: e.url, strategy: e.strategy, hasCaptcha: !!e.captchaSelector, source: 'custom', hasCredential: hasCredential(e.title) });
  }
  for (const a of listAdapters()) {
    if (seen.has(a.title)) continue;
    seen.add(a.title);
    out.push({ title: a.title, url: a.loginUrl, strategy: a.strategy, hasCaptcha: !!a.captchaSelector, source: 'builtin', hasCredential: hasCredential(a.title) });
  }
  return out;
}

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
 * Fetch credentials for `title` from the secret store via NexusSecretClient
 * (gRPC `password-vault.secret_get` to nexusd-cluster). Returns the password as
 * a Buffer ready for zeroing plus the non-secret username; the intermediate
 * String lifetime is the acknowledged residue (Python/JS can't truly zero a str).
 *
 * The stored value is JSON `{username, password}` (preferred) or a raw password
 * string (back-compat). Throws a structured PwdLoginErrorCode object so callers
 * can map to IPwdLoginResult cleanly. Replaces the old HTTP
 * `/api/v2/password_vault/{title}` path — nexusd-cluster :12022 is gRPC-only.
 */
async function fetchPasswordBuffer(title: string): Promise<{ username: string; passwordBuf: Buffer }> {
  let value: string;
  try {
    value = getSecretResilient(PWD_LOGIN_NAMESPACE, title);
  } catch (err) {
    // Never log the error body (may carry secret material) — only the type.
    mainError('pwdLogin', `secret_get failed: ${err instanceof Error ? err.name : typeof err}`);
    throw { code: PwdLoginErrorCode.NexusUnreachable } as const;
  }
  if (!value) {
    throw { code: PwdLoginErrorCode.EntryNotFound } as const;
  }

  // Value is JSON {username, password} (preferred) or a raw password string.
  let username = '';
  let password = value;
  try {
    const parsed = JSON.parse(value) as { username?: unknown; password?: unknown };
    if (parsed && typeof parsed === 'object' && typeof parsed.password === 'string') {
      password = parsed.password;
      username = typeof parsed.username === 'string' ? parsed.username : '';
    }
  } catch {
    // not JSON — treat the whole value as the raw password
  }

  const passwordBuf = passwordStringToBuffer(password);
  // Drop our plaintext references (str residue acknowledged).
  password = '';
  value = '';
  return { username, passwordBuf };
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

  // 2. Resolve adapter (custom registry first, then built-in adapters).
  const adapter = await resolvePwdAdapter(title);
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
    const creds = await fetchPasswordBuffer(title);
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
