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

import { app, ipcMain } from 'electron';

import { ipcBridge } from '../../common';
import type { FuseTInstallPhase } from '../services/fuset/FuseTInstallService';
import { fuseTInstallService } from '../services/fuset/FuseTInstallService';
import { mainLog } from '../utils/mainLogger';

const TAG = 'FuseTBridge';

interface InstallState {
  installing: boolean;
  phase?: FuseTInstallPhase;
  percent?: number;
}

let installState: InstallState = { installing: false };

export function initFuseTBridge(): void {
  mainLog(TAG, `initFuseTBridge() entered (app.isPackaged=${app.isPackaged})`);
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

  // Dev-only direct IPC handles for the Mac smoke checklist (#915).
  //
  // The production renderer talks to FUSE-T via the bridge providers above
  // (`ipcBridge.fuseT.ensureInstalled.invoke()`), which uses
  // `@office-ai/platform`'s subscribe/callback RPC protocol. DevTools console
  // cannot reach the bundled `ipcBridge` module, so a Mac smoke tester can't
  // drive that path from the console. These direct `ipcMain.handle` channels
  // let them call `window.electronAPI.devFuseT*` instead, but they ONLY
  // register in dev mode — packaged builds expose nothing extra and the
  // window.electronAPI.devFuseT* methods come back with "not handled" errors.
  if (!app.isPackaged) {
    ipcMain.handle('dev.fuse-t.check-installed', async () => {
      try {
        const status = await fuseTInstallService.checkInstalled();
        return { success: true, data: status };
      } catch (err) {
        return { success: false, msg: err instanceof Error ? err.message : String(err) };
      }
    });

    ipcMain.handle('dev.fuse-t.ensure-installed', async () => {
      try {
        await fuseTInstallService.ensureInstalled();
        return { success: true };
      } catch (err) {
        return { success: false, msg: err instanceof Error ? err.message : String(err) };
      }
    });

    ipcMain.handle('dev.fuse-t.probe', async () => {
      try {
        const probe = await fuseTInstallService.runProbe();
        return { success: true, data: probe };
      } catch (err) {
        return { success: false, msg: err instanceof Error ? err.message : String(err) };
      }
    });
    mainLog(TAG, 'Registered dev IPC handles: dev.fuse-t.check-installed, dev.fuse-t.ensure-installed, dev.fuse-t.probe');
  } else {
    mainLog(TAG, 'Skipped dev IPC handles (app.isPackaged=true)');
  }
}
