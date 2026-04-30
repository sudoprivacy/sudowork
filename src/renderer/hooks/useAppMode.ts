/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAppMode } from '@/common/eeclawMode';
import { useEffect, useState } from 'react';

// Pre-initialize app mode on module load (avoids first-frame flash)
// Follows the same pattern as useColorScheme.ts
let initialModePromise: Promise<'c' | 'e'> | null = null;
let initialModeResolved = false;
let appModeWasNull = false; // true when ConfigStorage had no appMode (true new user)

if (typeof window !== 'undefined') {
  initialModePromise = getAppMode().then((mode) => {
    initialModeResolved = true;
    appModeWasNull = mode === null; // null = new user who never chose a mode
    return mode ?? 'c'; // getAppMode() returns null for new users, fallback to 'c'
    // needsSetup is determined by appModeWasNull, not by the mode value itself
  }).catch(() => {
    initialModeResolved = true;
    return 'c' as const;
  });
}

export function useAppMode(): { mode: 'c' | 'e'; isEnterprise: boolean; needsSetup: boolean } {
  const [mode, setMode] = useState<'c' | 'e'>(() => {
    return 'c'; // safe default
  });

  useEffect(() => {
    initialModePromise?.then((resolvedMode) => {
      setMode(resolvedMode);
    });
  }, []);

  const isEnterprise = mode === 'e';

  // needsSetup: whether to show ModeSetup (new user first launch)
  // Uses appModeWasNull to determine: ConfigStorage has no appMode = true new user
  // Old user upgrade scenario: appMode null + sudowork_auth_v2 exists → main.tsx auto-sets 'c'
  // After restart: appMode = 'c' → appModeWasNull = false → needsSetup = false
  const needsSetup = initialModeResolved && appModeWasNull
    && typeof window !== 'undefined'
    && !localStorage.getItem('sudowork_auth_v2');

  return { mode, isEnterprise, needsSetup };
}

/**
 * Check if the pre-initialization has resolved.
 * Used in main.tsx guard to prevent first-frame flash.
 */
export function isModeResolved(): boolean {
  return initialModeResolved;
}
