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
import { readSettings, writeSettings } from '@process/services/mcpServices/agents/ScodeMcpAgent';
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

  // Sync model field to settings.json (scode reads "model" from settings.json)
  try {
    const settings = readSettings();
    settings.model = modelId;
    writeSettings(settings);
    mainLog(TAG, `Synced model "${modelId}" to settings.json`);
  } catch (err) {
    mainWarn(TAG, `Failed to sync model to settings.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Update the image generation model in sudocode.json tools.imageGenerationModel.
 * Used by ServiceManager to keep the model in sync so the image-generation skill
 * bash script can read it without depending on sudoclaw.json.
 */
export function writeScodeImageModel(modelId: string): void {
  const existing = readExistingConfig();
  const tools = (existing.tools as Record<string, unknown>) || {};
  existing.tools = { ...tools, imageGenerationModel: modelId };
  writeConfig(existing);
  mainLog(TAG, `Updated tools.imageGenerationModel to "${modelId}"`);
}

/** Live model-list endpoint — same as the legacy OpenClaw model source. */
const SPECIFIC_PRICING_URL = 'https://hk.sudorouter.ai/api/specific_pricing';

type SpecificPricingResponse = {
  success?: boolean;
  data?: Array<{ model_id?: string }>;
};

/**
 * Fetch the live model list from sudorouter's specific_pricing endpoint and
 * rewrite ONLY the `models` dict of sudocode.json. Preserves auth_modes /
 * default_model / web_search / tools.
 *
 * Best-effort: on any fetch/parse failure (offline, timeout, success=false)
 * this is a no-op — sudocode.json keeps its existing models so the dropdown
 * degrades to the last-known list instead of going empty.
 */
export async function syncScodeModelsFromPricing(): Promise<void> {
  let json: SpecificPricingResponse;
  try {
    const response = await fetch(SPECIFIC_PRICING_URL, { signal: AbortSignal.timeout(15000) });
    json = (await response.json()) as SpecificPricingResponse;
  } catch (err) {
    mainWarn(TAG, `specific_pricing fetch failed, keeping existing models: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (json.success !== true || !Array.isArray(json.data)) {
    mainWarn(TAG, 'specific_pricing returned success!=true or no data, keeping existing models');
    return;
  }

  const modelIds = json.data
    .map((m) => (typeof m.model_id === 'string' ? m.model_id.trim() : ''))
    .filter(Boolean);
  if (modelIds.length === 0) {
    mainWarn(TAG, 'specific_pricing returned empty model list, keeping existing models');
    return;
  }

  // Rebuild the models dict — same ScodeModelEntry shape as
  // buildScodeConfigFromLoginPayload (sudoworkAuthLogin.ts).
  const models: Record<string, unknown> = {};
  for (const modelId of modelIds) {
    models[modelId] = {
      alias: modelId,
      name: modelId,
      input: ['text'],
      providers: {
        proxy: { provider: 'sudorouter', model: modelId, api: 'openai-completions' },
      },
    };
  }

  const existing = readExistingConfig();
  existing.models = models; // only replace `models`; other keys preserved
  writeConfig(existing);
  mainLog(TAG, `Synced ${modelIds.length} models from specific_pricing into sudocode.json`);
}

/**
 * Sync image generation model from ProcessConfig to sudocode.json on startup.
 * This runs independently of sudoclaw so it works even when openclaw is not used.
 */
async function syncImageModelOnStartup(): Promise<void> {
  try {
    const { ProcessConfig } = await import('@process/initStorage');
    const { DEFAULT_IMAGE_GENERATION_MODEL } = await import('@/common/storage');
    const imageConfig = await ProcessConfig.get('tools.imageGenerationModel');
    const switchOn = imageConfig ? imageConfig.switch : true;
    const modelId = switchOn && imageConfig?.useModel ? imageConfig.useModel : DEFAULT_IMAGE_GENERATION_MODEL;
    if (modelId) {
      writeScodeImageModel(modelId);
    }
  } catch (err) {
    mainWarn(TAG, `Failed to sync image model on startup: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Ensure settings.json has a model field set (scode reads this on startup).
 * On fresh install, defaults to DEFAULT_SCODE_MODEL_ID.
 */
async function ensureSettingsModelOnStartup(): Promise<void> {
  try {
    const { DEFAULT_SCODE_MODEL_ID } = await import('@/common/acp/defaultModels');
    const settings = readSettings();
    if (!settings.model) {
      settings.model = DEFAULT_SCODE_MODEL_ID;
      writeSettings(settings);
      mainLog(TAG, `Initialized settings.json model to "${DEFAULT_SCODE_MODEL_ID}"`);
    }
  } catch (err) {
    mainWarn(TAG, `Failed to ensure settings model: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function registerScodeBridge(): void {
  void syncImageModelOnStartup();
  void ensureSettingsModelOnStartup();
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

  ipcBridge.scode.refreshModels.provider(async () => {
    try {
      await syncScodeModelsFromPricing();
      const { getScodeProxyModelInfoSync } = await import('@process/services/scode/scodeProxyModels');
      const info = getScodeProxyModelInfoSync();
      if (!info) {
        return { success: false, msg: 'No models available in sudocode.json' };
      }
      return { success: true, data: info };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWarn(TAG, `Failed to refresh models: ${msg}`);
      return { success: false, msg };
    }
  });

  ipcBridge.scode.setImageModel.provider(async ({ modelId }) => {
    try {
      if (modelId) {
        writeScodeImageModel(modelId);
      }
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWarn(TAG, `Failed to set image model: ${msg}`);
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
