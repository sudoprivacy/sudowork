import { ipcBridge } from '../../common';
import type { InstallPhase } from '../services/python/PythonRuntimeService';
import { pythonRuntimeService } from '../services/python/PythonRuntimeService';

interface InstallState {
  installing: boolean;
  phase?: InstallPhase;
  percent?: number;
}

let installState: InstallState = { installing: false };

export function initPythonRuntimeBridge(): void {
  ipcBridge.pythonRuntime.checkInstalled.provider(async () => {
    try {
      const status = await pythonRuntimeService.checkInstalled();
      return {
        success: true,
        data: {
          installed: status.installed,
          version: status.version,
          path: status.path,
          source: 'system' as const,
        },
      };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.pythonRuntime.getInstallState.provider(async () => {
    return { success: true, data: installState };
  });

  ipcBridge.pythonRuntime.install.provider(async () => {
    installState = { installing: true };
    try {
      await pythonRuntimeService.install((phase, percent) => {
        installState = { installing: true, phase, percent };
        ipcBridge.pythonRuntime.installProgress.emit({ phase, percent });
      });
      ipcBridge.pythonRuntime.installResult.emit({ success: true });
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ipcBridge.pythonRuntime.installResult.emit({ success: false, msg });
      return { success: false, msg };
    } finally {
      // Delay reset so renderer gets final progress + result events before state clears
      setTimeout(() => {
        installState = { installing: false };
      }, 0);
    }
  });

  ipcBridge.pythonRuntime.uninstall.provider(async () => {
    try {
      await pythonRuntimeService.uninstall();
      return { success: true };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });
}
