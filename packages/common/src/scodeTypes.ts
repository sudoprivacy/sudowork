/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure scode-config value types — the shape the IPC bridge and renderer read for
 * custom model providers and sudorouter pricing, kept separate from the
 * scodeConfig runtime so consumers reference the types without it.
 */

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
    supportsImageGeneration?: boolean;
    inputContext?: number;
    outputContext?: number;
  }>;
};

export type SpecificPricingItem = {
  model_id: string;
  model_ratio?: number;
};

export type SpecificImagePricingItem = {
  model_id: string;
  model_ratio?: number;
  extra?: Record<string, unknown>;
};
