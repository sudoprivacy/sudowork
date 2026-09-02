import { ipcBridge } from '../../common';
import type { PopplerInstallPhase } from '../services/poppler/PopplerRuntimeService';
import { popplerRuntimeService } from '../services/poppler/PopplerRuntimeService';

interface IInstallState {
  installing: boolean;
  phase?: PopplerInstallPhase;
  percent?: number;
}

let installState: IInstallState = { installing: false };

export function initPopplerRuntimeBridge(): void {
  ipcBridge.popplerRuntime.checkInstalled.provider(async () => {
    try {
      const managedStatus = await popplerRuntimeService.checkManaged();
      const status = managedStatus.installed ? managedStatus : await popplerRuntimeService.checkInstalled();
      return {
        success: true,
        data: {
          installed: status.installed,
          version: status.version,
          path: status.path,
          source: managedStatus.installed ? ('managed' as const) : status.installed ? ('system' as const) : ('none' as const),
        },
      };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.popplerRuntime.getInstallState.provider(async () => ({ success: true, data: installState }));

  ipcBridge.popplerRuntime.install.provider(async () => {
    installState = { installing: true };
    try {
      await popplerRuntimeService.install((phase, percent) => {
        installState = { installing: true, phase, percent };
        ipcBridge.popplerRuntime.installProgress.emit({ phase, percent });
      });
      ipcBridge.popplerRuntime.installResult.emit({ success: true });
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ipcBridge.popplerRuntime.installResult.emit({ success: false, msg });
      return { success: false, msg };
    } finally {
      setTimeout(() => {
        installState = { installing: false };
      }, 0);
    }
  });

  ipcBridge.popplerRuntime.uninstall.provider(async () => {
    try {
      await popplerRuntimeService.uninstall();
      return { success: true };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });
}
