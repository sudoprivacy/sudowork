/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigStorage } from './storage';
import { eeclaw } from './ipcBridge';

// Check if running in renderer process (has electronAPI)
const isRenderer = typeof window !== 'undefined' && Boolean(window.electronAPI);

/**
 * Get the current app mode.
 * Returns 'c' (consumer), 'e' (enterprise), or null (not set / new user).
 * null is distinct from 'c' — it means the user has never chosen a mode.
 */
export async function getAppMode(): Promise<'c' | 'e' | null> {
  const mode = await ConfigStorage.get('system.appMode');
  return mode ?? null;
}

/**
 * Check if the app is in enterprise mode.
 */
export async function isEnterpriseMode(): Promise<boolean> {
  return (await getAppMode()) === 'e';
}

/**
 * Check if the user has already chosen a mode (appMode is set).
 */
export async function hasAppMode(): Promise<boolean> {
  return (await getAppMode()) !== null;
}

/**
 * Set the app mode.
 * Renderer mode changes must go through main so the data root can switch
 * atomically before renderer-side ConfigStorage writes hit the new root.
 */
export async function setAppMode(mode: 'c' | 'e', options: { orchestrate?: boolean } = {}): Promise<void> {
  if (isRenderer && options.orchestrate !== false) {
    await eeclaw.setAppMode.invoke({ mode });
    return;
  }

  await ConfigStorage.set('system.appMode', mode);
}
