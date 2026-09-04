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

// Scode config (~/.nexus/sudowork/sudocode/sudocode.json)
// Matches sudocode.json schema: auth_modes, models, default_model
export type ScodeModelProvider = {
  provider?: string;
  model?: string;
  api?: string;
};
export type ScodeModelEntry = {
  alias?: string;
  name?: string;
  input?: string[];
  supports_tools?: boolean;
  supports_reasoning?: boolean;
  supports_image_generation?: boolean;
  context?: {
    input?: number;
    output?: number;
  };
  providers?: {
    subscription?: ScodeModelProvider;
    proxy?: ScodeModelProvider;
    'api-key'?: ScodeModelProvider;
  };
};
export type ScodeConfig = {
  auth_modes?: {
    subscription?: Record<string, { baseUrl?: string; token?: string; authFile?: string }>;
    proxy?: Record<string, { baseUrl?: string; apiKey?: string }>;
    'api-key'?: Record<string, { baseUrl?: string; apiKey?: string }>;
  };
  default_model?: string;
  models?: Record<string, ScodeModelEntry>;
  web_search?: {
    provider?: string;
    apiUrl?: string;
    apiKey?: string;
  };
};
