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

import fs from 'fs';
import path from 'path';
import { SCODE_DIR, isScodeInstalled, getScodeVersionState, ensureScodeInstalled } from '@process/services/scode/ScodeInstallService';
import { syncUserKeyFromScodeConfig } from '@process/services/authProxy/userKeySync';
import { readSettings, removeDisabledMcpServersFromSettings, writeSettings } from '@process/services/mcpServices/agents/ScodeMcpAgent';
import { getDatabase } from '@process/database';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { SUDOCLAW_DIR } from '@process/services/sudoclaw/SudoclawInstallService';
import { writeSudoclawImageGenerationModel } from '@process/bridge/imageGenerationModelSync';
import { ipcBridge } from '@/common';
import { modelInputForModelId } from '@/common/imageUtils';
import type { ScodeModelEntry } from '@/common/ipcBridge';
import { addScodeAutoModel, extractCustomProvidersFromScodeConfig, mergeCustomProvidersIntoScodeConfig, normalizeCustomApiKeyModelsInScodeConfig, type ScodeCustomModelProvider, type SpecificPricingItem } from '@/common/scodeConfig';
import { getSudorouterBaseUrl } from '@/common/systemConfig';

const TAG = 'ScodeBridge';
const SUDOCODE_CONFIG_PATH = path.join(SCODE_DIR, 'sudocode.json');
const SUDOCLAW_CONFIG_PATH = path.join(SUDOCLAW_DIR, 'sudoclaw.json');

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
  // Mirror sudorouter creds into Nexus (fire-and-forget; never throws).
  void syncUserKeyFromScodeConfig(config);
}

function getCustomProvidersForUser(userId: string): ScodeCustomModelProvider[] {
  return getDatabase().getScodeCustomModelProviders(userId);
}

function restoreCustomProvidersForUser(userId: string, config: Record<string, unknown>): Record<string, unknown> {
  const customProviders = getCustomProvidersForUser(userId);
  if (customProviders.length === 0) return config;
  return mergeCustomProvidersIntoScodeConfig(config, customProviders) as unknown as Record<string, unknown>;
}

/**
 * Update only the default_model field in sudocode.json.
 * Callable directly from main process code (no IPC needed).
 */
export function writeScodeDefaultModel(modelId: string): void {
  const existing = normalizeCustomApiKeyModelsInScodeConfig(readExistingConfig()) as unknown as Record<string, unknown>;
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
  const existing = normalizeCustomApiKeyModelsInScodeConfig(readExistingConfig()) as unknown as Record<string, unknown>;
  const tools = (existing.tools as Record<string, unknown>) || {};
  existing.tools = { ...tools, imageGenerationModel: modelId };
  writeConfig(existing);
  mainLog(TAG, `Updated tools.imageGenerationModel to "${modelId}"`);
}

type SpecificPricingResponse = {
  success?: boolean;
  data?: SpecificPricingItem[];
};

/**
 * Fetch sudorouter's specific_pricing items (including model_ratio).
 * Returns [] on any fetch/parse failure or success!==true; each failure mode logs its own warn,
 * so callers see the same diagnostic granularity as before the extraction.
 */
export async function fetchSpecificPricingItems(): Promise<SpecificPricingItem[]> {
  let json: SpecificPricingResponse;
  try {
    const response = await fetch(`${getSudorouterBaseUrl()}/api/specific_pricing`, { signal: AbortSignal.timeout(15000) });
    json = (await response.json()) as SpecificPricingResponse;
  } catch (err) {
    mainWarn(TAG, `specific_pricing fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  if (json.success !== true || !Array.isArray(json.data)) {
    mainWarn(TAG, 'specific_pricing returned success!=true or no data');
    return [];
  }

  return json.data.filter((it): it is SpecificPricingItem => typeof it?.model_id === 'string' && it.model_id.trim().length > 0);
}

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
  const pricingItems = await fetchSpecificPricingItems();

  const modelIds = pricingItems.map((m) => m.model_id.trim()).filter(Boolean);
  if (modelIds.length === 0) {
    mainWarn(TAG, 'specific_pricing returned empty model list, keeping existing models');
    return;
  }

  const existing = readExistingConfig();
  const normalizedExisting = normalizeCustomApiKeyModelsInScodeConfig(existing);
  const normalizedExistingModels = normalizedExisting.models || {};
  const existingModels = (normalizedExistingModels && typeof normalizedExistingModels === 'object' ? normalizedExistingModels : {}) as Record<string, ScodeModelEntry>;
  const models: Record<string, ScodeModelEntry> = {};
  for (const [alias, entry] of Object.entries(existingModels)) {
    if (entry?.providers?.proxy?.provider !== 'sudorouter') {
      models[alias] = entry;
    }
  }

  addScodeAutoModel(models, modelIds, pricingItems);
  for (const modelId of modelIds) {
    models[modelId] = {
      alias: modelId,
      name: modelId,
      input: modelInputForModelId(modelId),
      providers: {
        proxy: { provider: 'sudorouter', model: modelId, api: 'openai-completions' },
      },
    };
  }

  normalizedExisting.models = models; // only replace `models`; other keys preserved
  if (typeof normalizedExisting.default_model === 'string' && !models[normalizedExisting.default_model]) {
    const fallbackModel = modelIds[0];
    if (fallbackModel) {
      normalizedExisting.default_model = fallbackModel;
    } else {
      delete normalizedExisting.default_model;
    }
  }
  writeConfig(normalizedExisting as unknown as Record<string, unknown>);
  mainLog(TAG, `Synced ${modelIds.length} sudorouter models from specific_pricing into sudocode.json`);
}

/**
 * Resolve the image generation model id for a main-process sync point (startup /
 * sudoclaw gateway start). Always returns a definitive modelId (null → runtime
 * writes ''). A stale useModel is repaired in the persistence layer; a pricing
 * fetch failure / empty list keeps the existing useModel untouched.
 */
export async function resolveImageModelForMainSync(): Promise<{ modelId: string | null }> {
  const { ProcessConfig } = await import('@process/initStorage');
  const { fetchSpecificImagePricingItems } = await import('@/common/imagePricingSource');
  const { pickDefaultImageModelFromPricing, pickImageGenerationModelId, resolveImageModelWithAvailability } = await import('@/common/imageGenerationModelConfig');

  const saved = await ProcessConfig.get('tools.imageGenerationModel');
  const items = await fetchSpecificImagePricingItems();

  if (!saved) {
    const def = items ? pickDefaultImageModelFromPricing(items) : '';
    return { modelId: def || null };
  }

  if (items === null || items.length === 0) {
    return { modelId: pickImageGenerationModelId(saved) };
  }

  const { jsonModelId, persistedUseModel, changed } = resolveImageModelWithAvailability(saved, items);
  if (changed) {
    await ProcessConfig.set('tools.imageGenerationModel', { ...saved, useModel: persistedUseModel });
  }
  return { modelId: jsonModelId };
}

/**
 * Sync image generation model from ProcessConfig to sudocode.json on startup.
 * This runs independently of sudoclaw.
 */
async function syncImageModelOnStartup(): Promise<void> {
  try {
    const { modelId } = await resolveImageModelForMainSync();
    writeScodeImageModel(modelId ?? '');
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
    let changed = removeDisabledMcpServersFromSettings(settings);
    if (!settings.model) {
      settings.model = DEFAULT_SCODE_MODEL_ID;
      changed = true;
      mainLog(TAG, `Initialized settings.json model to "${DEFAULT_SCODE_MODEL_ID}"`);
    }
    if (changed) {
      writeSettings(settings);
    }
  } catch (err) {
    mainWarn(TAG, `Failed to ensure settings model: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Migrate existing sudocode.json models: add 'image' to input array
 * for vision-capable models that are missing it.
 */
async function migrateVisionInputOnStartup(): Promise<void> {
  try {
    const config = readExistingConfig();
    const models = config.models as Record<string, Record<string, unknown>> | undefined;
    if (!models || typeof models !== 'object') return;

    let changed = false;
    for (const [key, model] of Object.entries(models)) {
      const input = model?.input;
      if (Array.isArray(input) && !input.includes('image')) {
        const modelId = (typeof model.alias === 'string' ? model.alias : key) || key;
        if (modelInputForModelId(modelId).includes('image')) {
          model.input = ['text', 'image'];
          changed = true;
          mainLog(TAG, `Migrated model "${modelId}": added 'image' to input`);
        }
      }
    }

    if (changed) {
      writeConfig(config);
      mainLog(TAG, 'Migrated vision input for existing models in sudocode.json');
    }
  } catch (err) {
    mainWarn(TAG, `Failed to migrate vision input: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function migrateCustomApiKeyModelsOnStartup(): Promise<void> {
  try {
    const config = readExistingConfig();
    const normalizedConfig = normalizeCustomApiKeyModelsInScodeConfig(config) as unknown as Record<string, unknown>;
    if (JSON.stringify(config) !== JSON.stringify(normalizedConfig)) {
      writeConfig(normalizedConfig);
      mainLog(TAG, 'Normalized custom api-key models in sudocode.json');
    }
  } catch (err) {
    mainWarn(TAG, `Failed to normalize custom api-key models: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function registerScodeBridge(): void {
  void syncImageModelOnStartup();
  void ensureSettingsModelOnStartup();
  void migrateCustomApiKeyModelsOnStartup();
  void migrateVisionInputOnStartup();
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
      writeConfig(normalizeCustomApiKeyModelsInScodeConfig(incoming) as unknown as Record<string, unknown>);
      mainLog(TAG, 'Saved sudocode.json config');
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWarn(TAG, `Failed to save sudocode.json: ${msg}`);
      return { success: false, msg };
    }
  });

  ipcBridge.scode.saveCustomModelProviders.provider(async ({ userId, providers }) => {
    try {
      getDatabase().replaceScodeCustomModelProviders(userId, providers);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWarn(TAG, `Failed to save custom scode models for user ${userId}: ${msg}`);
      return { success: false, msg };
    }
  });

  ipcBridge.scode.restoreCustomModelProviders.provider(async ({ userId, baseConfig }) => {
    try {
      const currentConfig = (baseConfig || readExistingConfig()) as unknown as Record<string, unknown>;
      const nextConfig = restoreCustomProvidersForUser(userId, currentConfig);
      writeConfig(nextConfig);
      return { success: true, data: nextConfig };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWarn(TAG, `Failed to restore custom scode models for user ${userId}: ${msg}`);
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

  ipcBridge.scode.fetchSpecificPricing.provider(async () => ({ success: true, data: await fetchSpecificPricingItems() }));

  ipcBridge.scode.fetchSpecificImagePricing.provider(async () => {
    const { fetchSpecificImagePricingItems } = await import('@/common/imagePricingSource');
    const data = await fetchSpecificImagePricingItems();
    return data === null ? { success: false, msg: 'image pricing fetch failed' } : { success: true, data };
  });

  ipcBridge.scode.setImageModel.provider(async ({ modelId }) => {
    try {
      // null/empty means the feature is off — clear both stores so the running
      // tool stops using the last model instead of silently keeping it.
      const resolved = modelId ?? '';
      writeScodeImageModel(resolved);
      // The image-generation tool reads sudoclaw.json first, so keep it in sync
      // on every save; otherwise the settings change never reaches the tool.
      writeSudoclawImageGenerationModel(resolved, SUDOCLAW_CONFIG_PATH);
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
      return ok ? { success: true } : { success: false, msg: 'Sudo Code 安装失败' };
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
