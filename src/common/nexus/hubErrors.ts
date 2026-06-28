/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SSOT for the structured error semantics shared between the
 * AssistantHub + SkillHub bridges and their renderer consumers.
 *
 * Why this exists: prior shape `{ success: false, msg: 'skillhub
 * token missing' }` left the renderer to do string matching to
 * differentiate "user needs to log in" from "the catalog is genuinely
 * empty" from "server is down". String matching across an IPC
 * boundary is exactly the kind of patch-over-patch that breaks the
 * next time someone rewords the message — surfaced empirically in
 * the Win-PC-0 dev profile cold-launch on 2026-06-28 where 智能体库
 * / 技能商店 both showed "暂无智能体" with no signal that the actual
 * cause was missing skillhub token provisioning.
 *
 * Typed errorCode → renderer can switch exhaustively, i18n key
 * selection becomes data-driven, and a new error class added in
 * the bridge surfaces a TS exhaustiveness-check miss in the
 * renderer rather than silently degrading to a generic "empty"
 * state.
 *
 * Backward-compat: bridges keep the legacy `msg` field too, so any
 * older caller still reading `res.msg` keeps working. The new
 * `errorCode` is additive.
 */

/** Hub failure classes the renderer cares about distinguishing.
 *  Add new variants here as bridges grow new explicit failure modes;
 *  callers use `parseHubError` which falls through to FETCH_FAILED
 *  for anything unknown (forward-compatible). */
export type HubErrorCode = 'TOKEN_MISSING' | 'FETCH_FAILED';

/** The discriminated shape every assistant/skill-hub bridge method
 *  returns. `errorCode` is required on non-success — `msg` stays for
 *  back-compat + debugging text. */
export type HubBridgeResult<T> = { success: true; data: T; msg?: undefined; errorCode?: undefined } | { success: false; data?: undefined; msg?: string; errorCode?: HubErrorCode };

/** Renderer-side typed failure record kept in component state. The
 *  `retriable` flag drives whether `HubEmptyState` shows the retry
 *  CTA — TOKEN_MISSING is not retriable from the empty-state UI
 *  alone (user needs to fix login first), but FETCH_FAILED is. */
export interface HubError {
  code: HubErrorCode;
  message: string;
  retriable: boolean;
}

/** Coerce any hub-bridge non-success response into a typed HubError.
 *  Unknown error codes fall through to FETCH_FAILED (the catch-all
 *  for "network / server / unknown problem"), matching how prior
 *  silent-fail callers were already treating the world. */
export function parseHubError(res: { success: false; errorCode?: string; msg?: string }): HubError {
  const message = res.msg ?? '';
  if (res.errorCode === 'TOKEN_MISSING') {
    return { code: 'TOKEN_MISSING', message, retriable: false };
  }
  // FETCH_FAILED + every unknown / legacy code: the user can retry,
  // and the message text — if present — is informational.
  return { code: 'FETCH_FAILED', message, retriable: true };
}

/** Construct a token-missing bridge response. Inline-callable from
 *  the bridge providers; keeps the shape consistent everywhere. */
export function tokenMissingResponse(method: string): { success: false; errorCode: 'TOKEN_MISSING'; msg: string } {
  return { success: false, errorCode: 'TOKEN_MISSING', msg: `skillhub token missing (${method})` };
}

/** Wrap a caught fetch / transport error into the bridge response
 *  shape with FETCH_FAILED code. */
export function fetchFailedResponse(err: unknown): { success: false; errorCode: 'FETCH_FAILED'; msg: string } {
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, errorCode: 'FETCH_FAILED', msg: message };
}
