/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runtime error class union. SSOT for differentiated runtime error UX
 * across the IPC boundary. Each class maps 1:1 to a renderer banner
 * variant + i18n key + CTA spec.
 *
 * Distinct from `LlmErrorClass` in `@process/utils/llmErrorClassification`:
 * - LlmErrorClass is the back-end CLASSIFIER's output (includes 'unknown',
 *   raw types from the LLM API).
 * - RuntimeErrorClass is the front-end DISPLAY contract: only classes that
 *   warrant a differentiated banner. Plain text errors go through the
 *   legacy `tips.error` path with no errorClass set.
 *
 * Keep this list narrow — every entry is a UI surface + 6-locale i18n
 * burden. Add a class only when its CTA / copy meaningfully differs from
 * the default "请重试" UX.
 */
export type RuntimeErrorClass = 'context_window_exceeded' | 'single_request_too_large' | 'request_body_too_large' | 'quota' | 'rate_limit' | 'auth' | 'network' | 'timeout';

/**
 * Structured runtime error payload carried alongside IMessageTips.
 *
 * Backwards-compatible: legacy error tips (no errorClass) continue to
 * render via the existing MessageTips path. Only set this when the
 * back-end classifier identified a specific class with actionable UX.
 */
export interface RuntimeErrorMeta {
  errorClass: RuntimeErrorClass;
  /** Original bytes of the offending payload (for single_request copy). */
  bytes?: number;
  /** Whether the user can retry the SAME action (vs needing to fix input first). */
  retryable?: boolean;
}

/**
 * Maps a LlmErrorClass (from the classifier) to a RuntimeErrorClass (for
 * the renderer). Returns null for 'unknown' — caller should fall back to
 * the raw error text via the legacy path.
 *
 * Centralized here so both AcpAgent error-emit sites + future
 * non-ACP runtimes (Codex, MossWs, etc.) share the mapping.
 */
export function toRuntimeErrorClass(llmClass: string): RuntimeErrorClass | null {
  switch (llmClass) {
    case 'context_window_exceeded':
    case 'single_request_too_large':
    case 'request_body_too_large':
    case 'quota':
    case 'rate_limit':
    case 'auth':
    case 'network':
    case 'timeout':
      return llmClass;
    default:
      return null;
  }
}

/**
 * i18n key for the title of a runtime error banner.
 * Convention: `runtimeError.{errorClass}.title` → renderer locale JSON.
 */
export function titleKey(cls: RuntimeErrorClass): string {
  return `runtimeError.${cls}.title`;
}

/**
 * i18n key for the body copy. Banner may interpolate {{bytes}} for
 * single_request_too_large.
 */
export function bodyKey(cls: RuntimeErrorClass): string {
  return `runtimeError.${cls}.body`;
}

/**
 * i18n key for the primary CTA button label.
 * Returns null when this class has no primary CTA (e.g. timeout falls
 * back to a generic "重试" handled outside the banner).
 */
export function ctaKey(cls: RuntimeErrorClass): string | null {
  switch (cls) {
    case 'context_window_exceeded':
      return 'runtimeError.context_window_exceeded.cta';
    case 'single_request_too_large':
      return 'runtimeError.single_request_too_large.cta';
    case 'request_body_too_large':
      return 'runtimeError.request_body_too_large.cta';
    case 'quota':
      return 'runtimeError.quota.cta';
    case 'auth':
      return 'runtimeError.auth.cta';
    // rate_limit / network / timeout: no specific CTA, just informational
    case 'rate_limit':
    case 'network':
    case 'timeout':
      return null;
  }
}

/**
 * Should the banner SHOW the offending byte size?
 * Only meaningful for size-driven errors.
 */
export function showsBytes(cls: RuntimeErrorClass): boolean {
  return cls === 'single_request_too_large' || cls === 'request_body_too_large';
}

/**
 * Human-readable byte size formatter. Returns e.g. "25.2 MB", "190 KB".
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
