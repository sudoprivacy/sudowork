/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scode Bridge
 *
 * IPC handlers for reading/writing ~/.nexus/sudocode/sudocode.json.
 * Also exports helper functions for use within the main process.
 */

import { ipcBridge } from '@/common';
import { SCODE_DIR, isScodeInstalled, getScodeVersionState, ensureScodeInstalled } from '@process/services/scode/ScodeInstallService';
import fs from 'fs';
import path from 'path';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

const TAG = 'ScodeBridge';
const SUDOCODE_CONFIG_PATH = path.join(SCODE_DIR, 'sudocode.json');

/** Read existing sudocode.json, returns empty object on failure */
function readExistingConfig(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(SUDOCODE_CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/** Write config to sudocode.json, ensuring directory exists */
function writeConfig(config: Record<string, unknown>): void {
  fs.mkdirSync(SCODE_DIR, { recursive: true });
  fs.writeFileSync(SUDOCODE_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(SUDOCODE_CONFIG_PATH, 0o600);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Update only the default_model field in sudocode.json.
 * Callable directly from main process code (no IPC needed).
 */
export function writeScodeDefaultModel(modelId: string): void {
  const existing = readExistingConfig();
  existing.default_model = modelId;
  writeConfig(existing);
  mainLog(TAG, `Updated default_model to "${modelId}"`);
}

export function registerScodeBridge(): void {
  ipcBridge.scode.getConfig.provider(async () => {
    try {
      const config = readExistingConfig();
      return { success: true, data: config };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWarn(TAG, `Failed to read sudocode.json: ${msg}`);
      return { success: false, msg };
    }
  });

  ipcBridge.scode.saveConfig.provider(async ({ config }) => {
    try {
      const incoming = config as unknown as Record<string, unknown>;
      // Preserve web_search if not included in the incoming config
      if (!incoming.web_search) {
        const existing = readExistingConfig();
        if (existing.web_search) {
          incoming.web_search = existing.web_search;
        }
      }
      writeConfig(incoming);
      mainLog(TAG, 'Saved sudocode.json config');
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWarn(TAG, `Failed to save sudocode.json: ${msg}`);
      return { success: false, msg };
    }
  });

  ipcBridge.scode.setDefaultModel.provider(async ({ modelId }) => {
    try {
      writeScodeDefaultModel(modelId);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWarn(TAG, `Failed to set default model: ${msg}`);
      return { success: false, msg };
    }
  });

  ipcBridge.scode.getStatus.provider(async () => {
    try {
      const installed = isScodeInstalled();
      const { installedVersion } = getScodeVersionState();
      return { success: true, data: { installed, version: installedVersion } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWarn(TAG, `Failed to get scode status: ${msg}`);
      return { success: false, msg };
    }
  });

  let scodeInstalling = false;

  ipcBridge.scode.install.provider(async () => {
    if (scodeInstalling) {
      return { success: true };
    }
    scodeInstalling = true;
    try {
      const ok = await ensureScodeInstalled({
        forceReinstall: true,
        onProgress: (percent) => {
          ipcBridge.scode.installProgress.emit({ phase: 'installing', percent });
        },
      });
      if (ok) {
        ipcBridge.scode.installResult.emit({ success: true });
      } else {
        ipcBridge.scode.installResult.emit({ success: false, msg: 'Scode installation failed' });
      }
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWarn(TAG, `Scode install error: ${msg}`);
      ipcBridge.scode.installResult.emit({ success: false, msg });
      return { success: false, msg };
    } finally {
      scodeInstalling = false;
    }
  });
}
