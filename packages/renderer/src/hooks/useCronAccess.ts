/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { useAuth } from '@renderer/context/AuthContext';
import { useCronEnabled } from '@renderer/hooks/useCronEnabled';

/**
 * Cron feature access for the current user.
 *
 * - `isCronEnabled` — the org-level `client_cron_enabled` flag (consumer mode:
 *   always true).
 * - `isCronCreateEnabled` — whether NEW scheduled tasks may be created: the
 *   flag, or an admin/super_admin (the moss server lets admin-capable actors
 *   bypass the cron_disabled_by_org creation gate).
 * - `isCronVisible` — whether the cron UI (sidebar menu entry, scheduled tab,
 *   /app/cron routes) is shown. When the org disables client cron the UI stays
 *   visible for admins and for users who own/co-own at least one existing job
 *   (moss scopes the job list to the caller), so they can still view, edit,
 *   run and delete their existing tasks — only creation is hidden.
 */
export function useCronAccess(): ICronAccess {
  const isCronEnabled = useCronEnabled();
  const { user } = useAuth();
  // Enterprise (moss) roles are lowercase ('admin' | 'super_admin' | ...);
  // consumer roles are uppercase but never reach the disabled branch, since
  // consumer mode is always cron-enabled.
  const role = user?.role?.toLowerCase();
  const isAdminRole = role === 'admin' || role === 'super_admin' || role === 'enterprise_admin';
  const [isOwningJobs, setIsOwningJobs] = useState(false);

  // Probe for owned/co-owned jobs only when the flag alone would hide the UI
  // (enterprise + disabled + non-admin). The remote provider's listJobs is
  // already scoped server-side to the caller's own/co-owned jobs; a fetch
  // failure fails closed (hidden).
  const shouldProbe = !isCronEnabled && !isAdminRole;

  useEffect(() => {
    if (!shouldProbe) {
      return;
    }
    let isMounted = true;
    const probe = () => {
      ipcBridge.cron.listJobs
        .invoke()
        .then((jobs) => {
          // The bridge returns an { __error } envelope (not an array) on failure.
          if (isMounted) setIsOwningJobs(Array.isArray(jobs) && jobs.length > 0);
        })
        .catch(() => {
          if (isMounted) setIsOwningJobs(false);
        });
    };
    probe();
    const unsubCreated = ipcBridge.cron.onJobCreated.on(probe);
    const unsubRemoved = ipcBridge.cron.onJobRemoved.on(probe);
    return () => {
      isMounted = false;
      unsubCreated();
      unsubRemoved();
    };
  }, [shouldProbe]);

  return {
    isCronEnabled,
    isCronCreateEnabled: isCronEnabled || isAdminRole,
    isCronVisible: isCronEnabled || isAdminRole || isOwningJobs,
  };
}

interface ICronAccess {
  /** Org-level client_cron_enabled flag */
  isCronEnabled: boolean;
  /** Whether new scheduled tasks may be created (flag enabled, or admin bypass) */
  isCronCreateEnabled: boolean;
  /** Whether cron menu/tab/routes are shown (enabled, admin, or owns/co-owns ≥1 job) */
  isCronVisible: boolean;
}
