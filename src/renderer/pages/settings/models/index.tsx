/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message, Popconfirm, Space, Spin, Tag, Typography } from '@arco-design/web-react';
import { IconCloud, IconDelete, IconEdit, IconPlus, IconRefresh, IconSettings } from '@arco-design/web-react/icon';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ScodeConfig } from '@/common/ipcBridge';
import { extractCustomProvidersFromScodeConfig, IMAGE_GENERATION_MODEL_PATTERN, mergeCustomProviderIntoScodeConfig, removeCustomProviderFromScodeConfig, type ScodeCustomModelProvider } from '@/common/scodeConfig';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { GUEST_USER_ID, useAuth } from '@/renderer/context/AuthContext';
import PageWrapper from '@renderer/components/base/PageWrapper';
import type { EditingModelTarget, ProviderRow } from './types';
import { buildProviderRows, contextLabel, findModelEntry, getConfiguredModelIds, maskSecret, normalizeDefaultModel } from './utils';
import AddModelDialog from './components/AddModelDialog';

const { Text } = Typography;

function protocolLabel(api?: string): { color: 'arcoblue' | 'green' | 'purple'; i18nKey: string; fallback: string } {
  switch (api) {
    case 'openai-responses':
      return { color: 'green', i18nKey: 'settings.sudocodeModel.protocolOpenAIResponses', fallback: 'OpenAI Responses' };
    case 'anthropic-messages':
      return { color: 'purple', i18nKey: 'settings.sudocodeModel.protocolAnthropicMessages', fallback: 'Anthropic Messages' };
    case 'openai-completions':
    default:
      return { color: 'arcoblue', i18nKey: 'settings.sudocodeModel.protocolOpenAICompletions', fallback: 'OpenAI Chat Completions' };
  }
}

const SudocodeModelSettings: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [config, setConfig] = useState<ScodeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [editingTarget, setEditingTarget] = useState<EditingModelTarget | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ipcBridge.scode.getConfig.invoke();
      if (!res?.success) {
        Message.error(res?.msg || t('settings.sudocodeModel.loadConfigFailed', '读取模型配置失败'));
        return;
      }
      setConfig(res.data || {});
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const { sudorouterModels, customProviders } = useMemo(() => buildProviderRows(config), [config]);
  const configuredModelIds = useMemo(() => getConfiguredModelIds(config), [config]);

  const saveConfig = useCallback(
    async (nextConfig: ScodeConfig) => {
      setSaving(true);
      try {
        const res = await ipcBridge.scode.saveConfig.invoke({ config: nextConfig });
        if (!res?.success) {
          Message.error(res?.msg || t('settings.sudocodeModel.saveConfigFailed', '保存模型配置失败'));
          return;
        }
        const userId = user?.id ?? GUEST_USER_ID;
        const persistRes = await ipcBridge.scode.saveCustomModelProviders.invoke({ userId, providers: extractCustomProvidersFromScodeConfig(nextConfig) });
        if (!persistRes?.success) {
          Message.error(persistRes?.msg || t('settings.sudocodeModel.saveCustomProvidersFailed', '保存第三方模型配置失败'));
          return;
        }
        setConfig(nextConfig);
        Message.success(t('settings.sudocodeModel.saveConfigSuccess', '模型配置已保存'));
      } finally {
        setSaving(false);
      }
    },
    [user?.id, t]
  );

  const onOpenAddDialog = useCallback(() => {
    setEditingTarget(null);
    setDialogVisible(true);
  }, []);

  const onOpenEditModelDialog = useCallback((provider: ProviderRow, modelId: string) => {
    setEditingTarget({ mode: 'model', provider, modelId });
    setDialogVisible(true);
  }, []);

  const onOpenEditProviderDialog = useCallback((provider: ProviderRow) => {
    setEditingTarget({ mode: 'provider', provider });
    setDialogVisible(true);
  }, []);

  const onCloseDialog = useCallback(() => {
    setDialogVisible(false);
    setEditingTarget(null);
  }, []);

  const onSubmitProvider = useCallback(
    async (provider: ScodeCustomModelProvider, previousProviderId?: string, previousModelId?: string, nextModelId?: string) => {
      const sourceConfig = previousProviderId && previousProviderId !== provider.providerId ? removeCustomProviderFromScodeConfig(config || {}, previousProviderId) : config || {};
      const nextConfig = normalizeDefaultModel(mergeCustomProviderIntoScodeConfig(sourceConfig, provider), previousModelId, nextModelId);
      await saveConfig(nextConfig);
    },
    [config, saveConfig]
  );

  const onRemoveProvider = useCallback(
    async (providerId: string) => {
      await saveConfig(removeCustomProviderFromScodeConfig(config || {}, providerId));
    },
    [config, saveConfig]
  );

  const getProviderProtocolLabels = useCallback(
    (provider: ProviderRow) => {
      const apis = new Set(provider.modelIds.map((modelId) => findModelEntry(config, modelId)?.providers?.['api-key']?.api || 'openai-completions'));
      return Array.from(apis).map((api) => protocolLabel(api));
    },
    [config]
  );

  return (
    <PageWrapper
      title={t('settings.sudocodeModel.pageTitle', '模型')}
      subtitle={t('settings.sudocodeModel.pageDescription', '管理 sudocode.json 中供本地 Sudo Code 使用的模型。')}
      actions={
        <Space>
          <Button icon={<IconRefresh />} onClick={loadConfig}>
            {t('common.refresh', '刷新')}
          </Button>
          <Button type='primary' icon={<IconPlus />} onClick={onOpenAddDialog} className='!bg-primary !border-[var(--ui-accent-orange)] !text-white hover:!bg-[var(--ui-accent-orange-hover)] hover:!border-[var(--ui-accent-orange-hover)] hover:!text-white'>
            {t('settings.addModel', '添加模型')}
          </Button>
        </Space>
      }
    >
      {loading ? (
        <div className='h-full f-center'>
          <Spin tip={t('settings.sudocodeModel.loadingConfig', '加载模型配置...')} />
        </div>
      ) : (
        <AionScrollArea className='h-full'>
          <div className='grid grid-cols-1 md:grid-cols-3 gap-3 mb-5'>
            <div className='bg-muted rd-3 border border-light p-4'>
              <div className='text-12px text-secondary mb-1.5'>{t('common.defaultModel', '默认模型')}</div>
              <div className='text-16px font-600 text-foreground truncate'>{config?.default_model || t('common.notSet', '未设置')}</div>
            </div>
            <div className='bg-muted rd-3 border border-light p-4'>
              <div className='text-12px text-secondary mb-1.5'>{t('settings.sudocodeModel.sudorouterModels', 'Sudorouter 模型')}</div>
              <div className='text-16px font-600 text-foreground'>{sudorouterModels.length}</div>
            </div>
            <div className='bg-muted rd-3 border border-light p-4'>
              <div className='text-12px text-secondary mb-1.5'>{t('settings.sudocodeModel.customProviders', '第三方提供商')}</div>
              <div className='text-16px font-600 text-foreground'>{customProviders.length}</div>
            </div>
          </div>

          <div className='space-y-4'>
            <section className='border border-light rd-3 overflow-hidden bg-muted'>
              <div className='px-4 py-3 flex items-center justify-between'>
                <div className='flex items-center gap-2 font-600 text-foreground'>
                  <IconCloud className='text-18px' />
                  Sudorouter
                </div>
                <Tag color='green'>{t('settings.sudocodeModel.sudorouterDefaultTag', '登录账号默认')}</Tag>
              </div>
              <div className='p-3 flex flex-wrap gap-2'>{sudorouterModels.length === 0 ? <Text type='secondary'>{t('settings.sudocodeModel.noSudorouterModels', '暂无登录下发模型')}</Text> : sudorouterModels.map((model) => <Tag key={model}>{model}</Tag>)}</div>
            </section>

            {customProviders.length === 0 ? (
              <div className='border border-light border-dashed rd-3 bg-muted py-12 text-center'>
                <IconSettings className='text-32px text-tertiary mb-3' />
                <div className='text-15px font-600 text-foreground mb-1'>{t('settings.sudocodeModel.noCustomProviders', '还没有第三方模型')}</div>
                <Text type='secondary'>{t('settings.sudocodeModel.noCustomProvidersHint', '添加 OpenAI/Anthropic 兼容 API 后，可在 Sudo Code 模型下拉中选择。')}</Text>
              </div>
            ) : (
              customProviders.map((provider) => (
                <section key={provider.id} className='border border-light rd-3 overflow-hidden bg-muted'>
                  <div className='px-4 py-3 border-b border-light flex items-center justify-between gap-3 flex-wrap'>
                    <div className='min-w-0'>
                      <div className='flex items-center gap-2 font-600 text-foreground'>
                        <IconCloud className='text-18px' />
                        <span className='truncate'>{provider.id}</span>
                        {getProviderProtocolLabels(provider).map((item) => (
                          <Tag key={item.i18nKey} color={item.color}>
                            {t(item.i18nKey, item.fallback)}
                          </Tag>
                        ))}
                      </div>
                      <div className='text-12px text-secondary truncate mt-1'>{provider.baseUrl}</div>
                    </div>
                    <Space>
                      <Tag bordered>{maskSecret(provider.apiKey) || t('common.notSet', '未设置')}</Tag>
                      <Button icon={<IconEdit />} loading={saving} onClick={() => onOpenEditProviderDialog(provider)}>
                        {t('common.edit', '编辑')}
                      </Button>
                      <Popconfirm title={t('settings.sudocodeModel.deleteProviderConfirm', '删除该第三方提供商及其模型？')} onOk={() => void onRemoveProvider(provider.id)}>
                        <Button status='danger' icon={<IconDelete style={{ fontSize: 16 }} />} loading={saving}>
                          {t('common.delete', '删除')}
                        </Button>
                      </Popconfirm>
                    </Space>
                  </div>
                  <div className='divide-y divide-light'>
                    {provider.modelIds.map((modelId) => {
                      const entry = findModelEntry(config, modelId);
                      const displayModelId = entry?.providers?.['api-key']?.model || entry?.name || modelId;
                      const input = entry?.input || [];
                      const isImageGenerationSupported = entry?.supports_image_generation === true || (entry?.supports_image_generation !== false && IMAGE_GENERATION_MODEL_PATTERN.test(displayModelId));
                      return (
                        <div key={modelId} className='px-4 py-3 flex items-center justify-between gap-3 flex-wrap'>
                          <div className='min-w-0'>
                            <div className='text-14px font-600 text-foreground truncate'>{displayModelId}</div>
                            <div className='mt-1.5 flex flex-wrap gap-1.5'>
                              {entry?.supports_tools !== false && <Tag size='small'>{t('settings.sudocodeModel.supportsTools', '工具调用')}</Tag>}
                              {input.includes('image') && (
                                <Tag size='small' color='arcoblue'>
                                  {t('settings.sudocodeModel.supportsVision', '图片输入')}
                                </Tag>
                              )}
                              {entry?.supports_reasoning && (
                                <Tag size='small' color='purple'>
                                  {t('settings.sudocodeModel.supportsReasoning', '推理模式')}
                                </Tag>
                              )}
                              {isImageGenerationSupported && (
                                <Tag size='small' color='green'>
                                  {t('settings.sudocodeModel.supportsImageGeneration', '图片生成')}
                                </Tag>
                              )}
                              <Tag size='small' color='gray'>
                                {t('settings.sudocodeModel.contextLabel', '上下文')} {contextLabel(entry?.context?.input, entry?.context?.output, t('common.default', '默认'))}
                              </Tag>
                            </div>
                          </div>
                          <Button icon={<IconEdit />} loading={saving} onClick={() => onOpenEditModelDialog(provider, modelId)}>
                            {t('common.edit', '编辑')}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </div>
        </AionScrollArea>
      )}
      <AddModelDialog visible={dialogVisible} onClose={onCloseDialog} onSubmit={onSubmitProvider} existingProviderIds={customProviders.map((provider) => provider.id)} existingModelIds={configuredModelIds} config={config} editingTarget={editingTarget} />
    </PageWrapper>
  );
};

export default SudocodeModelSettings;
