/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDefaultAcpModelId } from '@/common/acp/defaultModels';
import type { AcpModelInfo } from '@/types/acpTypes';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SUDOCODE_CONFIG_PATH = path.join(os.homedir(), '.nexus', 'sudocode', 'sudocode.json');

type ScodeProxyModel = {
  id: string;
  label: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readScodeProxyModelsFromConfig(): ScodeProxyModel[] {
  try {
    const raw = fs.readFileSync(SUDOCODE_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as { models?: unknown };
    const models = asRecord(parsed.models);
    if (!models) {
      return [];
    }

    const seen = new Set<string>();
    const result: ScodeProxyModel[] = [];

    for (const [key, value] of Object.entries(models)) {
      const model = asRecord(value);
      const providers = asRecord(model?.providers);
      const proxyProvider = asRecord(providers?.proxy);
      if (!proxyProvider) {
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

export function getScodeProxyModelInfoSync(currentModelId?: string | null): AcpModelInfo | null {
  const availableModels = readScodeProxyModelsFromConfig();
  if (availableModels.length === 0) {
    return null;
  }

  const explicitModelId = typeof currentModelId === 'string' && currentModelId.trim() ? currentModelId.trim() : null;
  const defaultModelId = getDefaultAcpModelId('scode');
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

export function mergeScodeProxyModelInfo(modelInfo: AcpModelInfo | null, currentModelId?: string | null): AcpModelInfo | null {
  const proxyModelInfo = getScodeProxyModelInfoSync(modelInfo?.currentModelId || currentModelId);
  if (!proxyModelInfo) {
    return modelInfo;
  }

  const effectiveCurrentModelId = modelInfo?.currentModelId || proxyModelInfo.currentModelId;
  const effectiveCurrentModelLabel =
    proxyModelInfo.availableModels.find((model) => model.id === effectiveCurrentModelId)?.label || modelInfo?.currentModelLabel || effectiveCurrentModelId;

  return {
    ...proxyModelInfo,
    source: modelInfo?.source || proxyModelInfo.source,
    currentModelId: effectiveCurrentModelId,
    currentModelLabel: effectiveCurrentModelLabel,
    ...(modelInfo?.configOptionId ? { configOptionId: modelInfo.configOptionId } : {}),
  };
}
