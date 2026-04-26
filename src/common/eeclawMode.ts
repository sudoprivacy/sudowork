/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Enterprise mode (eeclaw) detection and control
 *
 * The app can run in two modes:
 * - Consumer ('c'): default, local CLI agents
 * - Enterprise ('e'): server-side agents, cloud sync
 */

import { ConfigStorage } from '@/common/storage';
import type { AppMode } from '@/common/types/eeclawTypes';

const APP_MODE_KEY = 'system.appMode';

/**
 * Get current app mode
 * Defaults to 'c' (consumer) if not set
 */
export async function getAppMode(): Promise<AppMode> {
  const mode = await ConfigStorage.get<AppMode>(APP_MODE_KEY);
  return mode ?? 'c';
}

/**
 * Set app mode
 */
export async function setAppMode(mode: AppMode): Promise<void> {
  await ConfigStorage.set(APP_MODE_KEY, mode);
}

/**
 * Check if app is in enterprise mode (synchronous check, reads cached or storage)
 * Returns false if mode is not yet loaded
 */
export function isEnterpriseModeSync(): boolean {
  // This sync check is only available after the mode has been loaded once
  // via getAppMode() and cached. For the initial check, use getAppMode().
  // For now, we'll rely on the async version.
  return false;
}

/**
 * Check if app is in enterprise mode (async)
 */
export async function isEnterpriseMode(): Promise<boolean> {
  return (await getAppMode()) === 'e';
}

/**
 * Check if app is in consumer mode (async)
 */
export async function isConsumerMode(): Promise<boolean> {
  return (await getAppMode()) === 'c';
}
