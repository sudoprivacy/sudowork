/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { getAppMode, setAppMode } from '@/common/eeclawMode';

let initialModePromise: Promise<void> | null = null;
let isInitialModeResolved = false;
let isAppModeMissing = false;
let isAppModeBridgeReady = false;
let cachedMode: 'c' | 'e' | null = null;
const appModeBridgeListeners = new Set<() => void>();

function onAppModeBridgeReadyChange(onStoreChange: () => void): () => void {
  appModeBridgeListeners.add(onStoreChange);
  return () => appModeBridgeListeners.delete(onStoreChange);
}

function getAppModeBridgeReadySnapshot(): boolean {
  return isAppModeBridgeReady;
}

export function markAppModeBridgeReady(): void {
  if (isAppModeBridgeReady) return;
  isAppModeBridgeReady = true;
  for (const onStoreChange of appModeBridgeListeners) {
    onStoreChange();
  }
}

function initializeAppMode(): Promise<void> {
  if (initialModePromise) return initialModePromise;

  initialModePromise = getAppMode()
    .then((mode) => {
      cachedMode = mode ?? 'c';
      isAppModeMissing = mode === null;

      // Old user upgrade: has sudowork_auth_v2 but no appMode → auto-set 'c'
      if (mode === null && localStorage.getItem('sudowork_auth_v2')) {
        void setAppMode('c').catch((error) => {
          console.error('[useAppMode] Failed to auto-set consumer mode for upgrading user:', error);
        });
      }
    })
    .catch((error) => {
      console.error('[useAppMode] Failed to get initial mode:', error);
      cachedMode = 'c';
      isAppModeMissing = false;
    })
    .finally(() => {
      isInitialModeResolved = true;
    });

  return initialModePromise;
}

function getAppModeState(): IAppModeState {
  const mode = cachedMode ?? 'c';
  const isSetupNeeded = isInitialModeResolved && isAppModeMissing && typeof window !== 'undefined' && !localStorage.getItem('sudowork_auth_v2');
  return { mode, isEnterprise: mode === 'e', isSetupNeeded, isModeResolved: isInitialModeResolved };
}

export function useAppMode(): IAppModeState {
  const isBridgeReady = useSyncExternalStore(onAppModeBridgeReadyChange, getAppModeBridgeReadySnapshot, () => false);
  const [appModeState, setAppModeState] = useState<IAppModeState>(getAppModeState);

  useEffect(() => {
    if (!isBridgeReady || appModeState.isModeResolved) return;

    let isCancelled = false;
    void initializeAppMode().then(() => {
      if (!isCancelled) {
        setAppModeState(getAppModeState());
      }
    });
    return () => {
      isCancelled = true;
    };
  }, [appModeState.isModeResolved, isBridgeReady]);

  return appModeState;
}

/**
 * Check if the pre-initialization has resolved.
 * Used in main.tsx guard to prevent first-frame flash.
 */
export function isModeResolved(): boolean {
  return isInitialModeResolved;
}

/**
 * Get the cached mode synchronously (may be null if not yet resolved)
 */
export function getCachedMode(): 'c' | 'e' | null {
  return cachedMode;
}

interface IAppModeState {
  mode: 'c' | 'e';
  isEnterprise: boolean;
  isSetupNeeded: boolean;
  isModeResolved: boolean;
}
