/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Safety Bridge
 *
 * IPC bridge for safety hook service between main and renderer processes.
 */

import { ipcBridge } from '@/common';
import { ProcessConfig } from '@/process/initStorage';
import { SafetyPollingService } from '../services/safety/SafetyPollingService';
import { getNexusClient, CONFIG_DIR } from '../services/safety/SecurityHookFile';
import type { BlacklistConfig } from '@/common/safetyTypes';

const BLACKLIST_CONFIG_PATH = '/safe/config/blacklist';
const BLACKLIST_STORAGE_KEY = 'safetyHook.blacklist';

export function initSafetyBridge(): void {
  // Get current safety status
  ipcBridge.safety.getStatus.provider(async () => {
    try {
      const service = SafetyPollingService.getInstance();
      const status = service.getStatus();
      return { success: true, data: status };
    } catch (err) {
      return {
        success: false,
        msg: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Get service enabled status
  ipcBridge.safety.getEnabled.provider(async () => {
    try {
      const service = SafetyPollingService.getInstance();
      return { success: true, data: { enabled: service.isEnabled() } };
    } catch (err) {
      return {
        success: false,
        msg: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // User confirmation action
  ipcBridge.safety.confirm.provider(async ({ allow, reason }) => {
    try {
      const service = SafetyPollingService.getInstance();

      // Write user response to /safe/action/{uuid}
      await service.handleUserConfirmation(allow, reason);

      return { success: true };
    } catch (err) {
      return {
        success: false,
        msg: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Enable/disable safety hook service
  ipcBridge.safety.setEnabled.provider(async ({ enabled }) => {
    try {
      console.log(`[SafetyBridge] Setting safety hook ${enabled ? 'enabled' : 'disabled'}`);
      const service = SafetyPollingService.getInstance();
      if (enabled) {
        // Stop first if already running, then start
        console.log('[SafetyBridge] Stopping and starting service...');
        await service.stop();
        await service.start({ pollingIntervalMs: 5000 });
      } else {
        console.log('[SafetyBridge] Stopping service...');
        await service.stop();
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        msg: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Get blacklist configuration
  ipcBridge.safety.getBlacklist.provider(async () => {
    try {
      const config = await ProcessConfig.get(BLACKLIST_STORAGE_KEY as any);
      return { success: true, data: config || { rules: [] } };
    } catch (err) {
      return {
        success: false,
        msg: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Set blacklist configuration
  ipcBridge.safety.setBlacklist.provider(async ({ config }: { config: BlacklistConfig }) => {
    try {
      // Save to local storage
      await ProcessConfig.set(BLACKLIST_STORAGE_KEY as any, config);

      // Sync to Nexus
      const client = getNexusClient();
      await client.mkdir(CONFIG_DIR, true);
      await client.write(BLACKLIST_CONFIG_PATH, JSON.stringify(config, null, 2));

      // Hook processes will read updated config from Nexus via polling

      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[SafetyBridge] Failed to set blacklist:', errorMsg);
      return { success: false, msg: errorMsg };
    }
  });
}
