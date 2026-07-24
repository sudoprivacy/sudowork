export type { LoginSudoclawPayload } from './scodeConfig';

import { buildScodeConfigFromLoginPayload } from './scodeConfig';
import type { LoginSudoclawPayload } from './scodeConfig';

type LoginResponseData = {
  user?: Record<string, unknown>;
  sudorouter_key?: unknown;
  model_service_url?: unknown;
  models?: unknown;
  available_models?: unknown;
  model_list?: unknown;
  scode_auto_model?: unknown;
  access_token?: unknown;
};

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
}

export function mergeLoginUserData(payload: unknown): Record<string, unknown> {
  const data = (payload && typeof payload === 'object' ? payload : {}) as { data?: LoginResponseData };
  const loginData = (data.data && typeof data.data === 'object' ? data.data : {}) as LoginResponseData;
  const loginUser = (loginData.user && typeof loginData.user === 'object' ? loginData.user : {}) as Record<string, unknown>;

  const sudorouterKey = asNonEmptyString(loginData.sudorouter_key);
  const modelServiceUrl = asNonEmptyString(loginData.model_service_url);
  const directModels = asStringArray(loginData.models);
  const availableModels = asStringArray(loginData.available_models);
  const fallbackModels = asStringArray(loginData.model_list);
  const models = directModels.length ? directModels : availableModels.length ? availableModels : fallbackModels;
  const scodeAutoModel = asNonEmptyString(loginData.scode_auto_model);

  return {
    ...loginUser,
    ...(sudorouterKey ? { sudorouter_key: sudorouterKey } : {}),
    ...(modelServiceUrl ? { model_service_url: modelServiceUrl } : {}),
    ...(models.length ? { models } : {}),
    ...(scodeAutoModel ? { scode_auto_model: scodeAutoModel } : {}),
  };
}

export function extractLoginSudoclawPayload(payload: unknown): LoginSudoclawPayload | null {
  const mergedUser = mergeLoginUserData(payload);
  const sudorouterKey = asNonEmptyString(mergedUser.sudorouter_key);
  const modelServiceUrl = asNonEmptyString(mergedUser.model_service_url);
  const models = asStringArray(mergedUser.models);
  const scodeAutoModel = asNonEmptyString(mergedUser.scode_auto_model);

  if (!sudorouterKey || !modelServiceUrl || models.length === 0) {
    return null;
  }

  return {
    sudorouterKey,
    modelServiceUrl,
    models,
    ...(scodeAutoModel ? { scodeAutoModel } : {}),
  };
}

/**
 * Build sudocode.json config from SudoclawConfig (CopilotModalContent settings save).
 * Extracts sudorouter provider credentials and model list from sudoclaw format.
 */
export function buildScodeConfigFromSudoclawConfig(config: import('./ipcBridge').SudoclawConfig): import('./ipcBridge').ScodeConfig | null {
  const providers = config?.models?.providers;
  if (!providers || typeof providers !== 'object') return null;

  // Find the sudorouter provider (the main one with baseUrl and apiKey)
  let baseUrl: string | undefined;
  let apiKey: string | undefined;
  const allModelIds: string[] = [];

  for (const [, provider] of Object.entries(providers)) {
    if (provider.baseUrl?.includes('sudorouter') && provider.apiKey) {
      if (!baseUrl) {
        baseUrl = provider.baseUrl;
        apiKey = provider.apiKey;
      }
      if (provider.models) {
        for (const m of provider.models) {
          if (m.id && !allModelIds.includes(m.id)) {
            allModelIds.push(m.id);
          }
        }
      }
    }
  }

  if (!baseUrl || !apiKey || allModelIds.length === 0) return null;

  return buildScodeConfigFromLoginPayload({
    sudorouterKey: apiKey,
    modelServiceUrl: baseUrl,
    models: allModelIds,
  });
}
