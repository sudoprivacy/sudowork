/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { initStatusManager } from '../services/initStatus';

export function initInitBridge(): void {
  ipcBridge.init.getStatus.provider(async () => {
    return { success: true, data: initStatusManager.getStatus() };
  });

  // Subscribe to status changes and broadcast to renderer
  initStatusManager.subscribe((status) => {
    ipcBridge.init.onStatusChange.emit(status);
  });
}
