import { ipcBridge } from '../../common';
import { libreOfficeService } from '../services/libreoffice/LibreOfficeService';

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

  ipcBridge.libreOffice.install.provider(async () => {
    try {
      await libreOfficeService.install((phase, percent) => {
        ipcBridge.libreOffice.installProgress.emit({ phase, percent });
      });
      ipcBridge.libreOffice.installResult.emit({ success: true });
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ipcBridge.libreOffice.installResult.emit({ success: false, msg });
      return { success: false, msg };
    }
  });
}
