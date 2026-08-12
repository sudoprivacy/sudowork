/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import useSWR from 'swr';
import { ipcBridge } from '@/common';
import type { IProvider } from '@/common/storage';
import { hasAvailableModels } from '@/renderer/pages/guid/utils/modelUtils';

/**
 * 只读的「可用模型」判定单一来源，不挂 setCurrentModel 副作用。
 */
export function useAvailableModels(): { modelList: IProvider[]; ready: boolean } {
  const { data: modelConfig, error } = useSWR('model.config.welcome', () => {
    return ipcBridge.mode.getModelConfig.invoke().then((data) => (data || []).filter((platform) => !!platform.model.length));
  });

  const modelList = (modelConfig || []).filter(hasAvailableModels);

  const ready = !error && modelConfig !== undefined;
  return { modelList, ready };
}
