/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IProvider, TProviderWithModel } from '@sudowork/common/storage';
import type { GeminiModelSelection } from '../types';
import { useModelProviderList } from './useModelProviderList';

export interface UseGeminiModelSelectionOptions {
  initialModel: TProviderWithModel | undefined;
  onSelectModel: (provider: IProvider, modelName: string) => Promise<boolean>;
}

// Centralize model selection logic for reuse across header, send box, and channel settings
export const useGeminiModelSelection = ({ initialModel, onSelectModel }: UseGeminiModelSelectionOptions): GeminiModelSelection => {
  const { t } = useTranslation();
  const [currentModel, setCurrentModel] = useState<TProviderWithModel | undefined>(initialModel);

  useEffect(() => {
    setCurrentModel(initialModel);
  }, [initialModel]);

  const { providers, geminiModeLookup, getAvailableModels, formatModelLabel } = useModelProviderList();

  const handleSelectModel = useCallback(
    async (provider: IProvider, modelName: string) => {
      const selected = {
        ...(provider as unknown as TProviderWithModel),
        useModel: modelName,
      } as TProviderWithModel;
      const ok = await onSelectModel(provider, modelName);
      if (ok) {
        setCurrentModel(selected);
        const displayName = formatModelLabel(provider, modelName) || modelName;
        Message.success(t('common.modelSwitchSuccess', { model: displayName }));
      }
    },
    [onSelectModel, formatModelLabel, t]
  );

  const getDisplayModelName = useCallback(
    (modelName?: string) => {
      if (!modelName) return '';
      const label = formatModelLabel(currentModel, modelName);
      const maxLength = 20;
      return label.length > maxLength ? `${label.slice(0, maxLength)}...` : label;
    },
    [currentModel, formatModelLabel]
  );

  return {
    currentModel,
    providers,
    geminiModeLookup,
    formatModelLabel,
    getDisplayModelName,
    getAvailableModels,
    handleSelectModel,
  };
};
