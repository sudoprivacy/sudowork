/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { zzapiCliService } from '../services/zzapi/ZzapiCliService';

export function initZzapiBridge(): void {
  ipcBridge.zzapiCli.checkInstalled.provider(async () => {
    try {
      return { success: true, data: await zzapiCliService.checkInstalled() };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.zzapiCli.install.provider(async () => {
    try {
      await zzapiCliService.install();
      ipcBridge.zzapiCli.installResult.emit({ success: true });
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ipcBridge.zzapiCli.installResult.emit({ success: false, msg });
      return { success: false, msg };
    }
  });

  ipcBridge.zzapiCli.uninstall.provider(async () => {
    try {
      await zzapiCliService.uninstall();
      return { success: true };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });
}
