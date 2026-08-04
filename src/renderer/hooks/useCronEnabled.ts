/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppMode } from '@/renderer/hooks/useAppMode';
import { useTenantStore } from '@/renderer/stores/useTenantStore';

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
  const clientCronEnabled = useTenantStore((state) => state.clientCronEnabled);
  const isPolicyConfirmed = useTenantStore((state) => state.isPolicyConfirmed);

  if (!isEnterprise) {
    return true;
  }
  // Fail closed: in enterprise mode, show cron only when the tenant config was
  // confirmed from the server this session AND the flag is not disabled. A stale
  // cache (e.g. a failed startup refresh after an admin disabled cron) must not
  // keep the UI visible. resolveTenantPolicy normalizes the flag to a boolean
  // (default true), so `confirmed` is what guards staleness.
  return isPolicyConfirmed && clientCronEnabled;
}
