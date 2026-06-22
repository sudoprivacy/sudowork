/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * IPC bridge for FUSE-T (macOS userspace FUSE driver) provisioning.
 *
 * Surfaces `fuseT.checkInstalled` + `fuseT.ensureInstalled` to the renderer
 * and any worker-process consumer (sudocode mount path, future "enable
 * cross-machine mount" UI). NOT wired into `RuntimeInstaller.ensureAll()`
 * — every call is opt-in, triggered by code that's about to need a FUSE
 * mount. See `FuseTInstallService` for the rationale.
 */

import { ipcBridge } from '../../common';
import type { FuseTInstallPhase } from '../services/fuset/FuseTInstallService';
import { fuseTInstallService } from '../services/fuset/FuseTInstallService';

interface InstallState {
  installing: boolean;
  phase?: FuseTInstallPhase;
  percent?: number;
}

let installState: InstallState = { installing: false };

export function initFuseTBridge(): void {
  ipcBridge.fuseT.checkInstalled.provider(async () => {
    try {
      const status = await fuseTInstallService.checkInstalled();
      return { success: true, data: status };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.fuseT.getInstallState.provider(async () => {
    return { success: true, data: installState };
  });

  ipcBridge.fuseT.ensureInstalled.provider(async () => {
    if (installState.installing) {
      return { success: false, msg: 'FUSE-T install already in progress' };
    }
    installState = { installing: true };
    try {
      await fuseTInstallService.ensureInstalled((phase, percent) => {
        installState = { installing: true, phase, percent };
        ipcBridge.fuseT.installProgress.emit({ phase, percent });
      });
      ipcBridge.fuseT.installResult.emit({ success: true });
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ipcBridge.fuseT.installResult.emit({ success: false, msg });
      return { success: false, msg };
    } finally {
      setTimeout(() => {
        installState = { installing: false };
      }, 0);
    }
  });
}
