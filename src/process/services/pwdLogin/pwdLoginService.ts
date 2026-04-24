/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IPwdLoginParams, IPwdLoginResult } from '@/common/ipcBridge';
import { BaseApprovalStore, type IApprovalKey } from '@/common/approval/ApprovalStore';
import { PermissionType } from '@/common/codex/types/permissionTypes';
import { FetchClient, NetworkError, NotFoundError, resolveConfig, ServerError, TimeoutError } from '@/common/nexus';
import { mainError, mainLog } from '@process/utils/mainLogger';
import { PwdLoginErrorCode } from './errors';
import { findAdapterByTitle, type PwdAdapter } from './pwdAdapters';
import { bufferToBase64AndZero, passwordStringToBuffer, zeroBuffer } from './memorySafety';

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
async function fetchPasswordBuffer(title: string, conversationId: string | undefined): Promise<Buffer> {
  const config = resolveConfig();
  const client = new FetchClient(config);
  const query = buildAuditQuery(conversationId);
  const path = `/api/v2/password_vault/${encodeURIComponent(title)}?${query}`;

  try {
    const entry = await client.get<NexusPasswordEntryResponse>(path);
    if (!entry || typeof entry.password !== 'string') {
      throw { code: PwdLoginErrorCode.EntryNotFound } as const;
    }

    // Narrow the String → Buffer boundary. After this line, the caller
    // zeroes the buffer; the source String is unreachable and GC-reclaimed.
    const buf = passwordStringToBuffer(entry.password);
    // Overwrite the only reference we hold — further protects against log
    // frameworks that dump local variables on unhandled exceptions.
    (entry as unknown as { password: unknown }).password = '';
    return buf;
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

/**
 * Dispatch pwd_fill sidechannel command to ai-dev-browser subprocess.
 *
 * Phase 1: STUB. The 3 sidechannel commands (pwd_fill, screenshot_lock_acquire,
 * screenshot_lock_release) do not yet exist on the ai-dev-browser side. This
 * function logs its intent and returns an adapter_error so the end-to-end
 * renderer flow can be exercised without a real form fill.
 *
 * Replace this implementation once browser-ai lands the 3 cmds and we submit
 * the sudowork → ai-dev-browser PR wiring stdin writes.
 */
async function dispatchPwdFill(_adapter: PwdAdapter, _usernameOrEmpty: string, passwordBuf: Buffer): Promise<{ tab_id: string }> {
  // Convert + zero immediately. We don't yet send anywhere, but this exercises
  // the real memory discipline so tests can assert zeroing even during stub.
  const b64 = bufferToBase64AndZero(passwordBuf);
  // Intentionally unused locally. Do NOT log `b64`, do NOT JSON.stringify it
  // into any error message. Keep the identifier silent.
  void b64;

  mainLog('pwdLogin', 'pwd_fill dispatch is stubbed: ai-dev-browser sidechannel cmds not yet available (tracked in resend to browser-ai 2026-04-22)');
  throw { code: PwdLoginErrorCode.AdapterError, detail: 'sidechannel pwd_fill not yet available on browser-ai side' } as const;
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

  // 3. Fetch password (Buffer-managed).
  let passwordBuf: Buffer | null = null;
  try {
    passwordBuf = await fetchPasswordBuffer(title, params.conversation_id);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      return { ok: false, error: (err as { code: string }).code };
    }
    return { ok: false, error: PwdLoginErrorCode.NexusUnreachable };
  }

  // 4. Dispatch to browser. STUB for Phase 1 — will throw adapter_error.
  try {
    const username = ''; // Phase 1 places nothing in username field; adapter fills password only.
    const result = await dispatchPwdFill(adapter, username, passwordBuf);
    // dispatchPwdFill zeroes the buffer internally on success path.
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
