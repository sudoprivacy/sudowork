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
        service.stop();
        await service.start({ pollingIntervalMs: 5000 });
      } else {
        console.log('[SafetyBridge] Stopping service...');
        service.stop();
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        msg: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
