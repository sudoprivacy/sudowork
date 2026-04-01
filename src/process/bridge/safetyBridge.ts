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
import { mainLog, mainError } from '@process/utils/mainLogger';
import { getNexusClient, CONFIG_DIR, readNexusFileAsUtf8 } from '../services/safety/SecurityHookFile';
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
      const service = SafetyPollingService.getInstance();
      if (enabled) {
        // Stop first if already running (skip persist since we'll start immediately)
        mainLog('SafetyBridge', 'Starting safety hook service...');
        await service.stop(false);
        await service.start({ pollingIntervalMs: 5000 });
      } else {
        mainLog('SafetyBridge', 'Stopping safety hook service...');
        await service.stop(true);
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        msg: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // Get blacklist configuration - read directly from Nexus for consistency
  ipcBridge.safety.getBlacklist.provider(async () => {
    try {
      const configStr = await readNexusFileAsUtf8(BLACKLIST_CONFIG_PATH);
      if (!configStr) {
        return { success: true, data: { rules: [] } };
      }
      const config = JSON.parse(configStr);
      return { success: true, data: config || { rules: [] } };
    } catch (err) {
      // If file doesn't exist, return empty config
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes('not found') || errorMsg.includes('FILE_NOT_FOUND')) {
        return { success: true, data: { rules: [] } };
      }
      return {
        success: false,
        msg: errorMsg,
      };
    }
  });

  // Set blacklist configuration - write to Nexus only
  ipcBridge.safety.setBlacklist.provider(async ({ config }: { config: BlacklistConfig }) => {
    try {
      // Sync to Nexus (single source of truth)
      const client = getNexusClient();
      await client.mkdir(CONFIG_DIR, true);
      await client.write(BLACKLIST_CONFIG_PATH, JSON.stringify(config, null, 2));

      // Also save to local storage for persistence across app restarts
      await ProcessConfig.set(BLACKLIST_STORAGE_KEY as any, config);

      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      mainError('SafetyBridge', 'Failed to set blacklist:', errorMsg);

      // Check if it's a Nexus connection error
      if (errorMsg.includes('fetch failed') || errorMsg.includes('ECONNREFUSED') || errorMsg.includes('network') || errorMsg.includes('ENOTFOUND') || errorMsg.includes('ECONNRESET')) {
        return { success: false, msg: `Nexus连接异常: ${errorMsg}` };
      }

      return { success: false, msg: errorMsg };
    }
  });
}
