/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { sudoworkServer } from '@/common/ipcBridge';
import { SUDOWORK_SERVER_BASE_URL } from '@/common/sudoworkServer';

export function initSudoworkServerBridge(): void {
  sudoworkServer.getConfig.provider(async () => {
    // Always return hardcoded URL, ignore any saved config
    return { baseUrl: SUDOWORK_SERVER_BASE_URL };
  });

  sudoworkServer.updateConfig.provider(async (_config) => {
    // No-op: server URL is now hardcoded and cannot be changed via config
    // This handler exists for backward compatibility but does nothing
  });
}
