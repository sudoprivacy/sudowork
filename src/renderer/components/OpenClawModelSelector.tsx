/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge, type IOpenClawModelsResponse } from '@/common';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { usePreviewContext } from '@/renderer/pages/conversation/preview';
import { Button, Dropdown, Menu } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { Down } from '@icon-park/react';

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
  const {
    data: response,
    isLoading,
    error,
  } = useSWR<IOpenClawModelsResponse>(['openclaw-models', conversationId], () => ipcBridge.openclaw.getModels.invoke(), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 0, // 每次都重新请求模型列表
    revalidateOnMount: true, // 组件挂载时重新请求模型列表
  });

  const models = response?.data;

  // Current selected model from conversation extra
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const lastSyncedModelRef = useRef<string | null>(null);

  // Load current model from conversation extra on mount
  useEffect(() => {
    // 只有当 models 加载完成后才会执行
    if (!models) {
      return;
    }

    ipcBridge.conversation.get
      .invoke({ id: conversationId })
      .then((conversation) => {
        if (conversation?.extra) {
          const extra = conversation.extra as { openclawModelId?: string };
          setSelectedModelId(extra.openclawModelId || null);
        } else {
          // 如果 conversation.extra 中没有 openclawModelId 属性，从模型列表中找到 isPrimary 是 true 的模型
          const primaryModel = models.find((model) => model.isPrimary);
          if (primaryModel) {
            setSelectedModelId(primaryModel.model_id);
          }
        }
      })
      .catch((err) => {
        console.error('[OpenClawModelSelector] Failed to load conversation:', err);
        // 如果加载 conversation 失败，从模型列表中找到 isPrimary 是 true 的模型
        const primaryModel = models.find((model) => model.isPrimary);
        if (primaryModel) {
          setSelectedModelId(primaryModel.model_id);
        }
      });
  }, [conversationId, models]);

  const syncSelectedModel = useCallback(
    async (model: OpenClawModel, options?: { updateState?: boolean; force?: boolean; reason?: 'initial' | 'manual' }) => {
      const { updateState = true, force = false, reason = 'manual' } = options || {};
      const syncKey = `${conversationId}:${model.model_id}`;
      if (!force && lastSyncedModelRef.current === syncKey) {
        return true;
      }

      console.log(`[OpenClawModelSelector] Model ${reason === 'initial' ? 'initialized' : 'selected'}: ${model.model_id} (${model.model_ratio}x)`);

      try {
        await ipcBridge.openclaw.selectModel.invoke({
          conversationId,
          modelId: model.model_id,
          modelRatio: model.model_ratio,
        });

        const conversation = await ipcBridge.conversation.get.invoke({ id: conversationId });
        const currentExtra = conversation?.extra || {};
        const currentModelId = (currentExtra as { openclawModelId?: string }).openclawModelId || null;

        if (currentModelId !== model.model_id) {
          const success = await ipcBridge.conversation.update.invoke({
            id: conversationId,
            updates: {
              extra: {
                ...currentExtra,
                openclawModelId: model.model_id,
              },
            },
          });

          if (!success) {
            console.error('[OpenClawModelSelector] Failed to save model to conversation');
            return false;
          }
        }

        lastSyncedModelRef.current = syncKey;
        if (updateState) {
          setSelectedModelId(model.model_id);
        }
        console.log(`[OpenClawModelSelector] Model synced to conversation: ${model.model_id}`);
        return true;
      } catch (err) {
        console.error('[OpenClawModelSelector] Error syncing model:', err);
        return false;
      }
    },
    [conversationId]
  );

  // Handle model selection
  const handleSelectModel = useCallback(
    async (modelId: string) => {
      const model = models?.find((item) => item.model_id === modelId);
      if (!model) {
        return;
      }

      await syncSelectedModel(model, { updateState: true, force: true, reason: 'manual' });
    },
    [models, syncSelectedModel]
  );

  // Ensure the current model is synced on first load as well.
  useEffect(() => {
    if (!models?.length) {
      return;
    }

    const currentModel = models.find((model) => model.model_id === selectedModelId) || models.find((model) => model.isPrimary);
    if (!currentModel) {
      return;
    }

    void syncSelectedModel(currentModel, {
      updateState: selectedModelId == null,
      reason: 'initial',
    });
  }, [models, selectedModelId, syncSelectedModel]);

  // Format model label with ratio and primary indicator
  const formatModelLabel = useCallback(
    (model: OpenClawModel) => {
      const label = `${model.model_id} (${model.model_ratio}x)`;
      return model.model_id === selectedModelId || (model.isPrimary && !selectedModelId) ? `${label} (当前模型)` : label;
    },
    [selectedModelId]
  );

  // Find selected model object
  const selectedModel = models?.find((m) => m.model_id === selectedModelId) || models?.find((m) => m.isPrimary);
  const displayLabel = selectedModel ? formatModelLabel(selectedModel) : selectedModelId || t('conversation.welcome.selectModel');

  // Show loading state when models are being fetched
  if (isLoading) {
    return (
      <Button className={classNames('sendbox-model-btn header-model-btn', compact && '!max-w-[120px]', isMobileCompact && '!max-w-[160px]')} shape='round' size='small' disabled>
        <span className='flex items-center gap-6px min-w-0'>
          <span>{t('common.loading', { defaultValue: 'Loading...' })}</span>
        </span>
      </Button>
    );
  }

  // Hide selector when models are unavailable (error or empty)
  if (error || !models?.length) {
    return null;
  }

  return (
    <Dropdown
      trigger='click'
      droplist={
        <Menu>
          {models.map((model) => (
            <Menu.Item key={model.model_id} className={model.model_id === selectedModelId ? 'bg-2!' : ''} onClick={() => void handleSelectModel(model.model_id)}>
              {formatModelLabel(model)}
            </Menu.Item>
          ))}
        </Menu>
      }
    >
      <Button className={classNames('sendbox-model-btn header-model-btn', compact && '!max-w-[120px]', isMobileCompact && '!max-w-[160px]')} shape='round' size='small'>
        <span className='flex items-center gap-6px min-w-0'>
          <span className={compact ? 'block truncate' : undefined}>{displayLabel}</span>
          <Down theme='outline' size={14} />
        </span>
      </Button>
    </Dropdown>
  );
};

export default OpenClawModelSelector;
