/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isEnterpriseMode } from '@/common/enterpriseDebugConfig';
import { resolveTenantConfig } from '@/common/types/tenantConfig';
import { ProcessConfig } from '@process/initStorage';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

/**
 * Main-process enforcement of the Moss-managed `client_cron_enabled` tenant
 * flag (issue #854). The renderer's `useCronEnabled` only hides UI; every
 * mutation/execution path must check this policy at the moment of use —
 * transcripts can teach agents the cron commands forever, so advertisement is
 * eventually-consistent while execution stays authoritative.
 *
 * The flag is fetched from the enterprise server with a short TTL so admin
 * toggles propagate without re-login; the last resolved value is persisted as
 * the offline fallback. Consumer mode is always enabled.
 */

const TENANT_CONFIG_TTL_MS = 60_000;

let cache: { enabled: boolean; fetchedAt: number } | null = null;

export class CronDisabledError extends Error {
  constructor() {
    super('Scheduled tasks are disabled by your organization');
    this.name = 'CronDisabledError';
  }
}

/** Test hook: drop the in-memory cache. */
export function resetCronPolicyCache(): void {
  cache = null;
}

export async function getClientCronEnabled(): Promise<boolean> {
  if (!isEnterpriseMode()) {
    return true;
  }

  const now = Date.now();
  if (cache && now - cache.fetchedAt < TENANT_CONFIG_TTL_MS) {
    return cache.enabled;
  }

  const serverUrl = readServerUrl();
  if (serverUrl) {
    try {
      const response = await fetch(`${serverUrl}/api/v1/tenant/config`, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const json = (await response.json()) as { success?: boolean; data?: Record<string, unknown> };
        const resolved = resolveTenantConfig(json?.data ?? null);
        cache = { enabled: resolved.client_cron_enabled !== false, fetchedAt: now };
        // Persist for offline fallback; failure to persist must not block policy resolution.
        ProcessConfig.set('eeclaw.tenantConfig', resolved).catch(() => {});
        return cache.enabled;
      }
      mainWarn('CronPolicy', `tenant config fetch returned ${response.status}, using fallback`);
    } catch (error) {
      mainWarn('CronPolicy', `tenant config fetch failed (${error instanceof Error ? error.message : String(error)}), using fallback`);
    }
  }

  // Offline fallback: last persisted resolved config; default enabled to match
  // resolveTenantConfig semantics (only an explicit false disables).
  let enabled = true;
  try {
    const persisted = ProcessConfig.getSync('eeclaw.tenantConfig');
    enabled = persisted?.client_cron_enabled !== false;
  } catch {
    /* ignore */
  }
  cache = { enabled, fetchedAt: now };
  return enabled;
}

/**
 * Throw CronDisabledError when the org has disabled client cron. Call this at
 * every client-side cron mutation/execution entry point.
 */
export async function assertClientCronEnabled(): Promise<void> {
  if (!(await getClientCronEnabled())) {
    mainLog('CronPolicy', 'Cron action refused: client_cron_enabled=false');
    throw new CronDisabledError();
  }
}

function readServerUrl(): string | null {
  try {
    const url = ProcessConfig.getSync('eeclaw.serverUrl');
    return url ? url.trim().replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}
