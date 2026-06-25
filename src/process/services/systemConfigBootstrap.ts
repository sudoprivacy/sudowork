/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main-process systemConfig cache bootstrap.
 *
 * Why this exists:
 *   The `src/common/systemConfig` module has ONE instance per process. The renderer
 *   fills its own copy via `main.tsx` / `useSystemLoginMethod`, but the MAIN process
 *   has no equivalent startup-time fill — historically the only main-side `fetchSystemConfig`
 *   call lived inside the autoUpdater branch (`src/index.ts`), which is gated behind
 *   `NEXUS_DISABLE_AUTO_UPDATE / NEXUS_E2E_TEST / CI`. When that branch is disabled (or
 *   when its promise does not resolve), `getSkillHubBaseUrl()` / `getSudorouterBaseUrl()`
 *   in the main process fall back to the hardcoded production URL — which then rejects
 *   server-dispatched dev tokens with 401.
 *
 * Contract:
 *   - Call once during app startup, after `initializeProcess()` (so ConfigStorage and IPC
 *     bridges are ready), and BEFORE any main-side reader of the systemConfig cache runs.
 *   - Awaits `fetchSystemConfig()` to completion so the cache is filled before returning.
 *   - Never throws — startup must not be blocked by a network failure. Errors are logged
 *     via mainError and swallowed.
 *   - Idempotent: safe to call multiple times (each call replaces the module cache).
 */

import { mainLog, mainError } from '@process/utils/mainLogger';
import { fetchSystemConfig } from '@/common/systemConfig';

export async function ensureMainSystemConfig(): Promise<void> {
  mainLog('systemConfigBootstrap', 'ensureMainSystemConfig start');
  try {
    const data = await fetchSystemConfig();
    mainLog('systemConfigBootstrap', 'ensureMainSystemConfig done', {
      hasData: data !== null,
      loginMethod: data?.login_method ?? null,
      skillhubBaseurl: data?.skillhub_baseurl ?? null,
      sudorouterBaseurl: data?.sudorouter_baseurl ?? null,
      logReportBaseurl: data?.log_report?.baseurl ?? null,
      versionUpdateEnabled: data?.version_update?.enabled ?? null,
      productImprovementEnabled: data?.product_improvement?.enabled ?? null,
    });
  } catch (err) {
    // fetchSystemConfig is documented to internally try/catch and return null on failure;
    // this catch is the safety net for any unexpected rejection path. Never re-throw.
    mainError('systemConfigBootstrap', 'ensureMainSystemConfig failed (swallowed)', {
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
