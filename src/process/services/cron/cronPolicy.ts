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

/**
 * @param forceFresh skip the in-memory TTL cache and re-fetch. Used at skill
 *   injection time so a mid-session admin flag flip takes effect without an app
 *   restart (the cache would otherwise hold the launch-time value for 60s).
 */
export async function getClientCronEnabled(forceFresh = false): Promise<boolean> {
  if (!isEnterpriseMode()) {
    mainLog('CronPolicy', 'resolved enabled=true (personal mode)');
    return true;
  }

  const now = Date.now();
  if (!forceFresh && cache && now - cache.fetchedAt < TENANT_CONFIG_TTL_MS) {
    mainLog('CronPolicy', `resolved enabled=${cache.enabled} (cache, age=${Math.round((now - cache.fetchedAt) / 1000)}s)`);
    return cache.enabled;
  }

  const serverUrl = readServerUrl();
  if (serverUrl) {
    try {
      const response = await fetch(`${serverUrl}/api/v1/tenant/config`, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const json = (await response.json()) as { success?: boolean; data?: Record<string, unknown> };
        const resolved = resolveTenantConfig(json?.data ?? null);
        const enabled = resolved.client_cron_enabled !== false;
        cache = { enabled, fetchedAt: now };
        // Persist the confirmed flag for the offline fallback. The marker lets a
        // later offline read distinguish "confirmed enabled" from "never
        // confirmed" so the fallback can fail closed. Persist failures must not
        // block policy resolution.
        ProcessConfig.set('eeclaw.tenantConfig', { ...resolved, client_cron_enabled: enabled, cron_confirmed: true }).catch(() => {});
        mainLog('CronPolicy', `resolved enabled=${enabled} (fetched from server${forceFresh ? ', forced fresh' : ''})`);
        return enabled;
      }
      mainWarn('CronPolicy', `tenant config fetch returned ${response.status}, using fallback`);
    } catch (error) {
      mainWarn('CronPolicy', `tenant config fetch failed (${error instanceof Error ? error.message : String(error)}), using fallback`);
    }
  }

  // Strict fail-closed offline fallback (enterprise): cron is allowed only if a
  // previous successful fetch affirmatively confirmed it enabled. An unreachable
  // server with nothing confirmed → disabled, so an admin's disable is honored
  // even offline and a fresh install never silently enables cron.
  let enabled = false;
  try {
    const persisted = ProcessConfig.getSync('eeclaw.tenantConfig');
    enabled = persisted?.cron_confirmed === true && persisted?.client_cron_enabled !== false;
  } catch {
    /* ignore */
  }
  mainWarn('CronPolicy', `resolved enabled=${enabled} (offline fail-closed fallback)`);
  cache = { enabled, fetchedAt: now };
  return enabled;
}

/**
 * Whether the cron skill may be advertised to an agent. Same decision as the
 * execution gate, used at skill-injection time so the skill is never offered
 * when the org has cron disabled (the agent then never attempts it).
 */
export async function isCronSkillAllowed(): Promise<boolean> {
  // Force-fresh: skill injection happens at the start of a session, and an admin
  // may have flipped the flag since app launch. Read the current value so the
  // agent's cron capability matches policy without an app restart.
  return getClientCronEnabled(true);
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
