/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dropdown, Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import { Brain, ChevronRight, Plus } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import ActionChip from '@/renderer/components/ui/ActionChip';
import type { IProvider, TProviderWithModel } from '@/common/storage';
import { getModelDisplayLabel } from '@/renderer/utils/agentUiDisplay';
import { buildProviderModelGroups } from '@/renderer/utils/modelProviderGroups';
import type { AcpModelInfo } from '../types';
import { getAvailableModels } from '../utils/modelUtils';

type GeminiModeOption = {
  label?: string;
  description?: string;
  modelHint?: string;
  subModels?: Array<{ label: string; value: string }>;
};

type GuidModelSelectorProps = {
  // Gemini model state
  isGeminiMode: boolean;
  modelList: IProvider[];
  currentModel: TProviderWithModel | undefined;
  setCurrentModel: (model: TProviderWithModel) => Promise<void>;
  geminiModeLookup: Map<string, GeminiModeOption>;

  // ACP model state
  currentAcpCachedModelInfo: AcpModelInfo | null;
  selectedAcpModel: string | null;
  setSelectedAcpModel: React.Dispatch<React.SetStateAction<string | null>>;
};

const PANEL_CLASS = 'flex min-w-50 max-h-[min(60vh,420px)] flex-col gap-2px overflow-y-auto border border-border bg-popover p-6px shadow-lg scrollbar-hide rd-12px';
const GROUP_TITLE_CLASS = 'px-10px pt-4px pb-2px text-12px leading-18px text-foreground-secondary';
const ROW_CLASS = 'flex h-38px cursor-pointer items-center gap-8px px-10px text-14px text-foreground transition-colors hover:bg-accent active:bg-fill-deep rd-8px';

const HealthDot: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'unknown') return null;
  const color = status === 'healthy' ? 'bg-success' : status === 'unhealthy' ? 'bg-destructive' : 'bg-foreground-tertiary';
  return <div className={`w-6px h-6px rounded-full shrink-0 ${color}`} />;
};

const GeminiSubMenu: React.FC<{
  label: string;
  healthStatus: string;
  subModels: Array<{ label: string; value: string }>;
  isSelected: (value: string) => boolean;
  onSelect: (value: string) => void;
}> = ({ label, healthStatus, subModels, isSelected, onSelect }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <Dropdown
      trigger='hover'
      position='br'
      popupVisible={open}
      onVisibleChange={setOpen}
      droplist={
        <div className={PANEL_CLASS}>
          {subModels.map((subModel) => (
            <div key={subModel.value} className={classNames(ROW_CLASS, isSelected(subModel.value) && 'bg-accent')} onClick={() => onSelect(subModel.value)}>
              <span className='truncate'>{subModel.label}</span>
            </div>
          ))}
        </div>
      }
    >
      <div className={ROW_CLASS}>
        <HealthDot status={healthStatus} />
        <span className='flex-1 truncate'>{label}</span>
        <ChevronRight size={14} className='shrink-0 text-foreground-tertiary' />
      </div>
    </Dropdown>
  );
};

const GuidModelSelector: React.FC<GuidModelSelectorProps> = ({ isGeminiMode, modelList, currentModel, setCurrentModel, geminiModeLookup, currentAcpCachedModelInfo, selectedAcpModel, setSelectedAcpModel }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const defaultModelLabel = t('common.defaultModel');
  const [geminiOpen, setGeminiOpen] = React.useState(false);
  const [acpOpen, setAcpOpen] = React.useState(false);

  // 获取模型配置数据（包含健康状态）
  const { data: modelConfig } = useSWR<IProvider[]>('model.config', () => ipcBridge.mode.getModelConfig.invoke());

  // 过滤掉被禁用的 provider
  const enabledModelList = React.useMemo(() => {
    return modelList.filter((p) => p.enabled !== false);
  }, [modelList]);

  const geminiSelectedLabel = React.useMemo(() => {
    if (!currentModel?.useModel) return '';
    const isGoogleProvider = currentModel.platform?.toLowerCase().includes('gemini-with-google-auth');
    if (isGoogleProvider) {
      return geminiModeLookup.get(currentModel.useModel)?.label || currentModel.useModel;
    }
    return currentModel.useModel;
  }, [currentModel?.platform, currentModel?.useModel, geminiModeLookup]);

  const geminiButtonLabel = React.useMemo(() => {
    return getModelDisplayLabel({
      selectedValue: currentModel?.useModel,
      selectedLabel: geminiSelectedLabel,
      defaultModelLabel,
      fallbackLabel: defaultModelLabel,
    });
  }, [currentModel?.useModel, defaultModelLabel, geminiSelectedLabel]);

  const acpSelectedLabel = React.useMemo(() => {
    return currentAcpCachedModelInfo?.availableModels?.find((m) => m.id === selectedAcpModel)?.label || currentAcpCachedModelInfo?.currentModelLabel || currentAcpCachedModelInfo?.currentModelId || selectedAcpModel || '';
  }, [currentAcpCachedModelInfo?.availableModels, currentAcpCachedModelInfo?.currentModelId, currentAcpCachedModelInfo?.currentModelLabel, selectedAcpModel]);

  const acpButtonLabel = React.useMemo(() => {
    return getModelDisplayLabel({
      selectedValue: selectedAcpModel || currentAcpCachedModelInfo?.currentModelId,
      selectedLabel: acpSelectedLabel,
      defaultModelLabel,
      fallbackLabel: defaultModelLabel,
    });
  }, [acpSelectedLabel, currentAcpCachedModelInfo?.currentModelId, defaultModelLabel, selectedAcpModel]);

  const acpProviderModelGroups = React.useMemo(() => buildProviderModelGroups(currentAcpCachedModelInfo?.availableModels || [], modelConfig), [currentAcpCachedModelInfo?.availableModels, modelConfig]);

  if (isGeminiMode) {
    const handleSelectModel = (provider: IProvider, useModel: string) => {
      setGeminiOpen(false);
      setCurrentModel({ ...provider, useModel }).catch((error) => {
        console.error('Failed to set current model:', error);
      });
    };

    return (
      <Dropdown
        trigger='hover'
        popupVisible={geminiOpen}
        onVisibleChange={setGeminiOpen}
        droplist={
          <div className={PANEL_CLASS}>
            {!enabledModelList || enabledModelList.length === 0 ? (
              <>
                <div className='px-10px py-12px text-center text-14px text-foreground-secondary'>{t('settings.noAvailableModels')}</div>
                <div className={classNames(ROW_CLASS, '!h-32px text-12px text-foreground-secondary')} onClick={() => navigate('/settings/model')}>
                  <Plus size={12} />
                  <span>{t('settings.addModel')}</span>
                </div>
              </>
            ) : (
              <>
                {enabledModelList.map((provider) => {
                  const availableModels = getAvailableModels(provider);
                  if (availableModels.length === 0) return null;
                  return (
                    <div key={provider.id} className='flex flex-col gap-2px'>
                      <div className={GROUP_TITLE_CLASS}>{provider.name}</div>
                      {availableModels.map((modelName) => {
                        const isGoogleProvider = provider.platform?.toLowerCase().includes('gemini-with-google-auth');
                        const option = isGoogleProvider ? geminiModeLookup.get(modelName) : undefined;

                        // 获取模型健康状态
                        const matchedProvider = modelConfig?.find((p) => p.id === provider.id);
                        const healthStatus = matchedProvider?.modelHealth?.[modelName]?.status || 'unknown';

                        // Manual mode: show submenu with specific models
                        if (option?.subModels && option.subModels.length > 0) {
                          return (
                            <GeminiSubMenu
                              key={provider.id + modelName}
                              label={option.label || modelName}
                              healthStatus={healthStatus}
                              subModels={option.subModels}
                              isSelected={(value) => currentModel?.id + (currentModel?.useModel ?? '') === provider.id + value}
                              onSelect={(value) => handleSelectModel(provider, value)}
                            />
                          );
                        }

                        // Normal mode: show single item
                        const selected = currentModel?.id + (currentModel?.useModel ?? '') === provider.id + modelName;
                        const rowContent = (
                          <div className='flex items-center gap-8px w-full min-w-0'>
                            <HealthDot status={healthStatus} />
                            <span className='truncate'>{option ? option.label : modelName}</span>
                          </div>
                        );
                        return (
                          <div key={provider.id + modelName} className={classNames(ROW_CLASS, selected && 'bg-accent')} onClick={() => handleSelectModel(provider, modelName)}>
                            {option ? (
                              <Tooltip
                                position='right'
                                trigger='hover'
                                content={
                                  <div className='max-w-240px space-y-6px'>
                                    <div className='text-12px text-foreground-secondary leading-5'>{option.description}</div>
                                    {option.modelHint && <div className='text-11px text-foreground-tertiary'>{option.modelHint}</div>}
                                  </div>
                                }
                              >
                                {rowContent}
                              </Tooltip>
                            ) : (
                              rowContent
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                <div className={classNames(ROW_CLASS, '!h-32px text-12px text-foreground-secondary')} onClick={() => navigate('/settings/model')}>
                  <Plus size={12} />
                  <span>{t('settings.addModel')}</span>
                </div>
              </>
            )}
          </div>
        }
      >
        <ActionChip icon={<Brain size={14} />} label={geminiButtonLabel} />
      </Dropdown>
    );
  }

  // ACP cached model selector
  if (currentAcpCachedModelInfo && currentAcpCachedModelInfo.availableModels?.length > 0) {
    if (currentAcpCachedModelInfo.canSwitch) {
      return (
        <Dropdown
          trigger='click'
          popupVisible={acpOpen}
          onVisibleChange={setAcpOpen}
          droplist={
            <div className={PANEL_CLASS}>
              {acpProviderModelGroups.map((group) => (
                <div key={group.key} className='flex flex-col gap-2px'>
                  <div className={GROUP_TITLE_CLASS}>{group.name || t('common.other', { defaultValue: 'Other' })}</div>
                  {group.models.map((model) => {
                    // 获取模型健康状态
                    const backend = currentAcpCachedModelInfo.source;
                    const providerConfig = group.provider || modelConfig?.find((p) => p.platform?.includes(backend || ''));
                    const healthStatus = providerConfig?.modelHealth?.[model.id]?.status || 'unknown';
                    const selected = model.id === selectedAcpModel;

                    return (
                      <div
                        key={model.id}
                        className={classNames(ROW_CLASS, selected && 'bg-accent')}
                        onClick={() => {
                          setSelectedAcpModel(model.id);
                          setAcpOpen(false);
                        }}
                      >
                        <HealthDot status={healthStatus} />
                        <span className='truncate'>{model.label}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          }
        >
          <ActionChip icon={<Brain size={14} />} label={acpButtonLabel} />
        </Dropdown>
      );
    }

    return (
      <Tooltip content={t('conversation.welcome.modelSwitchNotSupported')} position='top'>
        <ActionChip icon={<Brain size={14} />} label={acpButtonLabel} />
      </Tooltip>
    );
  }

  // Fallback: no model switching
  return (
    <Tooltip content={t('conversation.welcome.modelSwitchNotSupported')} position='top'>
      <ActionChip icon={<Brain size={14} />} label={acpButtonLabel} />
    </Tooltip>
  );
};

export default GuidModelSelector;
