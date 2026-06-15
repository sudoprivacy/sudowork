/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ScodeConfig, ScodeModelEntry } from '@/common/ipcBridge';
import { buildCustomModelAlias, extractCustomProvidersFromScodeConfig, mergeCustomProviderIntoScodeConfig, removeCustomProviderFromScodeConfig, type ScodeCustomModelProvider } from '@/common/scodeConfig';
import AionModal from '@/renderer/components/base/AionModal';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { Button, Checkbox, Form, Input, InputNumber, Message, Popconfirm, Select, Space, Spin, Tag, Typography } from '@arco-design/web-react';
import { Delete, Download, Edit, LinkCloud, PreviewOpen, Plus, Refresh, SettingTwo } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/renderer/context/AuthContext';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const { Title, Text } = Typography;

type ProviderRow = {
  id: string;
  baseUrl: string;
  apiKey: string;
  modelIds: string[];
};

type EditableModel = ScodeCustomModelProvider['models'][number];

type EditingModelTarget = {
  provider: ProviderRow;
  modelId: string;
};

const PROVIDER_PRESETS = [
  { label: '智谱 Coding Plan / GLM Coding Plan', value: 'zhipu-coding-plan', providerId: 'zhipu-coding-plan', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', apiKeyRequired: true },
  { label: 'Kimi Coding Plan', value: 'kimi-coding-plan', providerId: 'kimi-coding-plan', baseUrl: 'https://api.moonshot.cn/v1', apiKeyRequired: true },
  { label: '智谱开放平台 / GLM API', value: 'zhipu-glm', providerId: 'zhipu-glm', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKeyRequired: true },
  { label: 'Kimi 中国版 / Kimi China', value: 'kimi-china', providerId: 'kimi-china', baseUrl: 'https://api.moonshot.cn/v1', apiKeyRequired: true },
  { label: 'MiniMax 中国版 / MiniMax China', value: 'minimax-china', providerId: 'minimax-china', baseUrl: 'https://api.minimax.chat/v1', apiKeyRequired: true },
  { label: '深度求索 / DeepSeek', value: 'deepseek', providerId: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKeyRequired: true },
  { label: 'Ollama 本地 / Ollama', value: 'ollama', providerId: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKeyRequired: false },
  { label: '自定义 / Custom', value: 'custom', providerId: 'custom-openai', baseUrl: '', apiKeyRequired: true },
];

function getEntryProvider(entry: ScodeModelEntry | undefined, mode: 'proxy' | 'api-key'): string | undefined {
  return entry?.providers?.[mode]?.provider;
}

function buildProviderRows(config: ScodeConfig | null): { sudorouterModels: string[]; customProviders: ProviderRow[] } {
  const models = config?.models || {};
  const apiKeyProviders = config?.auth_modes?.['api-key'] || {};
  const rows = new Map<string, ProviderRow>();
  const sudorouterModels: string[] = [];

  for (const [providerId, provider] of Object.entries(apiKeyProviders)) {
    rows.set(providerId, {
      id: providerId,
      baseUrl: provider.baseUrl || '',
      apiKey: provider.apiKey || '',
      modelIds: [],
    });
  }

  for (const [alias, entry] of Object.entries(models)) {
    const proxyProvider = getEntryProvider(entry, 'proxy');
    if (proxyProvider === 'sudorouter') {
      sudorouterModels.push(entry.alias || alias);
    }

    const apiKeyProvider = getEntryProvider(entry, 'api-key');
    if (apiKeyProvider) {
      const row =
        rows.get(apiKeyProvider) ||
        ({
          id: apiKeyProvider,
          baseUrl: '',
          apiKey: '',
          modelIds: [],
        } satisfies ProviderRow);
      row.modelIds.push(entry.alias || alias);
      rows.set(apiKeyProvider, row);
    }
  }

  return {
    sudorouterModels,
    customProviders: Array.from(rows.values()).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function maskSecret(value: string): string {
  if (!value) return '未设置';
  if (value.length <= 10) return `${value.slice(0, 2)}******`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function sanitizeProviderId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function contextLabel(input?: number, output?: number): string {
  const inputText = input ? `${input}K` : '默认';
  const outputText = output ? `${output}K` : '默认';
  return `${inputText} / ${outputText}`;
}

function findModelEntry(config: ScodeConfig | null, modelId: string): ScodeModelEntry | undefined {
  return config?.models?.[modelId] || Object.values(config?.models || {}).find((entry) => entry.alias === modelId);
}

function getConfiguredModelIds(config: ScodeConfig | null): string[] {
  return Object.entries(config?.models || {}).map(([alias, entry]) => entry.alias || alias);
}

function presetValueForProvider(provider?: ProviderRow): string {
  if (!provider) return 'custom';
  return PROVIDER_PRESETS.find((item) => item.providerId === provider.id && (!item.baseUrl || item.baseUrl === provider.baseUrl))?.value || 'custom';
}

function editableModelFromEntry(config: ScodeConfig | null, modelId: string): EditableModel {
  const entry = findModelEntry(config, modelId);
  const providerModelId = entry?.providers?.['api-key']?.model || modelId;
  return {
    id: providerModelId,
    name: entry?.name || providerModelId,
    input: entry?.input,
    supportsTools: entry?.supports_tools,
    supportsReasoning: entry?.supports_reasoning,
    inputContext: entry?.context?.input,
    outputContext: entry?.context?.output,
  };
}

function normalizeDefaultModel(config: ScodeConfig, previousModelId?: string, nextModelId?: string): ScodeConfig {
  if (previousModelId && nextModelId && config.default_model === previousModelId && config.models?.[nextModelId]) {
    return { ...config, default_model: nextModelId };
  }
  if (config.default_model && !config.models?.[config.default_model]) {
    const nextConfig = { ...config };
    delete nextConfig.default_model;
    return nextConfig;
  }
  return config;
}

const AddModelDialog: React.FC<{
  visible: boolean;
  onClose: () => void;
  onSubmit: (provider: ScodeCustomModelProvider, previousProviderId?: string, previousModelId?: string, nextModelId?: string) => Promise<void>;
  existingProviderIds: string[];
  existingModelIds: string[];
  config: ScodeConfig | null;
  editingTarget: EditingModelTarget | null;
}> = ({ visible, onClose, onSubmit, existingProviderIds, existingModelIds, config, editingTarget }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const providerPreset = Form.useWatch('providerPreset', form);
  const selectedPreset = useMemo(() => PROVIDER_PRESETS.find((item) => item.value === providerPreset), [providerPreset]);
  const isEditing = Boolean(editingTarget);
  const modelOptions = useMemo(() => providerModels.map((model) => ({ label: model, value: model })), [providerModels]);

  useEffect(() => {
    if (!visible) return;
    if (editingTarget) {
      const entry = findModelEntry(config, editingTarget.modelId);
      const editableModel = editableModelFromEntry(config, editingTarget.modelId);
      const input = entry?.input || [];
      form.setFieldsValue({
        providerPreset: presetValueForProvider(editingTarget.provider),
        providerId: editingTarget.provider.id,
        baseUrl: editingTarget.provider.baseUrl,
        apiKey: editingTarget.provider.apiKey,
        modelId: editableModel.id,
        supportsTools: entry?.supports_tools !== false,
        supportsVision: input.includes('image'),
        supportsReasoning: Boolean(entry?.supports_reasoning),
        inputContext: entry?.context?.input,
        outputContext: entry?.context?.output,
      });
      setShowApiKey(false);
      setProviderModels([]);
      return;
    }

    form.setFieldsValue({
      providerPreset: 'custom',
      providerId: 'custom-openai',
      baseUrl: '',
      apiKey: '',
      modelId: '',
      supportsTools: true,
      supportsVision: false,
      supportsReasoning: false,
    });
    setShowApiKey(false);
    setProviderModels([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, visible]);

  useEffect(() => {
    if (isEditing) return;
    const preset = PROVIDER_PRESETS.find((item) => item.value === providerPreset);
    if (!preset) return;
    form.setFieldsValue({
      providerId: preset.providerId,
      baseUrl: preset.baseUrl,
    });
    setProviderModels([]);
  }, [form, isEditing, providerPreset]);

  const handleFetchProviderModels = async () => {
    const baseUrl = String(form.getFieldValue('baseUrl') || '').trim();
    const apiKey = String(form.getFieldValue('apiKey') || '').trim();
    if (!baseUrl) {
      Message.warning(t('settings.pleaseEnterBaseUrl'));
      return;
    }
    if (selectedPreset?.apiKeyRequired !== false && !apiKey) {
      Message.warning(t('settings.pleaseEnterApiKey'));
      return;
    }

    setFetchingModels(true);
    try {
      const res = await ipcBridge.mode.fetchModelList.invoke({
        base_url: baseUrl,
        api_key: apiKey,
        platform: 'custom',
      });
      const models =
        res.data?.mode
          ?.map((item) => (typeof item === 'string' ? item : item.id))
          .map((item) => item.trim())
          .filter(Boolean) || [];

      if (!res.success || models.length === 0) {
        setProviderModels([]);
        Message.warning(res.msg || t('settings.fetchModelListUnsupported'));
        return;
      }

      setProviderModels(Array.from(new Set(models)));
      Message.success(t('settings.fetchModelListSuccess', { count: models.length }));
    } catch {
      setProviderModels([]);
      Message.warning(t('settings.fetchModelListUnsupported'));
    } finally {
      setFetchingModels(false);
    }
  };

  const handleSubmit = async () => {
    const values = await form.validate();
    const providerId = sanitizeProviderId(values.providerId);
    const modelId = String(values.modelId || '').trim();
    const modelAlias = buildCustomModelAlias(providerId, modelId);
    if (!providerId) {
      Message.error('Provider ID 无效');
      return;
    }
    if (existingProviderIds.some((item) => item === providerId && item !== editingTarget?.provider.id)) {
      Message.error('Provider ID 已存在，请换一个名称');
      return;
    }
    if (existingModelIds.some((item) => item === modelAlias && item !== editingTarget?.modelId)) {
      Message.error('模型名称已存在，请换一个名称');
      return;
    }

    const input = ['text'];
    if (values.supportsVision) {
      input.push('image');
    }
    const nextModel: EditableModel = {
      id: modelId,
      name: modelId,
      input,
      supportsTools: values.supportsTools,
      supportsReasoning: values.supportsReasoning,
      inputContext: values.inputContext,
      outputContext: values.outputContext,
    };

    const models = editingTarget ? editingTarget.provider.modelIds.map((item) => (item === editingTarget.modelId ? nextModel : editableModelFromEntry(config, item))) : [nextModel];

    setSaving(true);
    try {
      await onSubmit(
        {
          providerId,
          baseUrl: values.baseUrl,
          apiKey: values.apiKey || '',
          models,
        },
        editingTarget?.provider.id,
        editingTarget?.modelId,
        modelAlias
      );
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <AionModal visible={visible} header={{ title: isEditing ? '编辑模型' : '添加模型', showClose: true }} style={{ width: 760 }} contentStyle={{ background: 'var(--bg-1)', padding: '20px 24px 16px', overflow: 'auto' }} onCancel={onClose} footer={null}>
      <div className='mb-4 flex items-center gap-2'>
        <Tag bordered>仅支持 OpenAI 兼容协议 API</Tag>
      </div>
      <Form form={form} layout='vertical'>
        <Form.Item label='提供商' field='providerPreset' rules={[{ required: true }]}>
          <Select options={PROVIDER_PRESETS} />
        </Form.Item>
        <Form.Item label='Provider ID' field='providerId' rules={[{ required: true }]} extra='写入 sudocode.json auth_modes.api-key 下的唯一 key。'>
          <Input
            placeholder='custom-openai'
            onBlur={(event) => {
              form.setFieldValue('providerId', sanitizeProviderId(event.target.value));
            }}
          />
        </Form.Item>
        <Form.Item label='接口地址' field='baseUrl' rules={[{ required: true }]}>
          <Input placeholder='https://api.example.com/v1' />
        </Form.Item>
        <Form.Item label='API Key' field='apiKey' rules={selectedPreset?.apiKeyRequired === false ? [] : [{ required: true }]}>
          <Input type={showApiKey ? 'text' : 'password'} placeholder={selectedPreset?.apiKeyRequired === false ? '本地服务可留空' : '输入你的 API Key'} suffix={<Button type='text' size='mini' icon={<PreviewOpen />} onClick={() => setShowApiKey((prev) => !prev)} />} />
        </Form.Item>
        <Form.Item
          label={
            <div className='flex items-center justify-between gap-3 w-full'>
              <span>模型名称</span>
              <Button size='mini' icon={<Download />} loading={fetchingModels} onClick={() => void handleFetchProviderModels()}>
                {t('settings.fetchModelList')}
              </Button>
            </div>
          }
          field='modelId'
          rules={[{ required: true }]}
          extra={providerModels.length > 0 ? t('settings.modelListSelectOrManualHint') : t('settings.modelListFetchHint')}
        >
          <Select
            showSearch
            allowCreate
            options={modelOptions}
            loading={fetchingModels}
            placeholder='例如 gpt-4o 或 openai/gpt-4o'
            notFoundContent={fetchingModels ? <Spin size={16} /> : t('settings.modelListManualInputHint')}
            filterOption={(inputValue, option) => {
              const value = String((option as React.ReactElement<{ value?: string }>)?.props?.value || '');
              return value.toLowerCase().includes(inputValue.toLowerCase());
            }}
          />
        </Form.Item>
        <div className='mb-2 text-14px font-600 text-t-primary'>高级配置</div>
        <div className='grid grid-cols-1 md:grid-cols-3 gap-3 mb-4'>
          <Form.Item field='supportsTools' triggerPropName='checked'>
            <Checkbox>工具调用</Checkbox>
          </Form.Item>
          <Form.Item field='supportsVision' triggerPropName='checked'>
            <Checkbox>图片输入</Checkbox>
          </Form.Item>
          <Form.Item field='supportsReasoning' triggerPropName='checked'>
            <Checkbox>推理模式</Checkbox>
          </Form.Item>
        </div>
        <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
          <Form.Item label='输入上下文（K）' field='inputContext'>
            <InputNumber min={1} placeholder='使用提供商默认值' className='w-full' />
          </Form.Item>
          <Form.Item label='输出上下文（K）' field='outputContext'>
            <InputNumber min={1} placeholder='使用提供商默认值' className='w-full' />
          </Form.Item>
        </div>
      </Form>
      <div className='flex justify-end gap-2.5 mt-2.5'>
        <Button onClick={onClose} className='px-5 min-w-20' style={{ borderRadius: 'var(--radius-md)' }}>
          取消
        </Button>
        <Button type='primary' onClick={handleSubmit} loading={saving} className='px-5 min-w-20' style={{ borderRadius: 'var(--radius-md)' }}>
          保存
        </Button>
      </div>
    </AionModal>
  );
};

const SudocodeModelSettingsContent: React.FC = () => {
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
        Message.error(res?.msg || '读取模型配置失败');
        return;
      }
      setConfig(res.data || {});
    } finally {
      setLoading(false);
    }
  }, []);

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
          Message.error(res?.msg || '保存模型配置失败');
          return;
        }
        if (user?.id) {
          const persistRes = await ipcBridge.scode.saveCustomModelProviders.invoke({ userId: user.id, providers: extractCustomProvidersFromScodeConfig(nextConfig) });
          if (!persistRes?.success) {
            Message.error(persistRes?.msg || '保存第三方模型配置失败');
            return;
          }
        }
        setConfig(nextConfig);
        Message.success('模型配置已保存');
      } finally {
        setSaving(false);
      }
    },
    [user?.id]
  );

  const openAddDialog = useCallback(() => {
    setEditingTarget(null);
    setDialogVisible(true);
  }, []);

  const openEditDialog = useCallback((provider: ProviderRow, modelId: string) => {
    setEditingTarget({ provider, modelId });
    setDialogVisible(true);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogVisible(false);
    setEditingTarget(null);
  }, []);

  const handleSubmitProvider = useCallback(
    async (provider: ScodeCustomModelProvider, previousProviderId?: string, previousModelId?: string, nextModelId?: string) => {
      const sourceConfig = previousProviderId && previousProviderId !== provider.providerId ? removeCustomProviderFromScodeConfig(config || {}, previousProviderId) : config || {};
      const nextConfig = normalizeDefaultModel(mergeCustomProviderIntoScodeConfig(sourceConfig, provider), previousModelId, nextModelId);
      await saveConfig(nextConfig);
    },
    [config, saveConfig]
  );

  const handleRemoveProvider = useCallback(
    async (providerId: string) => {
      await saveConfig(removeCustomProviderFromScodeConfig(config || {}, providerId));
    },
    [config, saveConfig]
  );

  if (loading) {
    return (
      <div className='h-full f-center'>
        <Spin tip='加载模型配置...' />
      </div>
    );
  }

  return (
    <AionScrollArea className='h-full'>
      <div className='px-4 md:px-6 py-4'>
        <div className='flex items-center justify-between gap-4 mb-5 flex-wrap'>
          <div>
            <Title heading={5} className='!m-0 text-20px'>
              模型
            </Title>
            <Text type='secondary'>管理 sudocode.json 中供本地 Sudo Code 使用的模型。</Text>
          </div>
          <Space>
            <Button icon={<Refresh />} onClick={loadConfig}>
              刷新
            </Button>
            <Button type='primary' icon={<Plus theme='outline' size='16' fill='white' strokeWidth={2} />} onClick={openAddDialog} className='!bg-[var(--ui-accent-orange)] !border-[var(--ui-accent-orange)] !text-white hover:!bg-[var(--ui-accent-orange-hover)] hover:!border-[var(--ui-accent-orange-hover)] hover:!text-white'>
              添加模型
            </Button>
          </Space>
        </div>

        <div className='grid grid-cols-1 md:grid-cols-3 gap-3 mb-5'>
          <div className='bg-2 rd-8px border border-solid border-[var(--color-border-2)] p-4'>
            <div className='text-12px text-t-secondary mb-1.5'>默认模型</div>
            <div className='text-16px font-600 text-t-primary truncate'>{config?.default_model || '未设置'}</div>
          </div>
          <div className='bg-2 rd-8px border border-solid border-[var(--color-border-2)] p-4'>
            <div className='text-12px text-t-secondary mb-1.5'>Sudorouter 模型</div>
            <div className='text-16px font-600 text-t-primary'>{sudorouterModels.length}</div>
          </div>
          <div className='bg-2 rd-8px border border-solid border-[var(--color-border-2)] p-4'>
            <div className='text-12px text-t-secondary mb-1.5'>第三方提供商</div>
            <div className='text-16px font-600 text-t-primary'>{customProviders.length}</div>
          </div>
        </div>

        <div className='space-y-4'>
          <section className='border border-solid border-[var(--color-border-2)] rd-8px overflow-hidden bg-2'>
            <div className='px-4 py-3 flex items-center justify-between'>
              <div className='flex items-center gap-2 font-600 text-t-primary'>
                <LinkCloud theme='outline' size='18' />
                Sudorouter
              </div>
              <Tag color='green'>登录账号默认</Tag>
            </div>
            <div className='p-3 flex flex-wrap gap-2'>{sudorouterModels.length === 0 ? <Text type='secondary'>暂无登录下发模型</Text> : sudorouterModels.map((model) => <Tag key={model}>{model}</Tag>)}</div>
          </section>

          {customProviders.length === 0 ? (
            <div className='border border-dashed border-[var(--color-border-2)] rd-8px bg-2 py-12 text-center'>
              <SettingTwo theme='outline' size='42' className='text-t-tertiary mb-3' />
              <div className='text-15px font-600 text-t-primary mb-1'>还没有第三方模型</div>
              <Text type='secondary'>添加 OpenAI 兼容 API 后，可在 Sudo Code 模型下拉中选择。</Text>
            </div>
          ) : (
            customProviders.map((provider) => (
              <section key={provider.id} className='border border-solid border-[var(--color-border-2)] rd-8px overflow-hidden bg-2'>
                <div className='px-4 py-3 border-b border-solid border-[var(--color-border-2)] flex items-center justify-between gap-3 flex-wrap'>
                  <div className='min-w-0'>
                    <div className='flex items-center gap-2 font-600 text-t-primary'>
                      <LinkCloud theme='outline' size='18' />
                      <span className='truncate'>{provider.id}</span>
                      <Tag color='blue'>OpenAI 兼容</Tag>
                    </div>
                    <div className='text-12px text-t-secondary truncate mt-1'>{provider.baseUrl}</div>
                  </div>
                  <Space>
                    <Tag bordered>{maskSecret(provider.apiKey)}</Tag>
                    <Popconfirm title='删除该第三方提供商及其模型？' onOk={() => void handleRemoveProvider(provider.id)}>
                      <Button status='danger' icon={<Delete />} loading={saving}>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                </div>
                <div className='divide-y divide-light'>
                  {provider.modelIds.map((modelId) => {
                    const entry = findModelEntry(config, modelId);
                    const displayModelId = entry?.providers?.['api-key']?.model || entry?.name || modelId;
                    const input = entry?.input || [];
                    return (
                      <div key={modelId} className='px-4 py-3 flex items-center justify-between gap-3 flex-wrap'>
                        <div className='min-w-0'>
                          <div className='text-14px font-600 text-t-primary truncate'>{displayModelId}</div>
                          <div className='mt-1.5 flex flex-wrap gap-1.5'>
                            {entry?.supports_tools !== false && <Tag size='small'>工具调用</Tag>}
                            {input.includes('image') && (
                              <Tag size='small' color='arcoblue'>
                                图片输入
                              </Tag>
                            )}
                            {entry?.supports_reasoning && (
                              <Tag size='small' color='purple'>
                                推理模式
                              </Tag>
                            )}
                            <Tag size='small' color='gray'>
                              上下文 {contextLabel(entry?.context?.input, entry?.context?.output)}
                            </Tag>
                          </div>
                        </div>
                        <Button icon={<Edit />} loading={saving} onClick={() => openEditDialog(provider, modelId)}>
                          编辑
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </div>

      <AddModelDialog visible={dialogVisible} onClose={closeDialog} onSubmit={handleSubmitProvider} existingProviderIds={customProviders.map((provider) => provider.id)} existingModelIds={configuredModelIds} config={config} editingTarget={editingTarget} />
    </AionScrollArea>
  );
};

const SudocodeModelSettings: React.FC = () => {
  return (
    <SettingsPageWrapper contentClassName='max-w-275'>
      <SudocodeModelSettingsContent />
    </SettingsPageWrapper>
  );
};

export default SudocodeModelSettings;
