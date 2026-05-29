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
 * In renderer process, also notifies main process to update cache.
 */
export async function setAppMode(mode: 'c' | 'e'): Promise<void> {
  await ConfigStorage.set('system.appMode', mode);

  // In renderer process, notify main process to update cache
  // 在渲染进程中，通知主进程更新缓存
  if (isRenderer) {
    try {
      await eeclaw.setAppMode.invoke({ mode });
    } catch (error) {
      // IPC call failed, but ConfigStorage.set already succeeded
      // IPC 调用失败，但 ConfigStorage.set 已成功
      console.warn('Failed to notify main process of app mode change:', error);
    }
  }
}
