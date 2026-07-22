import { modelInputForModelId } from './imageUtils';
import type { ScodeConfig, ScodeModelEntry } from './ipcBridge';
import { getSudorouterBaseUrl } from './systemConfig';

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
    api?: string;
    input?: string[];
    supportsTools?: boolean;
    supportsReasoning?: boolean;
    inputContext?: number;
    outputContext?: number;
  }>;
};

const SUDOROUTER_PROVIDER_ID = 'sudorouter';
const OPENAI_COMPAT_API = 'openai-completions';
const OPENAI_RESPONSES_API = 'openai-responses';
export const SCODE_AUTO_MODEL_ALIAS = 'auto';
export const SCODE_AUTO_ROUTER_MODEL_ID = 'gpt-5.5';

export type SpecificPricingItem = {
  model_id: string;
  model_ratio?: number;
};

export type SpecificImagePricingItem = {
  model_id: string;
  model_ratio?: number;
  extra?: Record<string, unknown>;
};

export function resolveAutoRouterModelId(modelIds: string[], pricingItems?: SpecificPricingItem[]): string | null {
  if (modelIds.length === 0) return null;
  if (modelIds.length === 1) return modelIds[0];
  if (modelIds.includes(SCODE_AUTO_ROUTER_MODEL_ID)) return SCODE_AUTO_ROUTER_MODEL_ID;
  const idSet = new Set(modelIds);
  let best: string | null = null;
  let bestRatio = -Infinity;
  for (const it of pricingItems || []) {
    if (typeof it.model_ratio !== 'number') continue;
    if (!idSet.has(it.model_id)) continue;
    if (it.model_ratio > bestRatio) {
      bestRatio = it.model_ratio;
      best = it.model_id;
    }
  }
  return best ?? modelIds[0];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeModelAlias(modelId: string): string {
  return modelId.trim();
}

export function buildCustomModelAlias(providerId: string, modelId: string): string {
  const normalizedProviderId = providerId.trim();
  const normalizedModelId = normalizeModelAlias(modelId);
  return `${normalizedProviderId}/${normalizedModelId}`;
}

function shouldUseOpenAIResponsesApi(modelId: string): boolean {
  return /^gpt-5\.(4|5)(?:$|-)/i.test(modelId.trim());
}

function getCustomApiType(modelId: string, api?: string): string {
  const modelApi = api?.trim();
  if (shouldUseOpenAIResponsesApi(modelId)) {
    return OPENAI_RESPONSES_API;
  }
  return modelApi || OPENAI_COMPAT_API;
}

function resolveDefaultModelAlias(existingDefaultModel: string | undefined, models: Record<string, ScodeModelEntry>): string | undefined {
  const defaultModel = existingDefaultModel?.trim();
  if (!defaultModel) return undefined;
  if (models[defaultModel]) return defaultModel;

  return Object.entries(models).find(([, entry]) => entry.providers?.['api-key']?.model === defaultModel)?.[0];
}

function isSudorouterModelEntry(entry: ScodeModelEntry | undefined): boolean {
  return entry?.providers?.proxy?.provider === SUDOROUTER_PROVIDER_ID;
}

function isCustomApiKeyModelEntry(entry: ScodeModelEntry | undefined, providerId: string): boolean {
  return entry?.providers?.['api-key']?.provider === providerId;
}

function buildSudorouterModelEntry(modelId: string, alias = modelId): ScodeModelEntry {
  return {
    alias,
    name: alias,
    input: modelInputForModelId(modelId),
    providers: {
      proxy: { provider: SUDOROUTER_PROVIDER_ID, model: modelId, api: OPENAI_COMPAT_API },
    },
  };
}

export function addScodeAutoModel(models: Record<string, ScodeModelEntry>, modelIds: string[], pricingItems?: SpecificPricingItem[]): string | null {
  const id = resolveAutoRouterModelId(modelIds, pricingItems);
  if (id) models[SCODE_AUTO_MODEL_ALIAS] = buildSudorouterModelEntry(id, SCODE_AUTO_MODEL_ALIAS);
  return id;
}

function buildCustomApiKeyModelEntry(providerId: string, model: ScodeCustomModelProvider['models'][number], alias: string): ScodeModelEntry {
  const modelId = model.id.trim();
  return {
    alias,
    name: alias,
    input: model.input?.length ? model.input : modelInputForModelId(modelId),
    supports_tools: model.supportsTools,
    supports_reasoning: model.supportsReasoning,
    context: {
      input: model.inputContext,
      output: model.outputContext,
    },
    providers: {
      'api-key': { provider: providerId, model: modelId, api: getCustomApiType(modelId, model.api) },
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
    name: modelId,
    api: entry.providers?.['api-key']?.api,
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

export function normalizeCustomApiKeyModelsInScodeConfig(config: ScodeConfig | null | undefined): ScodeConfig {
  const nextConfig: ScodeConfig = { ...(config || {}) };
  const existingModels = config?.models || {};
  const nextModels: Record<string, ScodeModelEntry> = {};
  const existingDefaultModel = config?.default_model?.trim();
  let nextDefaultModel = existingDefaultModel;

  for (const [alias, entry] of Object.entries(existingModels)) {
    const apiKeyProvider = entry.providers?.['api-key'];
    const providerId = apiKeyProvider?.provider?.trim();
    const providerModelId = apiKeyProvider?.model?.trim();

    if (!providerId || !providerModelId) {
      nextModels[alias] = entry;
      continue;
    }

    const nextAlias = buildCustomModelAlias(providerId, providerModelId);
    nextModels[nextAlias] = {
      ...entry,
      alias: nextAlias,
      name: nextAlias,
      providers: {
        ...entry.providers,
        'api-key': {
          ...apiKeyProvider,
          provider: providerId,
          model: providerModelId,
          api: getCustomApiType(providerModelId, apiKeyProvider.api),
        },
      },
    };

    if (existingDefaultModel === alias || existingDefaultModel === entry.alias) {
      nextDefaultModel = nextAlias;
    } else if (existingDefaultModel === providerModelId && !existingModels[existingDefaultModel]) {
      nextDefaultModel = nextAlias;
    }
  }

  nextConfig.models = nextModels;
  if (nextDefaultModel && nextModels[nextDefaultModel]) {
    nextConfig.default_model = nextDefaultModel;
  } else {
    delete nextConfig.default_model;
  }

  return nextConfig;
}

export function buildScodeConfigFromLoginPayload(payload: LoginSudoclawPayload, existing?: ScodeConfig | null, pricingItems?: SpecificPricingItem[]): ScodeConfig {
  return mergeSudorouterIntoScodeConfig(existing || {}, payload, pricingItems);
}

export function mergeSudorouterIntoScodeConfig(existing: ScodeConfig | null | undefined, payload: LoginSudoclawPayload, pricingItems?: SpecificPricingItem[]): ScodeConfig {
  const modelIds = uniqueStrings(payload.models);
  const existingModels = existing?.models || {};
  const nextModels: Record<string, ScodeModelEntry> = {};

  for (const [alias, entry] of Object.entries(existingModels)) {
    if (!isSudorouterModelEntry(entry)) {
      nextModels[alias] = entry;
    }
  }

  const autoModelId = addScodeAutoModel(nextModels, modelIds, pricingItems);
  for (const modelId of modelIds) {
    nextModels[normalizeModelAlias(modelId)] = buildSudorouterModelEntry(modelId);
  }

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
      apiUrl: `${getSudorouterBaseUrl()}/search/tavily/search`,
      apiKey: payload.sudorouterKey || '',
    },
  };

  if (autoModelId) {
    nextConfig.default_model = SCODE_AUTO_MODEL_ALIAS;
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
    const alias = buildCustomModelAlias(providerId, model.id);
    nextModels[alias] = buildCustomApiKeyModelEntry(providerId, model, alias);
  }

  const defaultModel = resolveDefaultModelAlias(existing?.default_model, nextModels);

  const nextConfig: ScodeConfig = {
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

  if (defaultModel) {
    nextConfig.default_model = defaultModel;
  } else {
    delete nextConfig.default_model;
  }

  return nextConfig;
}

/**
 * Extract sudorouter credentials (baseUrl + apiKey) from a ScodeConfig.
 * Pure function, no side effects. Returns undefined for any field that is
 * missing or not a non-empty string. Never throws — invalid input yields `{}`.
 *
 * Symmetric with mergeSudorouterIntoScodeConfig: that one writes, this one reads.
 */
export function extractSudorouterCreds(config: unknown): { baseUrl?: string; apiKey?: string } {
  const result: { baseUrl?: string; apiKey?: string } = {};
  if (!config || typeof config !== 'object') return result;
  const authModes = (config as ScodeConfig)?.auth_modes;
  const sudorouter = authModes?.proxy?.[SUDOROUTER_PROVIDER_ID];
  if (!sudorouter || typeof sudorouter !== 'object') return result;
  const { baseUrl, apiKey } = sudorouter as { baseUrl?: unknown; apiKey?: unknown };
  if (typeof baseUrl === 'string' && baseUrl.trim()) {
    result.baseUrl = baseUrl;
  }
  if (typeof apiKey === 'string' && apiKey.trim()) {
    result.apiKey = apiKey;
  }
  return result;
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
