/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDefaultAcpModelId } from '@/common/acp/defaultModels';
import { isVisionModel } from '@/common/imageUtils';
import type { AcpModelInfo } from '@/types/acpTypes';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SUDOCODE_CONFIG_PATH = path.join(os.homedir(), '.nexus', 'sudocode', 'sudocode.json');

type ScodeConfiguredModel = {
  id: string;
  label: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function hasRunnableProvider(providers: Record<string, unknown> | null): boolean {
  return !!(asRecord(providers?.proxy) || asRecord(providers?.['api-key']));
}

function readScodeModelsFromConfig(configPath = SUDOCODE_CONFIG_PATH): ScodeConfiguredModel[] {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as { models?: unknown };
    const models = asRecord(parsed.models);
    if (!models) {
      return [];
    }

    const seen = new Set<string>();
    const result: ScodeConfiguredModel[] = [];

    for (const [key, value] of Object.entries(models)) {
      const model = asRecord(value);
      const providers = asRecord(model?.providers);
      if (!hasRunnableProvider(providers)) {
        continue;
      }

      const alias = typeof model?.alias === 'string' && model.alias.trim() ? model.alias.trim() : key.trim();
      if (!alias || seen.has(alias)) {
        continue;
      }

      const name = typeof model?.name === 'string' && model.name.trim() ? model.name.trim() : alias;
      seen.add(alias);
      result.push({
        id: alias,
        label: name,
      });
    }

    return result;
  } catch {
    return [];
  }
}

function readScodeDefaultModelFromConfig(configPath = SUDOCODE_CONFIG_PATH): string | null {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as { default_model?: unknown };
    if (typeof parsed.default_model === 'string' && parsed.default_model.trim()) {
      return parsed.default_model.trim();
    }
  } catch {
    // ignored
  }
  return null;
}

export function getScodeProxyModelInfoSync(currentModelId?: string | null, configPath = SUDOCODE_CONFIG_PATH): AcpModelInfo | null {
  const availableModels = readScodeModelsFromConfig(configPath);
  if (availableModels.length === 0) {
    return null;
  }

  const explicitModelId = typeof currentModelId === 'string' && currentModelId.trim() ? currentModelId.trim() : null;
  // Prefer default_model from sudocode.json (persisted user choice), fallback to hardcoded default
  const defaultModelId = readScodeDefaultModelFromConfig(configPath) ?? getDefaultAcpModelId('scode');
  const defaultInList = defaultModelId ? availableModels.some((model) => model.id === defaultModelId) : false;
  const effectiveCurrentModelId = explicitModelId || (defaultInList ? defaultModelId : availableModels[0].id);
  const effectiveCurrentModelLabel = availableModels.find((model) => model.id === effectiveCurrentModelId)?.label || effectiveCurrentModelId;

  return {
    source: 'models',
    currentModelId: effectiveCurrentModelId,
    currentModelLabel: effectiveCurrentModelLabel,
    availableModels,
    canSwitch: availableModels.length > 1,
  };
}

type ScodeModelDef = {
  id: string;
  label: string;
  hasVision: boolean;
};

function readScodeModelsWithVisionFromConfig(configPath = SUDOCODE_CONFIG_PATH): ScodeModelDef[] {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as { models?: unknown };
    const models = asRecord(parsed.models);
    if (!models) {
      return [];
    }

    const seen = new Set<string>();
    const result: ScodeModelDef[] = [];

    for (const [key, value] of Object.entries(models)) {
      const model = asRecord(value);
      const providers = asRecord(model?.providers);
      if (!hasRunnableProvider(providers)) {
        continue;
      }

      const alias = typeof model?.alias === 'string' && model.alias.trim() ? model.alias.trim() : key.trim();
      if (!alias || seen.has(alias)) {
        continue;
      }

      const name = typeof model?.name === 'string' && model.name.trim() ? model.name.trim() : alias;

      let hasVision = false;
      if (Array.isArray(model?.input)) {
        hasVision = (model.input as string[]).includes('image');
      }

      seen.add(alias);
      result.push({ id: alias, label: name, hasVision });
    }

    return result;
  } catch {
    return [];
  }
}

export function isModelVisionCapable(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  // First check sudocode.json config (explicit input field)
  const models = readScodeModelsWithVisionFromConfig();
  const model = models.find((m) => m.id === modelId);
  if (model?.hasVision) return true;
  // Fallback to name-based detection
  return isVisionModel(modelId);
}

export function findFirstVisionModel(): string | null {
  const models = readScodeModelsWithVisionFromConfig();
  // Prefer config-marked vision models
  const fromConfig = models.find((m) => m.hasVision);
  if (fromConfig) return fromConfig.id;
  // Fallback: find first model matching name-based vision pattern
  const byPattern = models.find((m) => isVisionModel(m.id));
  if (byPattern) return byPattern.id;
  return null;
}

export function mergeScodeProxyModelInfo(modelInfo: AcpModelInfo | null, currentModelId?: string | null): AcpModelInfo | null {
  const proxyModelInfo = getScodeProxyModelInfoSync(modelInfo?.currentModelId || currentModelId);
  if (!proxyModelInfo) {
    return modelInfo;
  }

  const effectiveCurrentModelId = modelInfo?.currentModelId || proxyModelInfo.currentModelId;
  const effectiveCurrentModelLabel = proxyModelInfo.availableModels.find((model) => model.id === effectiveCurrentModelId)?.label || modelInfo?.currentModelLabel || effectiveCurrentModelId;

  return {
    ...proxyModelInfo,
    source: modelInfo?.source || proxyModelInfo.source,
    currentModelId: effectiveCurrentModelId,
    currentModelLabel: effectiveCurrentModelLabel,
    ...(modelInfo?.configOptionId ? { configOptionId: modelInfo.configOptionId } : {}),
  };
}
