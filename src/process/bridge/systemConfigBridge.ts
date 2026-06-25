/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * System Config Bridge — main-side handler for the server-driven credentials envelope.
 *
 * The renderer holds the JWT and fetches the AES-256-GCM envelope itself, then forwards
 * {nonce, ciphertext} here. The main process decrypts it, caches the plaintext in the
 * main-only `credentialsCache`, and triggers CrashReporter backfill. Because both login
 * paths (active login `handleLoginSuccess` + restart restore `refresh`) route through
 * this handler, the CrashReporter backfill naturally covers both (decision D8 + §6.3).
 */

import { mainError } from '@process/utils/mainLogger';
import { systemConfig } from '@/common/ipcBridge';
import { decryptCredentials, setSystemConfigCache } from '@/common/systemConfig';
import { setCredentialsCache } from '@/process/credentialsCache';
import { flushCrashReporter } from '@/process/telemetry/CrashReporter';
import { reinitTelemetryEncryptor } from '@/process/telemetry/TelemetryEncryptor';

export function initSystemConfigBridge(): void {
  systemConfig.cacheCredentials.provider(async ({ nonce, ciphertext }) => {
    try {
      const credentials = await decryptCredentials(nonce, ciphertext);
      setCredentialsCache(credentials);
      // Re-init the qms encryptor so an encryption_required=true dispatch swaps in the
      // server's public key (D6); no-op effect when encryption_required is false.
      void reinitTelemetryEncryptor().catch((err) => mainError('systemConfig', 'encryptor reinit failed:', err));
      // Credentials ready — flush any crash events queued before login (§6.3 backfill).
      void flushCrashReporter().catch((err) => mainError('systemConfig', 'post-credentials crash flush failed:', err));
      return { success: true, data: { cached: true } };
    } catch (err) {
      // D8: never block login on credential failure. Reporters skip via identity gating
      // (§6.1) when keys are absent, so a decrypt failure just logs and continues.
      mainError('systemConfig', 'decrypt/cache credentials failed:', err);
      return { success: true, data: { cached: false } };
    }
  });

  // Sync renderer-fetched systemConfig snapshot into the main-process cache.
  // See channel doc in src/common/ipcBridge.ts for the rationale (per-process module
  // cache means renderer fills do NOT propagate to main without this hop).
  systemConfig.syncFromRenderer.provider(async ({ data }) => {
    setSystemConfigCache(data);
    return { success: true };
  });
}
