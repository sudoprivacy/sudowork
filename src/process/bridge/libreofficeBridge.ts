import { ipcBridge } from '../../common';
import type { InstallPhase } from '../services/libreoffice/LibreOfficeService';
import { libreOfficeService } from '../services/libreoffice/LibreOfficeService';

interface InstallState {
  installing: boolean;
  phase?: InstallPhase;
  percent?: number;
}

let installState: InstallState = { installing: false };

export function initLibreOfficeBridge(): void {
  ipcBridge.libreOffice.checkInstalled.provider(async () => {
    try {
      return { success: true, data: await libreOfficeService.checkInstalled() };
    } catch (err) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.libreOffice.getDownloadUrl.provider(async () => {
    return { success: true, data: { url: libreOfficeService.getDownloadUrl() } };
  });

  ipcBridge.libreOffice.getInstallState.provider(async () => {
    return { success: true, data: installState };
  });

  ipcBridge.libreOffice.install.provider(async () => {
    installState = { installing: true };
    try {
      await libreOfficeService.install((phase, percent) => {
        installState = { installing: true, phase, percent };
        ipcBridge.libreOffice.installProgress.emit({ phase, percent });
      });
      ipcBridge.libreOffice.installResult.emit({ success: true });
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ipcBridge.libreOffice.installResult.emit({ success: false, msg });
      return { success: false, msg };
    } finally {
      installState = { installing: false };
    }
  });
}
