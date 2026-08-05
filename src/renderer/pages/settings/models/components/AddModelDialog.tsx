/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Checkbox, Form, Input, InputNumber, Message, Modal, Select, Spin, Tag } from '@arco-design/web-react';
import { IconDownload, IconEye } from '@arco-design/web-react/icon';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ScodeConfig } from '@/common/ipcBridge';
import { buildCustomModelAlias, type ScodeCustomModelProvider } from '@/common/scodeConfig';
import { editableModelFromEntry, findModelEntry, presetValueForProvider, sanitizeProviderId, PROVIDER_PRESETS } from '../utils';
import type { EditableModel, EditingModelTarget } from '../types';

function normalizeModelIds(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean)));
}

const DEFAULT_MODEL_API = 'openai-completions';

const MODEL_API_OPTIONS = [
  { value: 'openai-completions', i18nKey: 'settings.sudocodeModel.protocolOpenAICompletions', fallback: 'OpenAI Chat Completions' },
  { value: 'openai-responses', i18nKey: 'settings.sudocodeModel.protocolOpenAIResponses', fallback: 'OpenAI Responses' },
  { value: 'anthropic-messages', i18nKey: 'settings.sudocodeModel.protocolAnthropicMessages', fallback: 'Anthropic Messages' },
];

function buildEditableModel(modelId: string, values: IAddModelFormValues): EditableModel {
  const input = ['text'];
  if (values.supportsVision) {
    input.push('image');
  }
  return {
    id: modelId,
    name: modelId,
    api: values.api,
    input,
    supportsTools: values.supportsTools,
    supportsReasoning: values.supportsReasoning,
    inputContext: values.inputContext,
    outputContext: values.outputContext,
  };
}

export default function AddModelDialog({ visible, onClose, onSubmit, existingProviderIds, existingModelIds, config, editingTarget }: IAddModelDialogProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [isSaving, setIsSaving] = useState(false);
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const providerPreset = Form.useWatch('providerPreset', form);
  const selectedApi = String(Form.useWatch('api', form) || DEFAULT_MODEL_API);
  const selectedModelIds = normalizeModelIds(Form.useWatch('modelIds', form));
  const selectedPreset = useMemo(() => PROVIDER_PRESETS.find((item) => item.value === providerPreset), [providerPreset]);
  const isEditing = Boolean(editingTarget);
  const modelOptions = useMemo(() => providerModels.map((model) => ({ label: model, value: model })), [providerModels]);
  const modelApiOptions = useMemo(() => MODEL_API_OPTIONS.map((item) => ({ label: t(item.i18nKey, item.fallback), value: item.value })), [t]);

  useEffect(() => {
    if (!visible) return;
    form.resetFields();
    if (editingTarget) {
      const entry = findModelEntry(config, editingTarget.modelId);
      const editableModel = editableModelFromEntry(config, editingTarget.modelId);
      const input = entry?.input || [];
      form.setFieldsValue({
        providerPreset: presetValueForProvider(editingTarget.provider),
        providerId: editingTarget.provider.id,
        baseUrl: editingTarget.provider.baseUrl,
        apiKey: editingTarget.provider.apiKey,
        api: editableModel.api || DEFAULT_MODEL_API,
        modelId: editableModel.id,
        modelIds: [],
        supportsTools: entry?.supports_tools !== false,
        supportsVision: input.includes('image'),
        supportsReasoning: Boolean(entry?.supports_reasoning),
        inputContext: entry?.context?.input,
        outputContext: entry?.context?.output,
      });
      setIsApiKeyVisible(false);
      setProviderModels([]);
      return;
    }

    form.setFieldsValue({
      providerPreset: 'custom',
      providerId: 'custom-openai',
      baseUrl: '',
      apiKey: '',
      api: DEFAULT_MODEL_API,
      modelId: '',
      modelIds: [],
      supportsTools: true,
      supportsVision: false,
      supportsReasoning: false,
    });
    setIsApiKeyVisible(false);
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
      api: preset.api || DEFAULT_MODEL_API,
      modelIds: [],
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

    setIsFetchingModels(true);
    try {
      const res = await ipcBridge.mode.fetchModelList.invoke({
        base_url: baseUrl,
        api_key: apiKey,
        platform: selectedApi === 'anthropic-messages' ? 'anthropic' : 'custom',
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
      setIsFetchingModels(false);
    }
  };

  const handleSubmit = async () => {
    const values = (await form.validate()) as IAddModelFormValues;
    const providerId = sanitizeProviderId(values.providerId);
    const modelIds = isEditing ? normalizeModelIds(values.modelId) : normalizeModelIds(values.modelIds);
    const modelAlias = isEditing && modelIds[0] ? buildCustomModelAlias(providerId, modelIds[0]) : undefined;
    if (!providerId) {
      Message.error(t('settings.sudocodeModel.providerIdInvalid', 'Provider ID 无效'));
      return;
    }
    if (modelIds.length === 0) {
      Message.error(t('settings.sudocodeModel.modelRequired', '请至少选择或输入一个模型'));
      return;
    }
    if (existingProviderIds.some((item) => item === providerId && item !== editingTarget?.provider.id)) {
      Message.error(t('settings.sudocodeModel.providerIdExists', 'Provider ID 已存在，请换一个名称'));
      return;
    }

    for (const modelId of modelIds) {
      const alias = buildCustomModelAlias(providerId, modelId);
      if (existingModelIds.some((item) => item === alias && item !== editingTarget?.modelId)) {
        Message.error(t('settings.sudocodeModel.modelIdExists', '模型名称已存在，请换一个名称'));
        return;
      }
    }

    const nextModels = modelIds.map((modelId) => buildEditableModel(modelId, values));
    const models = editingTarget ? editingTarget.provider.modelIds.map((item) => (item === editingTarget.modelId ? nextModels[0] : editableModelFromEntry(config, item))) : nextModels;

    setIsSaving(true);
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
      setIsSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      title={isEditing ? t('settings.sudocodeModel.editModelTitle', '编辑模型') : t('settings.addModel', '添加模型')}
      style={{ width: 760 }}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={t('common.save', '保存')}
      cancelText={t('common.cancel', '取消')}
      confirmLoading={isSaving}
    >
      <div className='mb-4 flex items-center gap-2'>
        <Tag bordered>{t('settings.sudocodeModel.openAIOnlyHint', '仅支持 OpenAI 兼容协议 API')}</Tag>
      </div>
      <Form form={form} layout='vertical'>
        <Form.Item label={t('settings.sudocodeModel.providerLabel', '提供商')} field='providerPreset' rules={[{ required: true }]}>
          <Select options={PROVIDER_PRESETS} />
        </Form.Item>
        <Form.Item label='Provider ID' field='providerId' rules={[{ required: true }]} extra={t('settings.sudocodeModel.providerIdExtra', '写入 sudocode.json auth_modes.api-key 下的唯一 key。')}>
          <Input
            placeholder='custom-openai'
            onBlur={(event) => {
              form.setFieldValue('providerId', sanitizeProviderId(event.target.value));
            }}
          />
        </Form.Item>
        <Form.Item label={t('settings.sudocodeModel.baseUrlLabel', '接口地址')} field='baseUrl' rules={[{ required: true }]}>
          <Input placeholder='https://api.example.com/v1' />
        </Form.Item>
        <Form.Item label={t('settings.sudocodeModel.protocolLabel', '请求协议')} field='api' rules={[{ required: true }]} extra={t('settings.sudocodeModel.protocolExtra', '选择该模型的 API 请求格式，保存后写入 sudocode.json 的 providers.api-key.api。')}>
          <Select options={modelApiOptions} />
        </Form.Item>
        <Form.Item label='API Key' field='apiKey' rules={selectedPreset?.apiKeyRequired === false ? [] : [{ required: true }]}>
          <Input
            type={isApiKeyVisible ? 'text' : 'password'}
            placeholder={selectedPreset?.apiKeyRequired === false ? t('settings.sudocodeModel.apiKeyOptionalPlaceholder', '本地服务可留空') : t('settings.sudocodeModel.apiKeyRequiredPlaceholder', '输入你的 API Key')}
            suffix={<Button type='text' size='mini' icon={<IconEye />} onClick={() => setIsApiKeyVisible((prev) => !prev)} />}
          />
        </Form.Item>
        {isEditing ? (
          <Form.Item
            label={
              <div className='flex items-center justify-between gap-3 w-full'>
                <span>{t('settings.sudocodeModel.modelIdLabel', '模型名称')}</span>
                <Button size='mini' icon={<IconDownload />} loading={isFetchingModels} onClick={() => void handleFetchProviderModels()}>
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
              loading={isFetchingModels}
              placeholder={t('settings.sudocodeModel.modelIdPlaceholder', '例如 gpt-4o 或 openai/gpt-4o')}
              notFoundContent={isFetchingModels ? <Spin size={16} /> : t('settings.modelListManualInputHint')}
              filterOption={(inputValue, option) => {
                const value = String((option as React.ReactElement<{ value?: string }>)?.props?.value || '');
                return value.toLowerCase().includes(inputValue.toLowerCase());
              }}
            />
          </Form.Item>
        ) : (
          <Form.Item
            label={
              <div className='flex items-center justify-between gap-3 w-full'>
                <span>{t('settings.sudocodeModel.modelIdLabel', '模型名称')}</span>
                <Button size='mini' icon={<IconDownload />} loading={isFetchingModels} onClick={() => void handleFetchProviderModels()}>
                  {t('settings.fetchModelList')}
                </Button>
              </div>
            }
            field='modelIds'
            rules={[{ required: true }]}
            extra={providerModels.length > 0 ? t('settings.sudocodeModel.bulkModelSelectHint', '可从列表多选模型，也可继续手动输入。') : t('settings.modelListFetchHint')}
          >
            <Select
              mode='multiple'
              showSearch
              allowCreate
              allowClear
              maxTagCount={4}
              options={modelOptions}
              loading={isFetchingModels}
              placeholder={t('settings.sudocodeModel.modelIdsPlaceholder', '选择或输入一个或多个模型')}
              notFoundContent={isFetchingModels ? <Spin size={16} /> : t('settings.modelListManualInputHint')}
              filterOption={(inputValue, option) => {
                const value = String((option as React.ReactElement<{ value?: string }>)?.props?.value || '');
                return value.toLowerCase().includes(inputValue.toLowerCase());
              }}
            />
          </Form.Item>
        )}
        {!isEditing && selectedModelIds.length > 0 && (
          <div className='mb-4 border border-light rd-2 bg-muted p-3'>
            <div className='mb-2 text-12px text-secondary'>{t('settings.sudocodeModel.selectedModelsCount', '已选择 {{count}} 个模型', { count: selectedModelIds.length })}</div>
            <div className='flex flex-wrap gap-1.5'>
              {selectedModelIds.map((modelId) => (
                <Tag
                  key={modelId}
                  closable
                  onClose={() =>
                    form.setFieldValue(
                      'modelIds',
                      selectedModelIds.filter((item) => item !== modelId)
                    )
                  }
                >
                  {modelId}
                </Tag>
              ))}
            </div>
          </div>
        )}
        <div className='mb-2 text-14px font-600 text-foreground'>{t('settings.sudocodeModel.advancedConfig', '高级配置')}</div>
        <div className='grid grid-cols-1 md:grid-cols-3 gap-3 mb-4'>
          <Form.Item field='supportsTools' triggerPropName='checked'>
            <Checkbox>{t('settings.sudocodeModel.supportsTools', '工具调用')}</Checkbox>
          </Form.Item>
          <Form.Item field='supportsVision' triggerPropName='checked'>
            <Checkbox>{t('settings.sudocodeModel.supportsVision', '图片输入')}</Checkbox>
          </Form.Item>
          <Form.Item field='supportsReasoning' triggerPropName='checked'>
            <Checkbox>{t('settings.sudocodeModel.supportsReasoning', '推理模式')}</Checkbox>
          </Form.Item>
        </div>
        <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
          <Form.Item label={t('settings.sudocodeModel.inputContextLabel', '输入上下文（K）')} field='inputContext'>
            <InputNumber min={1} placeholder={t('settings.sudocodeModel.contextDefaultPlaceholder', '使用提供商默认值')} className='w-full' />
          </Form.Item>
          <Form.Item label={t('settings.sudocodeModel.outputContextLabel', '输出上下文（K）')} field='outputContext'>
            <InputNumber min={1} placeholder={t('settings.sudocodeModel.contextDefaultPlaceholder', '使用提供商默认值')} className='w-full' />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}

interface IAddModelFormValues {
  providerPreset: string;
  providerId: string;
  baseUrl: string;
  apiKey?: string;
  api: string;
  modelId?: string;
  modelIds?: string[];
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  inputContext?: number;
  outputContext?: number;
}

interface IAddModelDialogProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (provider: ScodeCustomModelProvider, previousProviderId?: string, previousModelId?: string, nextModelId?: string) => Promise<void>;
  existingProviderIds: string[];
  existingModelIds: string[];
  config: ScodeConfig | null;
  editingTarget: EditingModelTarget | null;
}
