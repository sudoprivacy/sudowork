/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SkillUpdateService — keeps installed hub skills current.
 *
 * Installed hub skills are pinned at their install-time version and were never
 * refreshed, so users kept a stale capability surface (e.g. a ShareOne skill
 * missing "add collaborator" long after the hub shipped it). This service is the
 * missing "update" half of the skill lifecycle:
 *   enumerate installed hub skills → ask the hub for the latest version →
 *   semver-compare against installed_version → reuse the shared install path.
 *
 * Orchestration only (SRP): version discovery reuses the hub client helpers, the
 * actual download/extract/meta-write reuses installHubSkillPackage. Runs
 * fire-and-forget off the startup critical path; throttled in-memory so repeated
 * triggers (startup + hub-open) never hammer the hub.
 */
import { skillManager } from '@process/SkillManager';
import { installHubSkillPackage } from '@process/bridge/skillHubBridge';
import { ProcessConfig } from '@process/initStorage';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { getSkillHubBaseUrl } from '@/common/systemConfig';
import { getSkillhubToken } from '@/process/credentialsCache';
import type { ISkillHubDetail } from '@/common/ipcBridge';
import { isNewerVersion } from './version';

/** Config key for the auto-update toggle. Default ON (VSCode-style: silent, opt-out). */
export const SKILL_AUTO_UPDATE_SETTING_KEY = 'skill.autoUpdate';

/** Minimum gap between hub checks. In-memory only — an ephemeral throttle, never persisted. */
const CHECK_THROTTLE_MS = 10 * 60 * 1000;
/** Cold-start token wait: the skillhub token provisions a few seconds after startup. */
const TOKEN_WAIT_TIMEOUT_MS = 30_000;
const TOKEN_WAIT_INTERVAL_MS = 2_000;
let lastCheckAt = 0;
let inFlight: Promise<SkillUpdateSummary> | null = null;

export interface SkillUpdateSummary {
  checked: number;
  updated: string[];
  skipped?: 'throttled' | 'disabled' | 'no-token';
}

async function isAutoUpdateEnabled(): Promise<boolean> {
  // Default ON: only an explicit `false` disables it.
  return (await ProcessConfig.get(SKILL_AUTO_UPDATE_SETTING_KEY).catch(() => true)) !== false;
}

/**
 * The skillhub token is provisioned asynchronously during startup (nexus vault
 * connect + secret decrypt), which finishes a few seconds AFTER this fire-and-
 * forget trigger. Poll (bounded) for it so a cold start doesn't skip the check
 * and leave skills stale until the next launch.
 */
async function waitForSkillhubToken(): Promise<string | null> {
  const deadline = Date.now() + TOKEN_WAIT_TIMEOUT_MS;
  let token = getSkillhubToken();
  while (!token && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, TOKEN_WAIT_INTERVAL_MS));
    token = getSkillhubToken();
  }
  return token;
}

/** Latest published detail for a hub skill; versions[0] is newest (hub API contract). */
async function fetchLatestHubDetail(skillId: string, token: string): Promise<ISkillHubDetail | null> {
  const res = await fetch(`${getSkillHubBaseUrl()}/api/skills/${encodeURIComponent(skillId)}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: ISkillHubDetail };
  return body?.data ?? null;
}

/**
 * Check every installed hub skill against the hub and update the stale ones.
 * Idempotent, throttled, and safe to call fire-and-forget from anywhere.
 */
export function checkAndUpdateInstalledHubSkills(opts?: { force?: boolean }): Promise<SkillUpdateSummary> {
  // Coalesce concurrent triggers (startup + hub-open) onto one in-flight run.
  if (inFlight) return inFlight;

  const now = Date.now();
  if (!opts?.force && now - lastCheckAt < CHECK_THROTTLE_MS) {
    return Promise.resolve({ checked: 0, updated: [], skipped: 'throttled' });
  }

  inFlight = (async (): Promise<SkillUpdateSummary> => {
    if (!(await isAutoUpdateEnabled())) {
      mainLog('SkillUpdate', 'Skipped: auto-update disabled (skill.autoUpdate=false)');
      return { checked: 0, updated: [], skipped: 'disabled' };
    }
    const token = await waitForSkillhubToken();
    if (!token) {
      mainLog('SkillUpdate', 'Skipped: skillhub token not provisioned (waited)');
      return { checked: 0, updated: [], skipped: 'no-token' };
    }

    lastCheckAt = Date.now();

    const installed = (await skillManager.getInstalledSkills()).filter((s) => s.isHubInstalled);
    mainLog('SkillUpdate', `Checking ${installed.length} installed hub skill(s) for updates…`);
    const updated: string[] = [];

    for (const skill of installed) {
      const installedVersion = skill.meta?.installed_version ?? skill.version;
      const hubId = skill.meta?.id || skill.name;
      if (!installedVersion || !hubId) continue;
      try {
        const detail = await fetchLatestHubDetail(hubId, token);
        const latest = detail?.versions?.[0];
        if (!latest?.version || !isNewerVersion(latest.version, installedVersion)) continue;

        const result = await installHubSkillPackage({
          skillName: skill.name,
          displayName: skill.meta?.display_name || detail?.skill?.display_name || skill.name,
          sourceUrl: latest.source_url,
          version: latest.version,
          checksum: latest.checksum,
          skillMeta: detail?.skill,
        });
        if (result.success) {
          updated.push(`${skill.name} ${installedVersion} → ${latest.version}`);
          mainLog('SkillUpdate', `Updated hub skill "${skill.name}" ${installedVersion} → ${latest.version}`);
        } else if ('msg' in result) {
          mainWarn('SkillUpdate', `Failed to update "${skill.name}": ${result.msg}`);
        }
      } catch (err) {
        mainWarn('SkillUpdate', `Error updating "${skill.name}"`, err);
      }
    }

    mainLog(
      'SkillUpdate',
      `Done: checked ${installed.length} hub skill(s), updated ${updated.length}${updated.length ? ` (${updated.join('; ')})` : ''}`,
    );
    return { checked: installed.length, updated };
  })();

  try {
    return inFlight;
  } finally {
    void inFlight.finally(() => {
      inFlight = null;
    });
  }
}
