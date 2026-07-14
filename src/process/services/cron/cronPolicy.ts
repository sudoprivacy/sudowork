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

/**
 * Agent instruction injected instead of the cron skill when the org has
 * client cron disabled. Creation is banned, but existing jobs remain
 * manageable by their owner/co-owners (moss enforces per-job ownership), so
 * the agent keeps the list/delete command syntax. The ban must be explicit —
 * merely omitting the skill lets the agent hallucinate "task created" from
 * prior transcript knowledge.
 */
export const CRON_RESTRICTED_INSTRUCTION =
  '[Scheduled Tasks — CREATION DISABLED BY ORGANIZATION]\n' +
  'Creating scheduled tasks is disabled by this organization. [CRON_CREATE] is unavailable: NEVER output it, NEVER claim a scheduled task was created, and NEVER invent a task ID. ' +
  'If the user asks to create or schedule a recurring/timed task, tell them an administrator must enable the feature.\n' +
  "The user's EXISTING scheduled tasks can still be managed:\n" +
  "- Output [CRON_LIST] alone to list the user's scheduled tasks (only tasks the user owns or co-owns are returned).\n" +
  "- Output [CRON_DELETE: task-id] to delete one of the user's own tasks. Tasks owned by other users cannot be deleted.\n" +
  'These commands are asynchronous system commands: output ONE command by itself (not in a code block), then WAIT for the system response before continuing. Never combine commands in a single message.';

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
 * Whether the logged-in enterprise user is admin-capable for cron. Mirrors
 * moss's isCronAdminCapable (roles are the lowercase moss values): admins keep
 * full cron (including creation) while client_cron_enabled=false, matching the
 * server's cron_disabled_by_org bypass. Fail closed when the role is unknown.
 */
export function isCronAdminUser(): boolean {
  try {
    const userInfo = ProcessConfig.getSync('eeclaw.userInfo') as { role?: string } | undefined;
    const role = userInfo?.role?.toLowerCase();
    return role === 'admin' || role === 'super_admin';
  } catch {
    return false;
  }
}

/**
 * Whether the full cron skill may be advertised to an agent. Enabled orgs and
 * admin-capable users get the full skill; a disabled org's non-admin users get
 * the restricted instruction instead (list/delete own tasks, no creation), so
 * the agent's advertised capability matches what the moss server will accept.
 */
export async function isCronSkillAllowed(): Promise<boolean> {
  // Force-fresh: skill injection happens at the start of a session, and an admin
  // may have flipped the flag since app launch. Read the current value so the
  // agent's cron capability matches policy without an app restart.
  if (await getClientCronEnabled(true)) {
    return true;
  }
  return isEnterpriseMode() && isCronAdminUser();
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
