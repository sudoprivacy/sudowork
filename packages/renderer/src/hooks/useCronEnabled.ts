/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppMode } from '@renderer/hooks/useAppMode';
import { useTenantConfig } from '@renderer/context/TenantConfigContext';

/**
 * Whether the client-side cron (scheduled task) feature is available.
 *
 * - Consumer mode: always enabled.
 * - Enterprise mode: governed by the Moss-managed `client_cron_enabled` flag
 *   delivered through the tenant config (admin/super_admin only; read-only on
 *   the client). A missing/unset value defaults to enabled.
 */
export function useCronEnabled(): boolean {
  const { isEnterprise } = useAppMode();
  const { config, confirmed } = useTenantConfig();

  if (!isEnterprise) {
    return true;
  }
  // Fail closed: in enterprise mode, show cron only when the tenant config was
  // confirmed from the server this session AND the flag is not disabled. A stale
  // cache (e.g. a failed startup refresh after an admin disabled cron) must not
  // keep the UI visible. resolveTenantConfig normalizes the flag to a boolean
  // (default true), so `confirmed` is what guards staleness.
  return confirmed && config.client_cron_enabled !== false;
}
