import { modelInputForModelId } from './imageUtils';
import type { ScodeConfig, ScodeModelEntry } from './ipcBridge';

export type LoginSudoclawPayload = {
  sudorouterKey?: string;
  modelServiceUrl?: string;
  models: string[];
};

export type ScodeCustomModelProvider = {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  models: Array<{
    id: string;
    name?: string;
    input?: string[];
    supportsTools?: boolean;
    supportsReasoning?: boolean;
    inputContext?: number;
    outputContext?: number;
  }>;
};

const SUDOROUTER_PROVIDER_ID = 'sudorouter';
const OPENAI_COMPAT_API = 'openai-completions';

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeModelAlias(modelId: string): string {
  return modelId.trim();
}

function isSudorouterModelEntry(entry: ScodeModelEntry | undefined): boolean {
  return entry?.providers?.proxy?.provider === SUDOROUTER_PROVIDER_ID;
}

function isCustomApiKeyModelEntry(entry: ScodeModelEntry | undefined, providerId: string): boolean {
  return entry?.providers?.['api-key']?.provider === providerId;
}

function buildSudorouterModelEntry(modelId: string): ScodeModelEntry {
  return {
    alias: modelId,
    name: modelId,
    input: modelInputForModelId(modelId),
    providers: {
      proxy: { provider: SUDOROUTER_PROVIDER_ID, model: modelId, api: OPENAI_COMPAT_API },
    },
  };
}

function buildCustomApiKeyModelEntry(providerId: string, model: ScodeCustomModelProvider['models'][number]): ScodeModelEntry {
  const modelId = model.id.trim();
  return {
    alias: normalizeModelAlias(modelId),
    name: model.name?.trim() || modelId,
    input: model.input?.length ? model.input : modelInputForModelId(modelId),
    supports_tools: model.supportsTools,
    supports_reasoning: model.supportsReasoning,
    context: {
      input: model.inputContext,
      output: model.outputContext,
    },
    providers: {
      'api-key': { provider: providerId, model: modelId, api: OPENAI_COMPAT_API },
    },
  };
}

function getCustomApiKeyProviderIds(config: ScodeConfig | null | undefined): string[] {
  return Object.keys(config?.auth_modes?.['api-key'] || {});
}

function modelFromCustomApiKeyEntry(alias: string, entry: ScodeModelEntry): ScodeCustomModelProvider['models'][number] {
  const modelId = entry.providers?.['api-key']?.model || entry.alias || alias;
  return {
    id: modelId,
    name: entry.name || modelId,
    input: entry.input,
    supportsTools: entry.supports_tools,
    supportsReasoning: entry.supports_reasoning,
    inputContext: entry.context?.input,
    outputContext: entry.context?.output,
  };
}

export function extractCustomProvidersFromScodeConfig(config: ScodeConfig | null | undefined): ScodeCustomModelProvider[] {
  const customProviderIds = getCustomApiKeyProviderIds(config);
  if (customProviderIds.length === 0) return [];

  return customProviderIds
    .map((providerId) => {
      const authProvider = config?.auth_modes?.['api-key']?.[providerId];
      const models = Object.entries(config?.models || {})
        .filter(([, entry]) => isCustomApiKeyModelEntry(entry, providerId))
        .map(([alias, entry]) => modelFromCustomApiKeyEntry(alias, entry))
        .sort((a, b) => a.id.localeCompare(b.id));

      return {
        providerId,
        baseUrl: authProvider?.baseUrl || '',
        apiKey: authProvider?.apiKey || '',
        models,
      };
    })
    .filter((provider) => provider.models.length > 0 || provider.baseUrl || provider.apiKey)
    .sort((a, b) => a.providerId.localeCompare(b.providerId));
}

export function mergeCustomProvidersIntoScodeConfig(existing: ScodeConfig | null | undefined, customProviders: ScodeCustomModelProvider[]): ScodeConfig {
  return customProviders.reduce<ScodeConfig>((nextConfig, provider) => mergeCustomProviderIntoScodeConfig(nextConfig, provider), existing || {});
}

export function buildScodeConfigFromLoginPayload(payload: LoginSudoclawPayload, existing?: ScodeConfig | null): ScodeConfig {
  return mergeSudorouterIntoScodeConfig(existing || {}, payload);
}

export function mergeSudorouterIntoScodeConfig(existing: ScodeConfig | null | undefined, payload: LoginSudoclawPayload): ScodeConfig {
  const modelIds = uniqueStrings(payload.models);
  const existingModels = existing?.models || {};
  const nextModels: Record<string, ScodeModelEntry> = {};

  for (const [alias, entry] of Object.entries(existingModels)) {
    if (!isSudorouterModelEntry(entry)) {
      nextModels[alias] = entry;
    }
  }

  for (const modelId of modelIds) {
    nextModels[normalizeModelAlias(modelId)] = buildSudorouterModelEntry(modelId);
  }

  const defaultModel = existing?.default_model && nextModels[existing.default_model] ? existing.default_model : modelIds[0];
  const nextConfig: ScodeConfig = {
    ...existing,
    auth_modes: {
      ...(existing?.auth_modes || {}),
      proxy: {
        ...(existing?.auth_modes?.proxy || {}),
        [SUDOROUTER_PROVIDER_ID]: {
          baseUrl: payload.modelServiceUrl,
          apiKey: payload.sudorouterKey,
        },
      },
    },
    models: nextModels,
    web_search: {
      ...(existing?.web_search || {}),
      provider: existing?.web_search?.provider || 'tavily',
      apiUrl: existing?.web_search?.apiUrl || 'https://hk.sudorouter.ai/search/tavily/search',
      apiKey: existing?.web_search?.apiKey || payload.sudorouterKey || '',
    },
  };

  if (defaultModel) {
    nextConfig.default_model = defaultModel;
  } else {
    delete nextConfig.default_model;
  }

  return nextConfig;
}

export function mergeCustomProviderIntoScodeConfig(existing: ScodeConfig | null | undefined, customProvider: ScodeCustomModelProvider): ScodeConfig {
  const providerId = customProvider.providerId.trim();
  const models = customProvider.models.filter((model) => model.id.trim());
  const existingModels = existing?.models || {};
  const nextModels: Record<string, ScodeModelEntry> = {};

  for (const [alias, entry] of Object.entries(existingModels)) {
    if (!isCustomApiKeyModelEntry(entry, providerId)) {
      nextModels[alias] = entry;
    }
  }

  for (const model of models) {
    const alias = normalizeModelAlias(model.id);
    nextModels[alias] = buildCustomApiKeyModelEntry(providerId, model);
  }

  return {
    ...existing,
    auth_modes: {
      ...(existing?.auth_modes || {}),
      'api-key': {
        ...(existing?.auth_modes?.['api-key'] || {}),
        [providerId]: {
          baseUrl: customProvider.baseUrl.trim(),
          apiKey: customProvider.apiKey,
        },
      },
    },
    models: nextModels,
  };
}

export function removeCustomProviderFromScodeConfig(existing: ScodeConfig | null | undefined, providerId: string): ScodeConfig {
  const normalizedProviderId = providerId.trim();
  const nextApiKeyProviders = { ...(existing?.auth_modes?.['api-key'] || {}) };
  delete nextApiKeyProviders[normalizedProviderId];

  const nextModels: Record<string, ScodeModelEntry> = {};
  for (const [alias, entry] of Object.entries(existing?.models || {})) {
    if (!isCustomApiKeyModelEntry(entry, normalizedProviderId)) {
      nextModels[alias] = entry;
    }
  }

  const nextAuthModes = {
    ...(existing?.auth_modes || {}),
    'api-key': nextApiKeyProviders,
  };
  if (Object.keys(nextApiKeyProviders).length === 0) {
    delete nextAuthModes['api-key'];
  }

  const defaultModel = existing?.default_model && nextModels[existing.default_model] ? existing.default_model : undefined;
  const nextConfig: ScodeConfig = {
    ...existing,
    auth_modes: nextAuthModes,
    models: nextModels,
  };

  if (defaultModel) {
    nextConfig.default_model = defaultModel;
  } else {
    delete nextConfig.default_model;
  }

  return nextConfig;
}
