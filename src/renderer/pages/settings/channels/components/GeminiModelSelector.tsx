/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import { IconDown } from '@arco-design/web-react/icon';
import React from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import useSWR from 'swr';
import { getModelDisplayLabel } from '@/renderer/utils/agentUiDisplay';
import { usePreviewContext } from '@/renderer/pages/conversation/preview';
import { ipcBridge } from '@/common';
import type { IProvider } from '@/common/storage';
import type { GeminiModelSelection } from '../types';

// Unified model dropdown for chat header, send box, and channel settings
const GeminiModelSelector: React.FC<{
  selection?: GeminiModelSelection;
  disabled?: boolean;
  label?: string;
  variant?: 'header' | 'settings';
}> = ({ selection, disabled = false, label: customLabel, variant = 'header' }) => {
  const { t } = useTranslation();
  const { isOpen: isPreviewOpen } = usePreviewContext();
  const compact = variant === 'header' && isPreviewOpen;
  const defaultModelLabel = t('common.defaultModel');

  // 获取模型配置数据（包含健康状态）
  const { data: modelConfig } = useSWR<IProvider[]>('model.config', () => ipcBridge.mode.getModelConfig.invoke());

  // 获取当前模型的健康状态 (must be called before any early return to keep hooks count stable)
  const currentModel = selection?.currentModel;
  const currentModelHealth = React.useMemo(() => {
    if (!currentModel || !modelConfig) return { status: 'unknown', color: 'bg-text-3' };
    const matchedProvider = modelConfig.find((p) => p.id === currentModel.id);
    const healthStatus = matchedProvider?.modelHealth?.[currentModel.useModel]?.status || 'unknown';
    const healthColor = healthStatus === 'healthy' ? 'bg-success' : healthStatus === 'unhealthy' ? 'bg-danger' : 'bg-text-3';
    return { status: healthStatus, color: healthColor };
  }, [currentModel, modelConfig]);

  // Disabled state (non-Gemini Agent): render a simple Tooltip + Button, no Dropdown needed
  if (disabled || !selection) {
    const displayLabel = customLabel || t('conversation.welcome.useCliModel');

    if (variant === 'settings') {
      return <div className='text-14px text-secondary min-w-40'>{displayLabel}</div>;
    }

    return (
      <Tooltip content={t('conversation.welcome.modelSwitchNotSupported')} position='top'>
        <Button className={classNames('sendbox-model-btn header-model-btn', compact && 'max-w-[120px]!')} shape='round' size='small' style={{ cursor: 'default' }}>
          <span className='flex items-center gap-1.5 min-w-0'>
            <span className={compact ? 'block truncate' : undefined}>{displayLabel}</span>
          </span>
        </Button>
      </Tooltip>
    );
  }

  const { providers, geminiModeLookup, getAvailableModels, handleSelectModel, formatModelLabel } = selection;

  // formatModelLabel returns the friendly label for known modes (e.g. 'Auto (Gemini 3)')
  // and falls back to the raw model name for manual sub-model selections.
  const rawLabel = currentModel ? formatModelLabel(currentModel, currentModel.useModel) : '';
  const label =
    customLabel ||
    getModelDisplayLabel({
      selectedValue: currentModel?.useModel,
      selectedLabel: rawLabel,
      defaultModelLabel,
      fallbackLabel: t('conversation.welcome.selectModel'),
    });

  const triggerButton =
    variant === 'settings' ? (
      <Button type='secondary' className='min-w-40' icon={<IconDown style={{ fontSize: 14 }} />}>
        <div className='flex items-center gap-2 min-w-0'>
          {currentModelHealth.status !== 'unknown' && <div className={`size-1.5 rd-full shrink-0 ${currentModelHealth.color}`} />}
          <span className='truncate'>{label}</span>
        </div>
      </Button>
    ) : (
      <Button className={classNames('sendbox-model-btn header-model-btn', compact && 'max-w-[120px]!')} shape='round' size='small'>
        <span className='flex items-center gap-1.5 min-w-0'>
          {currentModelHealth.status !== 'unknown' && <div className={`size-1.5 rd-full shrink-0 ${currentModelHealth.color}`} />}
          <span className={compact ? 'block truncate' : undefined}>{label}</span>
        </span>
      </Button>
    );

  return (
    <Dropdown
      trigger='click'
      position={variant === 'settings' ? 'br' : undefined}
      droplist={
        <Menu>
          {providers.map((provider) => {
            const models = getAvailableModels(provider);
            if (!models.length) return null;

            return (
              <Menu.ItemGroup title={provider.name} key={provider.id}>
                {models.map((modelName) => {
                  const isGoogleProvider = provider.platform?.toLowerCase().includes('gemini-with-google-auth');
                  const option = isGoogleProvider ? geminiModeLookup.get(modelName) : undefined;

                  // Manual mode: show submenu with specific models
                  if (option?.subModels && option.subModels.length > 0) {
                    return (
                      <Menu.SubMenu
                        key={`${provider.id}-${modelName}`}
                        title={
                          <div className='flex items-center justify-between gap-3 w-full'>
                            <span>{option.label}</span>
                          </div>
                        }
                      >
                        {option.subModels.map((subModel) => (
                          <Menu.Item key={`${provider.id}-${subModel.value}`} className={currentModel?.id + currentModel?.useModel === provider.id + subModel.value ? 'bg-accent!' : ''} onClick={() => void handleSelectModel(provider, subModel.value)}>
                            {subModel.label}
                          </Menu.Item>
                        ))}
                      </Menu.SubMenu>
                    );
                  }

                  // Normal mode: show single item
                  return (
                    <Menu.Item key={`${provider.id}-${modelName}`} onClick={() => void handleSelectModel(provider, modelName)}>
                      {(() => {
                        // 获取模型健康状态
                        const matchedProvider = modelConfig?.find((p) => p.id === provider.id);
                        const healthStatus = matchedProvider?.modelHealth?.[modelName]?.status || 'unknown';
                        const healthColor = healthStatus === 'healthy' ? 'bg-success' : healthStatus === 'unhealthy' ? 'bg-danger' : 'bg-text-3';

                        if (!option) {
                          return (
                            <div className='flex items-center gap-2 w-full'>
                              {healthStatus !== 'unknown' && <div className={`size-1.5 rd-full shrink-0 ${healthColor}`} />}
                              <span>{modelName}</span>
                            </div>
                          );
                        }
                        return (
                          <Tooltip
                            position='right'
                            trigger='hover'
                            content={
                              <div className='max-w-60 space-y-1.5'>
                                <div className='text-12px text-tertiary leading-5'>{option.description}</div>
                                {option.modelHint && <div className='text-11px text-tertiary'>{option.modelHint}</div>}
                              </div>
                            }
                          >
                            <div className='flex items-center gap-2 w-full'>
                              {healthStatus !== 'unknown' && <div className={`size-1.5 rd-full shrink-0 ${healthColor}`} />}
                              <span>{option.label}</span>
                            </div>
                          </Tooltip>
                        );
                      })()}
                    </Menu.Item>
                  );
                })}
              </Menu.ItemGroup>
            );
          })}
        </Menu>
      }
    >
      {triggerButton}
    </Dropdown>
  );
};

export default GeminiModelSelector;
