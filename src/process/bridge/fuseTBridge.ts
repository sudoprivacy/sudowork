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
import { mainLog } from '../utils/mainLogger';

const TAG = 'FuseTBridge';

interface InstallState {
  installing: boolean;
  phase?: FuseTInstallPhase;
  percent?: number;
}

let installState: InstallState = { installing: false };

export function initFuseTBridge(): void {
  mainLog(TAG, 'initFuseTBridge() entered');
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
      // Reset synchronously. A prior setTimeout(..., 0) deferral leaked
      // `installing: true` to any caller that read `getInstallState()`
      // in the same tick as the provider resolving — observed in the
      // 2026-06-24 Win cold-start smoke after a `runLazyInstallProbe()`
      // returning `platform-unsupported`. Setting in `finally` runs
      // before the returned promise resolves to the renderer.
      installState = { installing: false };
    }
  });

  // Lazy install probe — the legitimate caller for `ensureInstalled`.
  // Routes through `FuseTSupervisor`, which probes the fuse plugin's
  // `dispatch("status")` first and only triggers the installer when
  // the plugin actually reports `fuse-t-missing`. The supervisor
  // forwards install progress through the same emitters as the
  // direct `ensureInstalled` channel, so any UI already listening
  // to `installProgress` / `installResult` doesn't need a second
  // subscription. Re-entrancy is guarded by the shared `installState`
  // flag below.
  ipcBridge.fuseT.runLazyInstallProbe.provider(async () => {
    if (installState.installing) {
      return { success: false, msg: 'FUSE-T install already in progress' };
    }
    installState = { installing: true };
    try {
      // Build a per-call supervisor so the install-progress callback
      // wired here doesn't leak into a long-lived singleton's state.
      // `getFuseTSupervisor()` is still the path callers outside the
      // bridge use for the default no-progress flow.
      const { FuseTSupervisor } = await import('../services/fuset/FuseTSupervisor');
      const supervisor = new FuseTSupervisor({
        onInstallProgress: (phase, percent) => {
          installState = { installing: true, phase, percent };
          ipcBridge.fuseT.installProgress.emit({ phase, percent });
        },
      });
      const result = await supervisor.runLazyInstallProbe();
      if (result.outcome === 'installed-and-mounted' || result.outcome === 'installed-but-not-mounted') {
        ipcBridge.fuseT.installResult.emit({ success: true });
      } else if (result.outcome === 'install-failed') {
        ipcBridge.fuseT.installResult.emit({ success: false, msg: result.errorMessage });
      }
      return { success: true, data: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ipcBridge.fuseT.installResult.emit({ success: false, msg });
      return { success: false, msg };
    } finally {
      installState = { installing: false };
    }
  });
  mainLog(TAG, 'FUSE-T IPC providers registered');
}
