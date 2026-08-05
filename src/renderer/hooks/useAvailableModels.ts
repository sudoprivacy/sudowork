/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import { uuid } from '@/common/utils';
import type { IProvider } from '@/common/storage';
import { useGeminiGoogleAuthModels } from '@/renderer/hooks/useGeminiGoogleAuthModels';
import { hasAvailableModels } from '@/renderer/pages/guid/utils/modelUtils';

/**
 * 只读的「可用模型」判定单一来源。计算逻辑对齐 useGuidModelSelection 的 modelList
 * （含 Google Auth 合成的 gemini-with-google-auth provider），但**不挂 setCurrentModel
 * 副作用**，可安全用于非 guid 页（如 team/detail 经 useHasAvailableModel 间接调用）。
 *
 * ready = modelConfig 与 google.auth.status 双解析完成；用于发送前校验时避免在 SWR
 * pending 期间误拦「仅配 Google Auth」的游客。
 */
export function useAvailableModels(): { modelList: IProvider[]; ready: boolean } {
  const { geminiModeOptions, isGoogleAuth, isGoogleAuthResolved } = useGeminiGoogleAuthModels();
  const geminiModelValues = useMemo(() => geminiModeOptions.map((option) => option.value), [geminiModeOptions]);

  const { data: modelConfig, error } = useSWR('model.config.welcome', () => {
    return ipcBridge.mode.getModelConfig.invoke().then((data) => (data || []).filter((platform) => !!platform.model.length));
  });

  const modelList = useMemo(() => {
    let allProviders: IProvider[] = [];

    if (isGoogleAuth) {
      const geminiProvider: IProvider = {
        id: uuid(),
        name: 'Gemini Google Auth',
        platform: 'gemini-with-google-auth',
        baseUrl: '',
        apiKey: '',
        model: geminiModelValues,
        capabilities: [{ type: 'text' }, { type: 'vision' }, { type: 'function_calling' }],
      };
      allProviders = [geminiProvider, ...(modelConfig || [])];
    } else {
      allProviders = modelConfig || [];
    }

    return allProviders.filter(hasAvailableModels);
  }, [geminiModelValues, isGoogleAuth, modelConfig]);

  const ready = !error && modelConfig !== undefined && isGoogleAuthResolved;
  return { modelList, ready };
}
