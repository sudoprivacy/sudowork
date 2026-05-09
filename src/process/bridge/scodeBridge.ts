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
import { SCODE_DIR } from '@process/services/scode/ScodeInstallService';
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
      writeConfig(config as unknown as Record<string, unknown>);
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
}
