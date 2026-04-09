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
import { SafetyPollingService } from '../services/safety/SafetyPollingService';
import { mainLog, mainError } from '@process/utils/mainLogger';
import { getNexusClient, CONFIG_DIR, readHookConfig, writeHookConfig, HOOK_CONFIG_PATH, DEFAULT_HOOK_CONFIG } from '../services/safety/SecurityHookFile';
import type { BlacklistConfig } from '@/common/safetyTypes';

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
        mainLog('SafetyBridge', 'Starting safety hook service...');
        await service.start({ pollingIntervalMs: 3000 }, true);
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

  // Get blacklist configuration - read from unified hook config
  ipcBridge.safety.getBlacklist.provider(async () => {
    try {
      const hookConfig = await readHookConfig();
      if (!hookConfig || !hookConfig.blacklist) {
        return { success: true, data: { rules: [] } };
      }
      return { success: true, data: hookConfig.blacklist as BlacklistConfig || { rules: [] } };
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

  // Set blacklist configuration - write to unified hook config (read-merge-write)
  ipcBridge.safety.setBlacklist.provider(async ({ config }: { config: BlacklistConfig }) => {
    try {
      const client = getNexusClient();
      await client.mkdir(CONFIG_DIR, true);
      // Read-merge-write: preserve existing enabled/fastPass state
      const existing = await readHookConfig();
      const merged = {
        ...(existing || DEFAULT_HOOK_CONFIG),
        blacklist: config,
      };
      await writeHookConfig(merged);

      // Invalidate cache so next poll will pick up the new config
      SafetyPollingService.getInstance().invalidateBlacklistCache();

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
