/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Memory-safety helpers for handling plaintext password bytes in the
 * sudowork main process.
 *
 * JS `String` is immutable and GC-uncontrolled — zeroing a string is
 * impossible. These helpers minimize the residue:
 *
 * 1. Secrets travel as `Buffer` (subclass of `Uint8Array`) wherever
 *    possible. Buffers can be explicitly zeroed via `.fill(0)`.
 * 2. Conversion String → Buffer happens as narrowly as possible, and
 *    the caller MUST drop references to the source string immediately
 *    after (let the GC reclaim the short-lived String).
 * 3. Base64 encoding for sidechannel transport produces a fresh
 *    String that is expected to live only for the duration of one
 *    JSON.stringify on the sidechannel dispatch.
 * 4. Hard rule: no `JSON.stringify` is ever called on an object that
 *    has a `password` (or similar) property containing the raw bytes.
 *    Callers must strip / replace the secret field first.
 *
 * See v2 spec §7 "Memory discipline (JS/TS realities)" for the full
 * threat model and constraints.
 */

/**
 * Copy a string of password bytes into a fresh Buffer, ready for
 * zeroing after use. The caller is expected to drop the source
 * string reference after this call.
 *
 * The brief String lifetime (nanoseconds) is the one residue JS does
 * not let us eliminate — acknowledged in v2 §7.
 */
export function passwordStringToBuffer(source: string): Buffer {
  // Buffer.from copies bytes out of the String — from this point on
  // the Buffer is the only holder we can zero.
  return Buffer.from(source, 'utf-8');
}

/**
 * Base64-encode a secret Buffer for sidechannel transport, then zero
 * the source Buffer. Returns the base64 String (short-lived — meant
 * to be JSON.stringified into an outbound sidechannel message and
 * then discarded).
 *
 * Rationale: the sidechannel JSON on stdin to ai-dev-browser carries
 * `password_b64` not the raw password, so the String that hits the
 * pipe is not the password itself. Still transient, still a String
 * briefly, but not the original credential.
 */
export function bufferToBase64AndZero(buf: Buffer): string {
  const b64 = buf.toString('base64');
  buf.fill(0);
  return b64;
}

/**
 * Zero a Buffer in place. Safe to call multiple times; safe if buffer
 * is already zeroed.
 */
export function zeroBuffer(buf: Buffer | null | undefined): void {
  if (buf && buf.length > 0) {
    buf.fill(0);
  }
}

/**
 * Verify (for tests and defensive checks) that a Buffer has been zeroed.
 */
export function isBufferZeroed(buf: Buffer): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}
