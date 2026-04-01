/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge, type IOpenClawModelsResponse } from '../../common';
import type { SudoclawConfig } from '@/common/ipcBridge';
import { mainLog, mainError } from '@/process/utils/mainLogger';

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
    mainLog('OpenClawBridge', 'Model selected', {
      conversationId: params.conversationId,
      modelId: params.modelId,
      modelRatio: params.modelRatio,
      timestamp: new Date().toISOString(),
    });

    // 修改 sudoclaw.json 配置文件
    const { SUDOCLAW_CONFIG_PATH } = await import('@/process/services/sudoclaw/SudoclawInstallService');
    const fs = await import('fs');

    if (fs.existsSync(SUDOCLAW_CONFIG_PATH)) {
      try {
        const raw = fs.readFileSync(SUDOCLAW_CONFIG_PATH, 'utf-8');
        const config = JSON.parse(raw) as SudoclawConfig;

        // 1. 确定 API 类型
        let apiType: string;
        if (params.modelId.includes('gemini')) {
          apiType = 'google-generative-ai';
        } else if (params.modelId.includes('claude')) {
          apiType = 'anthropic-messages';
        } else {
          apiType = 'openai-responses';
        }

        // 2. 创建对应的 provider 名称（如 sudorouter-gemini-3-pro-preview）
        const providerName = `sudorouter-${params.modelId}`;

        // 3. 确保 models.providers 结构存在
        if (!config.models) {
          config.models = { providers: {} };
        }
        const models = config.models as NonNullable<SudoclawConfig['models']>;
        if (!models.providers) {
          models.providers = {};
        }

        const providers = models.providers;
        const providerEntries = Object.entries(providers) as Array<[string, NonNullable<SudoclawConfig['models']>['providers'][string]]>;

        // 4. 确保该 provider 存在，并且只包含当前模型
        if (!providers[providerName]) {
          providers[providerName] = {
            baseUrl: 'https://hk.sudorouter.ai/v1',
            api: apiType,
            models: [],
          };
        }
        const provider = providers[providerName];
        const hasSelectedModel = Array.isArray(provider.models) && provider.models.some((model) => model.id === params.modelId);
        const canonicalApiKey =
          providerEntries
            .filter(([name]) => name !== providerName)
            .map(([, item]) => item?.apiKey)
            .find((key): key is string => typeof key === 'string' && key.trim().length > 0) || (typeof provider.apiKey === 'string' && provider.apiKey.trim().length > 0 ? provider.apiKey : undefined);
        const hasSameApiKey = !canonicalApiKey || provider.apiKey === canonicalApiKey;

        // 确保 provider 只包含当前模型；即使模型已存在，也需要继续比对 apiKey 是否需要同步
        if (!hasSelectedModel) {
          provider.models = [{ id: params.modelId, name: params.modelId }];
        }

        // 如果已有 provider 的模型已存在，也需要同步最新的 apiKey，避免旧 key 残留
        if (!hasSameApiKey && canonicalApiKey) {
          provider.apiKey = canonicalApiKey;
        }

        // 5. 确保 agents.defaults.model.primary 是选中的模型，包含完整路径
        if (!config.agents) {
          config.agents = { defaults: {} };
        }
        const agents = config.agents as NonNullable<SudoclawConfig['agents']>;
        if (!agents.defaults) {
          agents.defaults = {};
        }
        if (!agents.defaults.model) {
          agents.defaults.model = { primary: `${providerName}/${params.modelId}` };
        }
        const fullModelPath = `${providerName}/${params.modelId}`;
        if (agents.defaults.model.primary !== fullModelPath) {
          agents.defaults.model.primary = fullModelPath;
        }

        // 6. 保存修改后的配置
        fs.writeFileSync(SUDOCLAW_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
        mainLog('OpenClawBridge', 'Updated sudoclaw.json config');
      } catch (error) {
        mainError('OpenClawBridge', 'Failed to update sudoclaw.json config', error);
      }
    }
  });
}
