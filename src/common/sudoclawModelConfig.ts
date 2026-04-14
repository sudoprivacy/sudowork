import type { SudoclawConfig, SudoclawProvider, SudoclawProviderModel } from './ipcBridge';

const SUDOROUTER_BASE_URL = 'https://hk.sudorouter.ai/v1';
const DEFAULT_PRIMARY_MODEL = 'gemini-3-flash-preview';

type MergeSudorouterProvidersParams = {
  modelIds: string[];
  apiKey?: string;
  baseUrl?: string;
  preservePrimary?: boolean;
};

function getSudorouterApiType(modelId: string): string {
  if (modelId.includes('gemini')) {
    return 'google-generative-ai';
  }
  if (modelId.includes('claude')) {
    return 'anthropic-messages';
  }
  return 'openai-completions';
}

function getSudorouterModelInput(modelId: string): string[] {
  if (/gemini|claude|gpt-4|qwen-vl/i.test(modelId)) {
    return ['text', 'image'];
  }
  return ['text'];
}

export function getSudorouterProviderName(modelId: string): string {
  return `sudorouter-${modelId}`;
}

export function getSudorouterPrimaryModelPath(modelId: string): string {
  return `${getSudorouterProviderName(modelId)}/${modelId}`;
}

export function buildSudorouterProviderModel(modelId: string): SudoclawProviderModel {
  return {
    id: modelId,
    name: modelId,
    input: getSudorouterModelInput(modelId),
  };
}

export function buildSudorouterProvider(modelId: string, apiKey?: string, existingProvider?: SudoclawProvider): SudoclawProvider {
  const provider: SudoclawProvider = {
    ...existingProvider,
    baseUrl: SUDOROUTER_BASE_URL,
    api: getSudorouterApiType(modelId),
    models: [buildSudorouterProviderModel(modelId)],
  };

  if (apiKey?.trim()) {
    provider.apiKey = apiKey.trim();
  }

  return provider;
}

export function getPreferredSudorouterPrimaryModel(modelIds: string[]): string {
  return modelIds.includes(DEFAULT_PRIMARY_MODEL) ? DEFAULT_PRIMARY_MODEL : modelIds[0] || DEFAULT_PRIMARY_MODEL;
}

function shouldPreservePrimaryModel(currentPrimary: string | undefined, modelIds: string[], preservePrimary: boolean): boolean {
  if (!preservePrimary || !currentPrimary?.trim()) {
    return false;
  }

  const normalizedPrimary = currentPrimary.trim();
  const primaryModelId = normalizedPrimary.includes('/') ? normalizedPrimary.slice(normalizedPrimary.lastIndexOf('/') + 1) : normalizedPrimary;
  const isSudorouterPrimary = normalizedPrimary === `sudorouter/${primaryModelId}` || normalizedPrimary === getSudorouterPrimaryModelPath(primaryModelId);

  if (!isSudorouterPrimary) {
    return true;
  }

  return modelIds.includes(primaryModelId);
}

export function mergeSudorouterProvidersIntoConfig(config: SudoclawConfig | null | undefined, params: MergeSudorouterProvidersParams): SudoclawConfig {
  const modelIds = Array.from(new Set(params.modelIds.map((modelId) => modelId.trim()).filter(Boolean)));
  const nextConfig: SudoclawConfig = {
    ...(config || {}),
  };

  const existingProviders = nextConfig.models?.providers || {};
  const canonicalApiKey = params.apiKey?.trim() || existingProviders.sudorouter?.apiKey || Object.values(existingProviders).find((provider) => provider?.apiKey?.trim())?.apiKey || undefined;

  const mergedProviders: Record<string, SudoclawProvider> = {
    ...existingProviders,
  };

  for (const modelId of modelIds) {
    const providerName = getSudorouterProviderName(modelId);
    mergedProviders[providerName] = buildSudorouterProvider(modelId, canonicalApiKey, existingProviders[providerName]);
  }

  nextConfig.models = {
    mode: nextConfig.models?.mode || 'merge',
    providers: mergedProviders,
  };

  const currentPrimary = nextConfig.agents?.defaults?.model?.primary;
  const preferredPrimary = getSudorouterPrimaryModelPath(getPreferredSudorouterPrimaryModel(modelIds));
  const shouldPreservePrimary = shouldPreservePrimaryModel(currentPrimary, modelIds, params.preservePrimary !== false);

  nextConfig.agents = {
    ...nextConfig.agents,
    defaults: {
      ...nextConfig.agents?.defaults,
      model: {
        ...nextConfig.agents?.defaults?.model,
        primary: shouldPreservePrimary ? currentPrimary : preferredPrimary,
      },
    },
  };

  return nextConfig;
}
