/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppMode } from '@/renderer/hooks/useAppMode';
import { useTenantConfig } from '@/renderer/context/TenantConfigContext';

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
  const { config } = useTenantConfig();

  if (!isEnterprise) {
    return true;
  }
  // resolveTenantConfig normalizes this to a boolean (default true).
  return config.client_cron_enabled !== false;
}
