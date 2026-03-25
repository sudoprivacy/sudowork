/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge, type IOpenClawModelsResponse } from '@/common';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { usePreviewContext } from '@/renderer/pages/conversation/preview';
import { Button, Dropdown, Menu, Spin, Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

type OpenClawModel = IOpenClawModelsResponse['data'][number];

/**
 * Model selector for OpenClaw (Sudoclaw) gateway sessions.
 * Fetches model list via IPC (bypasses CORS) and displays with ratio multipliers.
 * Persists selected model to conversation extra.
 */
const OpenClawModelSelector: React.FC<{
  conversationId: string;
}> = ({ conversationId }) => {
  const { t } = useTranslation();
  const { isOpen: isPreviewOpen } = usePreviewContext();
  const layout = useLayoutContext();
  const compact = isPreviewOpen || layout?.isMobile;
  const isMobileCompact = Boolean(layout?.isMobile);

  // Fetch model list via IPC (bypasses CORS restrictions)
  const { data: response, isLoading, error } = useSWR<IOpenClawModelsResponse>('openclaw-models', () => ipcBridge.openclaw.getModels.invoke(), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60000, // Cache for 1 minute
  });

  const models = response?.data;

  // Current selected model from conversation extra
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  // Load current model from conversation extra on mount
  useEffect(() => {
    ipcBridge.conversation.get.invoke({ id: conversationId }).then((conversation) => {
      if (conversation?.extra) {
        const extra = conversation.extra as { openclawModelId?: string };
        setSelectedModelId(extra.openclawModelId || null);
      }
    }).catch((err) => {
      console.error('[OpenClawModelSelector] Failed to load conversation:', err);
    });
  }, [conversationId]);

  // Handle model selection
  const handleSelectModel = useCallback(
    async (modelId: string, modelRatio: number) => {
      console.log(`[OpenClawModelSelector] Model selected: ${modelId} (${modelRatio}x)`);

      try {
        // Notify main process (for logging and future notification API)
        await ipcBridge.openclaw.selectModel.invoke({
          conversationId,
          modelId,
          modelRatio,
        });

        // Get current conversation to merge extra
        const conversation = await ipcBridge.conversation.get.invoke({ id: conversationId });
        const currentExtra = conversation?.extra || {};

        // Update conversation extra with selected model
        const success = await ipcBridge.conversation.update.invoke({
          id: conversationId,
          updates: {
            extra: {
              ...currentExtra,
              openclawModelId: modelId,
            },
          },
        });

        if (success) {
          setSelectedModelId(modelId);
          console.log(`[OpenClawModelSelector] Model saved to conversation: ${modelId}`);
        } else {
          console.error('[OpenClawModelSelector] Failed to save model to conversation');
        }
      } catch (err) {
        console.error('[OpenClawModelSelector] Error saving model:', err);
      }
    },
    [conversationId]
  );

  // Format model label with ratio
  const formatModelLabel = useCallback((model: OpenClawModel) => {
    return `${model.model_id} (${model.model_ratio}x)`;
  }, []);

  // Find selected model object
  const selectedModel = models?.find((m) => m.model_id === selectedModelId);
  const displayLabel = selectedModel
    ? formatModelLabel(selectedModel)
    : selectedModelId || t('conversation.welcome.selectModel');

  // Loading state
  if (isLoading) {
    return (
      <Button className={classNames('sendbox-model-btn header-model-btn', compact && '!max-w-[120px]', isMobileCompact && '!max-w-[160px]')} shape='round' size='small'>
        <span className='flex items-center gap-6px min-w-0'>
          <Spin size={14} />
        </span>
      </Button>
    );
  }

  // Error state - show disabled button
  if (error || !models?.length) {
    return (
      <Tooltip content={t('conversation.welcome.modelSwitchNotSupported')} position='top'>
        <Button className={classNames('sendbox-model-btn header-model-btn', compact && '!max-w-[120px]', isMobileCompact && '!max-w-[160px]')} shape='round' size='small' style={{ cursor: 'default' }}>
          <span className='flex items-center gap-6px min-w-0'>
            <span className={compact ? 'block truncate' : undefined}>{t('conversation.welcome.useCliModel')}</span>
          </span>
        </Button>
      </Tooltip>
    );
  }

  return (
    <Dropdown
      trigger='click'
      droplist={
        <Menu>
          {models.map((model) => (
            <Menu.Item
              key={model.model_id}
              className={model.model_id === selectedModelId ? 'bg-2!' : ''}
              onClick={() => void handleSelectModel(model.model_id, model.model_ratio)}
            >
              {formatModelLabel(model)}
            </Menu.Item>
          ))}
        </Menu>
      }
    >
      <Button className={classNames('sendbox-model-btn header-model-btn', compact && '!max-w-[120px]', isMobileCompact && '!max-w-[160px]')} shape='round' size='small'>
        <span className='flex items-center gap-6px min-w-0'>
          <span className={compact ? 'block truncate' : undefined}>{displayLabel}</span>
        </span>
      </Button>
    </Dropdown>
  );
};

export default OpenClawModelSelector;