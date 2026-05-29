/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge, type IOpenClawModelsResponse } from '../../common';
import type { SudoclawConfig } from '@/common/ipcBridge';
import { mainLog, mainError } from '@/process/utils/mainLogger';
import { userBreadcrumbs } from '@process/telemetry/BreadcrumbTracker';

const MODEL_API_URL = 'https://hk.sudorouter.ai/api/specific_pricing';

export function initOpenClawBridge(): void {
  ipcBridge.openclaw.getModels.provider(async () => {
    try {
      const response = await fetch(MODEL_API_URL, { signal: AbortSignal.timeout(15000) });
      const json: IOpenClawModelsResponse = await response.json();
      if (!json.success) {
        throw new Error('API returned success=false');
      }

      // 检查配置文件，找到默认模型并添加标记
      const { SUDOCLAW_CONFIG_PATH } = await import('@/process/services/sudoclaw/SudoclawInstallService');
      const fs = await import('fs');

      let primaryModelId: string | null = null;
      if (fs.existsSync(SUDOCLAW_CONFIG_PATH)) {
        try {
          const raw = fs.readFileSync(SUDOCLAW_CONFIG_PATH, 'utf-8');
          const config = JSON.parse(raw) as Record<string, unknown>;
          const agents = config.agents as { defaults?: { model?: { primary?: string } } };
          if (agents?.defaults?.model?.primary) {
            const fullPath = agents.defaults.model.primary as string;
            // 从路径中提取模型ID，例如 "sudorouter-gemini-3-pro-preview/gemini-3-pro-preview" 提取 "gemini-3-pro-preview"
            const parts = fullPath.split('/');
            primaryModelId = parts[parts.length - 1];
          }
        } catch (error) {
          mainError('OpenClawBridge', 'Failed to read config file', error);
        }
      }

      // 在返回的模型数据中添加 isPrimary 标记
      if (primaryModelId && json.data) {
        json.data = json.data.map((model) => ({
          ...model,
          isPrimary: model.model_id === primaryModelId,
        }));
      }

      return json;
    } catch (error) {
      mainError('OpenClawBridge', 'Failed to fetch models', error);
      throw error;
    }
  });

  ipcBridge.openclaw.selectModel.provider(async (params) => {
    // Breadcrumb: model selected
    userBreadcrumbs.selectModel(params.modelId, 'openclaw');

    mainLog('OpenClawBridge', 'Model selected', {
      conversationId: params.conversationId,
      modelId: params.modelId,
      modelRatio: params.modelRatio,
      timestamp: new Date().toISOString(),
    });
    return undefined;
  });

  ipcBridge.openclaw.updateImageModel.provider(async (params) => {
    const { SUDOCLAW_CONFIG_PATH } = await import('@/process/services/sudoclaw/SudoclawInstallService');
    const fs = await import('fs');
    if (!fs.existsSync(SUDOCLAW_CONFIG_PATH)) return;
    try {
      const raw = fs.readFileSync(SUDOCLAW_CONFIG_PATH, 'utf-8');
      const config = JSON.parse(raw) as SudoclawConfig;
      if (!config.agents) config.agents = { defaults: {} };
      if (!config.agents.defaults) config.agents.defaults = {};
      config.agents.defaults.imageGenerationModel = params.modelId ?? '';
      fs.writeFileSync(SUDOCLAW_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
      mainLog('OpenClawBridge', 'Updated image generation model in sudoclaw.json:', params.modelId);
    } catch (error) {
      mainError('OpenClawBridge', 'Failed to update image model in sudoclaw.json', error);
    }
  });
}
