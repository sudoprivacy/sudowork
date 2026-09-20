/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { getAppMode, setAppMode } from '@sudowork/host-bridge/eeclawMode';

// Pre-initialize app mode on module load (avoids first-frame flash)
// Follows the same early-initialization pattern as useTheme.ts
let initialModePromise: Promise<'c' | 'e'> | null = null;
let initialModeResolved = false;
let cachedMode: 'c' | 'e' | null = null; // cache for synchronous access

if (typeof window !== 'undefined') {
  initialModePromise = getAppMode()
    .then(async (mode) => {
      const isTestEnvironment = import.meta.env.MODE === 'test' || (typeof process !== 'undefined' && process.env.NODE_ENV === 'test');
      if (isTestEnvironment) {
        initialModeResolved = true;
        cachedMode = mode ?? 'c';
        return cachedMode;
      }
      const isOfflineSession = Boolean(localStorage.getItem('sudowork_guest'));
      const targetMode = isOfflineSession ? 'c' : 'e';
      if (!isOfflineSession) {
        // Consumer-server tokens are not valid Moss credentials. Clear only
        // retired auth records; conversations and local settings stay intact.
        localStorage.removeItem('sudowork_auth_v2');
        localStorage.removeItem('sudowork_auth_v1');
      }
      if (mode !== targetMode) {
        // `appMode` remains an internal execution-context compatibility key.
        // Online users always use Moss; only explicit offline use stays local.
        await setAppMode(targetMode);
      }
      initialModeResolved = true;
      cachedMode = targetMode;
      return cachedMode;
    })
    .catch((error) => {
      console.error('[useAppMode] Failed to get initial mode:', error);
      initialModeResolved = true;
      cachedMode = 'c';
      return 'c' as const;
    });
}

export function useAppMode(): { mode: 'c' | 'e'; isEnterprise: boolean; needsSetup: false } {
  const [mode, setMode] = useState<'c' | 'e'>(() => {
    // Use cached mode if already resolved. The temporary value is hidden by
    // isModeResolved(), so it cannot expose the retired mode-selection UI.
    if (cachedMode !== null) {
      return cachedMode;
    }
    return 'c';
  });

  useEffect(() => {
    void initialModePromise?.then((resolvedMode) => {
      setMode(resolvedMode);
    });
  }, []);

  const isEnterprise = mode === 'e';

  return { mode, isEnterprise, needsSetup: false };
}

/**
 * Check if the pre-initialization has resolved.
 * Used in main.tsx guard to prevent first-frame flash.
 */
export function isModeResolved(): boolean {
  return initialModeResolved;
}

/**
 * Get the cached mode synchronously (may be null if not yet resolved)
 */
export function getCachedMode(): 'c' | 'e' | null {
  return cachedMode;
}
