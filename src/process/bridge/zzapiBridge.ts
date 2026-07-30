/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ProcessConfig } from '@process/initStorage';
import { zzapiCliService } from '../services/zzapi/ZzapiCliService';
import { hasZzapiCredentials, isZzapiEnabled, refreshZzapiCredentials, testZzapiCredentials } from '../services/zzapi/zzapiCredentials';

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

  ipcBridge.zzapiCli.testCredentials.provider(async ({ appKey, appSecret }) => {
    try {
      return { success: true, data: await testZzapiCredentials(appKey, appSecret) };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.zzapiCli.getEnabled.provider(async () => {
    try {
      // Re-read so the answer reflects credentials saved since the last prefetch.
      if (!hasZzapiCredentials()) await refreshZzapiCredentials();
      return { success: true, data: { enabled: isZzapiEnabled(), hasCredentials: hasZzapiCredentials() } };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.zzapiCli.setEnabled.provider(async ({ enabled }) => {
    try {
      await ProcessConfig.set('zzapi.enabled', enabled);
      return { success: true };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
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
