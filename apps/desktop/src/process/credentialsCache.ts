/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main-process-only cache for decrypted credentials plaintext.
 *
 * Sensitivity boundary: the decrypted credential plaintext (keys/tokens) lives ONLY in the
 * main process — it never enters `src/common/` (which the renderer also bundles) or the
 * renderer itself. Only the encrypted envelope crosses the IPC boundary; decryption happens
 * here (see `decryptCredentials` in `src/common/systemConfig.ts`, invoked from the main-side
 * IPC handler).
 *
 * Callers read keys via the helpers below; a missing/empty value resolves to `null`, which
 * callers treat as "credential absent" → skip the request/report + log an error (decision D8),
 * never silently falling back to a hardcoded key.
 */

import type { DecryptedCredentials } from '@sudowork/common/systemConfig';

let cached: DecryptedCredentials | null = null;

/** Store/replace the decrypted credentials (called from the main-side IPC handler after decryption). */
export function setCredentialsCache(credentials: DecryptedCredentials | null): void {
  cached = credentials;
}

export function getCredentialsCache(): DecryptedCredentials | null {
  return cached;
}

function nonEmpty(value: string | undefined | null): string | null {
  return value && value.trim() ? value : null;
}

/** Skillhub bearer token (header `Authorization`); null when not provisioned. */
export function getSkillhubToken(): string | null {
  return nonEmpty(cached?.skillhub?.token);
}

/** qms product-improvement `X-API-Key`; null when not provisioned. */
export function getProductImprovementApiKey(): string | null {
  return nonEmpty(cached?.product_improvement?.api_key);
}

/** qms product-improvement encryption public key (PEM); null unless `encryption_required=true` + provisioned. */
export function getProductImprovementPublicKey(): string | null {
  return nonEmpty(cached?.product_improvement?.public_key);
}

/** Log-upload `X-API-Key`; null when not provisioned. */
export function getLogReportKey(): string | null {
  return nonEmpty(cached?.log_report?.key);
}
