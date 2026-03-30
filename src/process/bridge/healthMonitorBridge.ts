/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '../../common';
import { componentHealthMonitor } from '../services/serviceManager/ComponentHealthMonitor';

export function initHealthMonitorBridge(): void {
  ipcBridge.healthMonitor.getStatus.provider(async () => {
    return { success: true, data: { enabled: true } };
  });

  ipcBridge.healthMonitor.enable.provider(async () => {
    await componentHealthMonitor.start();
    return { success: true };
  });

  ipcBridge.healthMonitor.disable.provider(async () => {
    await componentHealthMonitor.stop();
    return { success: true };
  });
}
