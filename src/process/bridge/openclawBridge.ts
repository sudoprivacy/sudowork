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
    // TODO: Call notification API here when implemented
  });
}
