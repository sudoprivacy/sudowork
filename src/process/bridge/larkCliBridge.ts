/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { larkCliService } from '../services/larkCli/LarkCliService';

export function initLarkCliBridge(): void {
  ipcBridge.larkCli.checkInstalled.provider(async () => {
    try {
      return { success: true, data: await larkCliService.checkInstalled() };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.larkCli.install.provider(async () => {
    try {
      await larkCliService.install();
      ipcBridge.larkCli.installResult.emit({ success: true });
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ipcBridge.larkCli.installResult.emit({ success: false, msg });
      return { success: false, msg };
    }
  });
}
