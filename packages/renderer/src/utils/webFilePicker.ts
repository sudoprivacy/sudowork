import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { isElectronDesktop } from '@renderer/utils/platform';

declare global {
  interface Window {
    /**
     * Staging table for files picked in the WebUI browser host: the renderer writes
     * pseudo-path → File entries here, and the webui mossAdapter consumes them when
     * `chat.send.message` dispatches (same cross-layer convention as `__sudoworkWebBridge`).
     */
    __sudoworkWebFileStaging?: Map<string, File>;
  }
}

const WEB_UPLOAD_PREFIX = '/webupload/';
const CANCEL_PROBE_DELAY_MS = 300;

let stagingSeq = 0;

function ensureStagingMap(): Map<string, File> {
  if (!window.__sudoworkWebFileStaging) {
    window.__sudoworkWebFileStaging = new Map<string, File>();
  }
  return window.__sudoworkWebFileStaging;
}

// Not crypto.randomUUID: it is only available in secure contexts, while the WebUI
// can be deployed as plain http://host:port.
function nextWebUploadId(): string {
  stagingSeq += 1;
  return `${Date.now().toString(36)}-${stagingSeq}-${Math.random().toString(36).slice(2, 10)}`;
}

function stageFiles(files: FileList | File[]): string[] {
  const staging = ensureStagingMap();
  return Array.from(files).map((file) => {
    const webPath = `${WEB_UPLOAD_PREFIX}${nextWebUploadId()}/${file.name}`;
    staging.set(webPath, file);
    return webPath;
  });
}

// Browsers expose no direct cancel signal for <input type="file">: the window
// regains focus right after the native dialog closes, so treat "focused and
// still no change after a short delay" as cancelled.
function pickFilesViaInput(): Promise<string[] | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';

    let isSettled = false;
    const settle = (paths: string[] | null) => {
      if (isSettled) return;
      isSettled = true;
      window.removeEventListener('focus', onWindowFocus);
      input.remove();
      resolve(paths);
    };
    const onWindowFocus = () => {
      window.setTimeout(() => {
        if (!isSettled && !(input.files && input.files.length > 0)) settle(null);
      }, CANCEL_PROBE_DELAY_MS);
    };

    input.addEventListener('change', () => {
      if (input.files && input.files.length > 0) {
        settle(stageFiles(input.files));
      } else {
        settle(null);
      }
    });
    window.addEventListener('focus', onWindowFocus);
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Unified local-file picker for the send boxes: Electron opens the native dialog
 * over the bridge channel; WebUI opens a browser file input and returns pseudo
 * paths (`/webupload/<id>/<name>`) backed by the staging table.
 * Returns the picked paths, or null on cancel/failure.
 */
export async function pickLocalFilePaths(): Promise<string[] | null> {
  if (isElectronDesktop()) {
    try {
      const res = await ipcBridge.dialog.showOpen.invoke({ properties: ['openFile', 'multiSelections'] });
      if (res?.success && res.data && !res.data.canceled && res.data.filePaths.length > 0) {
        return res.data.filePaths;
      }
      return null;
    } catch (error) {
      console.error('Failed to open file dialog:', error);
      return null;
    }
  }
  return pickFilesViaInput();
}
