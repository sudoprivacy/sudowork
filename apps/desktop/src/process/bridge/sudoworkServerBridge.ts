/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { sudoworkServer } from '@sudowork/host-bridge/ipcBridge';
import { getSudoworkServerBaseUrlSync } from '@process/initStorage';

export function initSudoworkServerBridge(): void {
  sudoworkServer.getConfig.provider(async () => {
    // Resolve on every call so user-updated `system.sudoworkServerUrl` takes effect immediately.
    return { baseUrl: getSudoworkServerBaseUrlSync() };
  });

  sudoworkServer.updateConfig.provider(async (_config) => {
    // No-op: this legacy IPC channel does not own writes to the new
    // `system.sudoworkServerUrl` setting (ModeSetup writes ConfigStorage directly).
    // Kept for backward compatibility with renderer code that may still invoke it.
  });
}
