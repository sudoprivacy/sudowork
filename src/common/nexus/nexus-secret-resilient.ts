/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single-secret call wrappers that transparently fall back to the
 * batch variants when the deployed vault plugin lacks the per-secret
 * dispatch entries. This is the recurring "plugin ↔ client ABI skew"
 * pattern documented in two prior incidents:
 *
 *  - `vault_plugin_secret_get_missing` (memory) — deployed nexus_vault.dll
 *    builds shipped without the `secret_get` dispatch but kept the batch
 *    + list variants. F1 + ShareOne both regressed silently because the
 *    consumer code only tried the single-secret path.
 *  - 进二 v0.2.7 bug (2026-06-27) — pre-PR #733 HTTP `SecretStoreClient`
 *    couldn't talk to the gRPC-only cluster. PR #733 migrated the path
 *    but `secretsApi.handlePut` was the one remaining caller without
 *    fallback resilience; a future vault dylib regression on
 *    `secret_put` would have surfaced the same symptom to her in
 *    v0.2.8+ (different error message, same outcome: API key won't
 *    persist). This module closes that gap.
 *
 * Why this module (vs duplicating helpers per consumer): every consumer
 * that calls `putSecret`/`getSecret` should follow the SAME fallback
 * policy, or the system splits into "resilient callers" and "fragile
 * callers" — a fragile caller will be the one that breaks next.
 * Keeping the policy in one file makes "add a new caller" mean
 * `putSecretResilient(...)` instead of "decide whether to add a
 * fallback this time".
 *
 * Out of scope (no batch variant exists upstream): `deleteSecret`,
 * `restoreSecret`. If those single-method dispatches go missing on a
 * deployed dylib, the only remediation is bumping the dylib version.
 * Not adding speculative fallbacks for non-existent batch methods.
 */

import { getNexusSecretClient, type SecretMetadata } from './nexus-secret-client.js';

/**
 * Recognise the gRPC "method not found" / UNIMPLEMENTED error class.
 * Both wordings have been observed in nexus-napi error messages
 * depending on plugin-loader state: `UNIMPLEMENTED` when the cluster
 * accepted the plugin but the method handler is absent; `method not
 * found` when it's a routing-table miss. Match both case-insensitively.
 *
 * Non-matching errors propagate — we never silently swallow a real
 * gRPC failure as if it were a missing method.
 */
export function isVaultMethodMissing(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /method not found|unimplemented/i.test(err.message);
}

/**
 * `putSecret` with a `batch_put` fallback. Use this from every code
 * path that writes a single secret to the vault. The batch dispatch
 * accepts a 1-item array and returns the same metadata shape, so the
 * fallback is semantically equivalent. Returns the metadata of the
 * stored secret (either path).
 */
export function putSecretResilient(namespace: string, key: string, value: string, description?: string): SecretMetadata {
  const client = getNexusSecretClient();
  try {
    return client.putSecret(namespace, key, value, description);
  } catch (err) {
    if (!isVaultMethodMissing(err)) throw err;
    const results = client.batchPut([{ namespace, key, value, description }]);
    if (!results.length) {
      // batch_put returning empty for a 1-item input is a vault impl
      // bug — surface it loudly rather than papering over it.
      throw new Error(`batch_put fallback returned empty result for ${namespace}/${key}`);
    }
    return results[0];
  }
}

/**
 * `getSecret` with a `batch_get` fallback. Returns the stored value
 * or `''` if absent. `''` is the same sentinel `batchGet` uses for
 * missing keys (single-key call would throw `NotFound` instead — we
 * normalise to the batch shape for consistency in fallback path).
 */
export function getSecretResilient(namespace: string, key: string): string {
  const client = getNexusSecretClient();
  try {
    return client.getSecret(namespace, key);
  } catch (err) {
    if (!isVaultMethodMissing(err)) throw err;
    const result = client.batchGet([{ namespace, key }]);
    const values = Object.values(result);
    return values.length ? values[0] : '';
  }
}
