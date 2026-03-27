/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge, type IOpenClawModelsResponse } from '../../common';

const MODEL_API_URL = 'https://hk.sudorouter.ai/api/specific_pricing';

export function initOpenClawBridge(): void {
  ipcBridge.openclaw.getModels.provider(async () => {
    try {
      const response = await fetch(MODEL_API_URL, { signal: AbortSignal.timeout(5000) });
      const json: IOpenClawModelsResponse = await response.json();
      if (!json.success) {
        throw new Error('API returned success=false');
      }
      return json;
    } catch (error) {
      console.error('[OpenClawBridge] Failed to fetch models:', error);
      throw error;
    }
  });

  ipcBridge.openclaw.selectModel.provider(async (params) => {
    console.log('[OpenClawBridge] Model selected:', {
      conversationId: params.conversationId,
      modelId: params.modelId,
      modelRatio: params.modelRatio,
      timestamp: new Date().toISOString(),
    });

    // 修改 sudoclaw.json 配置文件
    const { SUDOCLAW_CONFIG_PATH } = await import('@/process/services/sudoclaw/SudoclawInstallService');
    const fs = await import('fs');
    const path = await import('path');

    if (fs.existsSync(SUDOCLAW_CONFIG_PATH)) {
      try {
        const raw = fs.readFileSync(SUDOCLAW_CONFIG_PATH, 'utf-8');
        const config = JSON.parse(raw) as Record<string, unknown>;

        // 1. 确定 API 类型
        let apiType: string;
        if (params.modelId.includes('gemini')) {
          apiType = 'google-generative-ai';
        } else if (params.modelId.includes('claude')) {
          apiType = 'anthropic';
        } else {
          apiType = 'openai';
        }

        // 2. 确保 models.providers.sudorouter 存在
        if (!config.models) {
          config.models = { providers: {} };
        }
        const models = config.models as { providers?: Record<string, any> };
        if (!models.providers) {
          models.providers = {};
        }
        if (!models.providers.sudorouter) {
          models.providers.sudorouter = {
            baseUrl: 'https://hk.sudorouter.ai/v1',
            api: apiType,
            models: [],
          };
        }

        // 3. 检查模型是否已存在
        const provider = models.providers.sudorouter;
        if (!Array.isArray(provider.models)) {
          provider.models = [];
        }
        const modelExists = provider.models.some((m: any) => m.id === params.modelId);
        if (!modelExists) {
          // 如果模型不存在，添加到模型列表中
          provider.models.push({ id: params.modelId, name: params.modelId });

          // 确定 API 类型
          if (params.modelId.includes('gemini')) {
            provider.api = 'google-generative-ai';
          } else if (params.modelId.includes('claude')) {
            provider.api = 'anthropic';
          } else {
            provider.api = 'openai';
          }

          // 如果没有 apiKey，从已配置的模型中获取第一个（如果有）
          if (!provider.apiKey) {
            // 尝试从其他已配置的 providers 中获取第一个 apiKey
            const allProviders = Object.values(models.providers) as any[];
            const existingApiKey = allProviders.find((p: any) => p.apiKey)?.apiKey;
            if (existingApiKey) {
              provider.apiKey = existingApiKey;
            }
          }
        }

        // 4. 确保 agents.defaults.model.primary 是选中的模型
        if (!config.agents) {
          config.agents = { defaults: {} };
        }
        const agents = config.agents as { defaults?: any };
        if (!agents.defaults) {
          agents.defaults = {};
        }
        if (!agents.defaults.model) {
          agents.defaults.model = { primary: params.modelId };
        }
        if (agents.defaults.model.primary !== params.modelId) {
          agents.defaults.model.primary = params.modelId;
        }

        // 5. 保存修改后的配置
        fs.writeFileSync(SUDOCLAW_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
        console.log('[OpenClawBridge] Updated sudoclaw.json config');
      } catch (error) {
        console.error('[OpenClawBridge] Failed to update sudoclaw.json config:', error);
      }
    }
  });
}
