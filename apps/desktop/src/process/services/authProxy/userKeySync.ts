/**
 * User Key Sync — mirrors sudorouter credentials from sudocode.json into Nexus Vault.
 *
 * Source : ~/.nexus/sudocode/sudocode.json → auth_modes.proxy.sudorouter.{baseUrl, apiKey}
 * Target : Nexus secret namespace `service_system:user_info`, keys `base_url` / `api_key`
 *
 * Design:
 * - Pure single-responsibility module: read creds (via scodeConfig) + write Nexus (idempotent).
 * - Fire-and-forget from callers; never throws (Nexus outages are logged, not propagated).
 * - Missing fields are skipped with a log line, never deleted from Nexus.
 */

import fs from 'fs';
import path from 'path';
import { getNexusSecretClient } from '@common/nexus/nexus-secret-client';
import { resolveSecret, cachePut } from '@common/nexus/secret-cache';
import { SCODE_DIR } from '@process/services/scode/ScodeInstallService';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { extractSudorouterCreds } from '@/common/scodeConfig';

const TAG = 'UserKeySync';

const USER_KEY_NAMESPACE = 'service_system:user_info';
const KEY_BASE_URL = 'base_url';
const KEY_API_KEY = 'api_key';
const SUDOCODE_CONFIG_PATH = path.join(SCODE_DIR, 'sudocode.json');

/**
 * Sync sudorouter credentials from a parsed sudocode.json config object into Nexus.
 * Reads `{ baseUrl, apiKey }`; writes whichever are present, skips whichever are missing.
 * Never throws.
 */
export async function syncUserKeyFromScodeConfig(config: unknown): Promise<void> {
  const creds = extractSudorouterCreds(config);

  if (creds.baseUrl) {
    await writeSecretIfChanged(KEY_BASE_URL, creds.baseUrl);
  } else {
    mainLog(TAG, 'baseUrl missing in sudocode.json, skip sync');
  }

  if (creds.apiKey) {
    await writeSecretIfChanged(KEY_API_KEY, creds.apiKey);
  } else {
    mainLog(TAG, 'apiKey missing in sudocode.json, skip sync');
  }
}

/**
 * Startup entry point: reads sudocode.json from disk and syncs its sudorouter creds.
 * Safe to call before the user has logged in (file may be absent/empty).
 * Never throws.
 */
export async function syncUserKeyOnStartup(): Promise<void> {
  let raw: string;
  try {
    raw = fs.readFileSync(SUDOCODE_CONFIG_PATH, 'utf-8');
  } catch {
    mainLog(TAG, 'sudocode.json not found, skip startup sync');
    return;
  }

  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    mainWarn(TAG, 'sudocode.json parse failed, skip startup sync', err);
    return;
  }

  await syncUserKeyFromScodeConfig(config);
}

/**
 * Idempotent single-key write using the standard three-step pattern
 * (putSecret → restoreSecret → cachePut), mirroring secretsApi.ts.
 * Skips Nexus round-trip when the cached value already matches.
 */
async function writeSecretIfChanged(key: string, value: string): Promise<void> {
  try {
    const current = resolveSecret(USER_KEY_NAMESPACE, key, '');
    if (current === value) {
      return; // unchanged — avoid bumping Nexus version number on every save
    }
    const client = getNexusSecretClient();
    client.putSecret(USER_KEY_NAMESPACE, key, value);
    try {
      client.restoreSecret(USER_KEY_NAMESPACE, key);
    } catch {
      // First-time create (no soft-deleted state to clear) reports an error — expected, ignore.
    }
    cachePut(USER_KEY_NAMESPACE, key, value);
    mainLog(TAG, `synced ${USER_KEY_NAMESPACE}/${key}`);
  } catch (err) {
    mainWarn(TAG, `failed to sync ${USER_KEY_NAMESPACE}/${key}`, err);
  }
}
