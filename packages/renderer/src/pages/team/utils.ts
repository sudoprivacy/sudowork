/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Team bridge results arrive as `{ __error: string }` on failure rather than rejecting.
 * Unwrap the envelope into a thrown error so callers can use try/catch (mirrors cron's unwrapCronResult).
 */
export function unwrapTeamResult<T>(result: T): T {
  const envelope = result as { __error?: unknown } | null | undefined;
  if (envelope && typeof envelope === 'object' && typeof envelope.__error === 'string') {
    throw new Error(envelope.__error);
  }
  return result;
}
