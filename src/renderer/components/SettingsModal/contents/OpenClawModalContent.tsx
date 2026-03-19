/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { SudoclawConfig, SudoclawProvider } from '@/common/ipcBridge';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { Button, Collapse, Form, Input, Message, Popconfirm, Select } from '@arco-design/web-react';
import { Delete, Plus } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsViewMode } from '../settingsViewContext';

const API_TYPE_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'custom', label: 'Custom' },
];

type ProviderEntry = { key: string; provider: SudoclawProvider };

const OpenClawModalContent: React.FC = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{ installed: boolean; configPath: string } | null>(null);
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState<{ error?: string; stdout?: string; stderr?: string } | null>(null);
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, statusRes] = await Promise.all([ipcBridge.sudoclaw.getConfig.invoke(), ipcBridge.sudoclaw.getStatus.invoke()]);
      if (statusRes?.success && statusRes.data) setStatus(statusRes.data);
      if (configRes?.success && configRes.data) {
        const c = configRes.data;
        form.setFieldsValue({
          primaryModel: c.agents?.defaults?.model?.primary || 'anthropic/claude-sonnet-4-5',
          modelsMode: c.models?.mode || 'merge',
        });
        const prov = c.models?.providers || {};
        setProviders(
          Object.entries(prov)
            .filter(([key]) => key.trim() && !/^provider_\d+$/.test(key))
            .map(([key, p]) => ({
              key,
              provider: { baseUrl: p.baseUrl, apiKey: p.apiKey, api: p.api, models: p.models || [] },
            }))
        );
      } else {
        form.setFieldsValue({
          primaryModel: 'anthropic/claude-sonnet-4-5',
          modelsMode: 'merge',
        });
        setProviders([]);
      }
    } catch (err) {
      console.error('[OpenClawSettings] Load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [form]);

  const buildPatchFromForm = useCallback((): SudoclawConfig => {
    const values = form.getFieldsValue();
    const providersMap: Record<string, SudoclawProvider> = {};
    for (const { key, provider } of providers) {
      const k = key.trim();
      if (!k) continue;
      if (/^provider_\d+$/.test(k)) continue;
      const hasData = provider.baseUrl || provider.apiKey || provider.api || (provider.models?.length && provider.models.some((m) => m.id?.trim()));
      if (!hasData) continue;
      const models = provider.models?.filter((m) => m.id?.trim()).map((m) => ({ id: m.id.trim(), name: m.name?.trim() || undefined }));
      providersMap[k] = {
        baseUrl: provider.baseUrl || undefined,
        apiKey: provider.apiKey || undefined,
        api: provider.api || undefined,
        models: models?.length ? models : undefined,
      };
    }
    return {
      models: {
        mode: values.modelsMode || 'merge',
        providers: providersMap,
      },
      agents: {
        defaults: {
          model: {
            primary: values.primaryModel || 'anthropic/claude-sonnet-4-5',
          },
        },
      },
    };
  }, [form, providers]);

  const saveConfig = useCallback(async () => {
    setSaving(true);
    try {
      const patch = buildPatchFromForm();
      const res = await ipcBridge.sudoclaw.saveConfig.invoke({ config: patch });
      if (res?.success) {
        Message.success(t('common.saveSuccess', { defaultValue: 'Saved' }));
      } else {
        Message.error(res?.msg || t('common.saveFailed', { defaultValue: 'Save failed' }));
      }
    } catch (err) {
      Message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [buildPatchFromForm, t]);

  const handleAddProvider = useCallback(() => {
    setProviders((prev) => [...prev, { key: `provider_${Date.now()}`, provider: {} }]);
  }, []);

  const handleRemoveProvider = useCallback((idx: number) => {
    setProviders((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleProviderChange = useCallback((idx: number, field: keyof SudoclawProvider, value: string | SudoclawProvider['models']) => {
    setProviders((prev) => {
      const next = [...prev];
      const entry = next[idx];
      if (!entry) return prev;
      next[idx] = {
        ...entry,
        provider: { ...entry.provider, [field]: value },
      };
      return next;
    });
  }, []);

  const handleProviderKeyChange = useCallback((idx: number, key: string) => {
    setProviders((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, key };
      return next;
    });
  }, []);

  const handleAddModel = useCallback((idx: number) => {
    setProviders((prev) => {
      const next = [...prev];
      const entry = next[idx];
      if (!entry) return prev;
      const models = [...(entry.provider.models || []), { id: '', name: '' }];
      next[idx] = { ...entry, provider: { ...entry.provider, models } };
      return next;
    });
  }, []);

  const handleModelChange = useCallback((providerIdx: number, modelIdx: number, field: 'id' | 'name', value: string) => {
    setProviders((prev) => {
      const next = [...prev];
      const entry = next[providerIdx];
      if (!entry) return prev;
      const models = [...(entry.provider.models || [])];
      const m = models[modelIdx];
      if (!m) return prev;
      models[modelIdx] = { ...m, [field]: value };
      next[providerIdx] = { ...entry, provider: { ...entry.provider, models } };
      return next;
    });
  }, []);

  const handleRemoveModel = useCallback((providerIdx: number, modelIdx: number) => {
    setProviders((prev) => {
      const next = [...prev];
      const entry = next[providerIdx];
      if (!entry) return prev;
      const models = (entry.provider.models || []).filter((_, i) => i !== modelIdx);
      next[providerIdx] = { ...entry, provider: { ...entry.provider, models } };
      return next;
    });
  }, []);

  const handleTestGateway = useCallback(async () => {
    setTestStatus('testing');
    setTestError(null);
    try {
      const res = await ipcBridge.sudoclaw.testGateway.invoke();
      if (!res?.success || !res.data) {
        setTestStatus('error');
        setTestError({ error: res?.msg || 'Unknown error' });
        return;
      }
      const { success, error, stdout, stderr } = res.data;
      if (success) {
        setTestStatus('ok');
        setTestError(null);
      } else {
        setTestStatus('error');
        setTestError({ error, stdout, stderr });
      }
    } catch (err) {
      setTestStatus('error');
      setTestError({ error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  if (loading) {
    return (
      <div className='flex items-center justify-center py-48px'>
        <span className='text-t-secondary'>{t('common.loading', { defaultValue: 'Loading...' })}</span>
      </div>
    );
  }

  return (
    <AionScrollArea className={isPageMode ? 'h-full' : 'max-h-400px'}>
      <div className='px-16px md:px-24px py-16px'>
        {!status?.installed && <div className='mb-16px px-12px py-8px rd-8px bg-orange-1 color-orange-6 text-13px'>{t('settings.openclaw_notInstalled')}</div>}

        <div className='mb-20px p-12px rd-8px bg-t-fill-2'>
          <div className='flex items-center justify-between mb-8px'>
            <span className='text-14px font-600 text-t-primary'>{t('settings.openclaw_testGateway', { defaultValue: 'Sudoclaw 连接测试' })}</span>
            <div className='flex items-center gap-8px'>
              <span className={`text-12px ${testStatus === 'ok' ? 'color-green-6' : testStatus === 'error' ? 'color-red-6' : testStatus === 'testing' ? 'color-blue-6' : 'text-t-tertiary'}`}>
                {testStatus === 'ok' && t('settings.openclaw_testStatusOk', { defaultValue: '连接正常' })}
                {testStatus === 'error' && t('settings.openclaw_testStatusError', { defaultValue: '连接失败' })}
                {testStatus === 'testing' && t('settings.openclaw_testStatusTesting', { defaultValue: '测试中...' })}
                {testStatus === 'idle' && t('settings.openclaw_testStatusIdle', { defaultValue: '未测试' })}
              </span>
              <Button type='outline' size='small' loading={testStatus === 'testing'} onClick={handleTestGateway} disabled={!status?.installed}>
                {t('settings.openclaw_testButton', { defaultValue: '测试连接' })}
              </Button>
            </div>
          </div>
          {testError && (
            <div className='mt-8px p-8px rd-4px bg-red-1 color-red-6 text-12px font-mono overflow-x-auto max-h-120px overflow-y-auto'>
              {testError.error && <div className='font-600 mb-4px'>{testError.error}</div>}
              {testError.stderr && (
                <div className='mb-4px'>
                  <span className='opacity-80'>Stderr:</span>
                  <pre className='mt-2px whitespace-pre-wrap break-words'>{testError.stderr}</pre>
                </div>
              )}
              {testError.stdout && (
                <div>
                  <span className='opacity-80'>Stdout:</span>
                  <pre className='mt-2px whitespace-pre-wrap break-words'>{testError.stdout}</pre>
                </div>
              )}
            </div>
          )}
        </div>

        <Form form={form} layout='vertical'>
          <Form.Item label={t('settings.openclaw_modelsMode')} field='modelsMode'>
            <Select>
              <Select.Option value='merge'>{t('settings.openclaw_modelsModeMerge')}</Select.Option>
              <Select.Option value='replace'>{t('settings.openclaw_modelsModeReplace')}</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label={t('settings.openclaw_primaryModel')} field='primaryModel'>
            <Input placeholder='anthropic/claude-sonnet-4-5' allowClear />
          </Form.Item>
          <div className='text-12px text-t-tertiary mb-16px'>{t('settings.openclaw_modelHint')}</div>

          <div className='flex items-center justify-between mb-8px'>
            <span className='text-14px font-600 text-t-primary'>{t('settings.openclaw_providers')}</span>
            <Button type='text' size='small' icon={<Plus size={14} />} onClick={handleAddProvider}>
              {t('settings.openclaw_addProvider')}
            </Button>
          </div>

          {providers.length === 0 ? (
            <div className='py-24px text-center text-13px text-t-tertiary'>{t('settings.openclaw_addProvider')}</div>
          ) : (
            <Collapse defaultActiveKey={providers.map((_, i) => String(i))}>
              {providers.map((entry, idx) => (
                <Collapse.Item
                  key={idx}
                  header={
                    <div className='flex items-center justify-between w-full pr-8px'>
                      <span className='font-500'>{entry.key || t('settings.openclaw_providerName')}</span>
                      <Popconfirm content={t('settings.openclaw_deleteProviderConfirm')} onOk={() => handleRemoveProvider(idx)}>
                        <Button type='text' size='mini' icon={<Delete size={14} />} className='color-red-5' />
                      </Popconfirm>
                    </div>
                  }
                  name={String(idx)}
                >
                  <div className='flex flex-col gap-12px'>
                    <div>
                      <div className='text-12px text-t-secondary mb-4px'>{t('settings.openclaw_providerName')}</div>
                      <Input placeholder={t('settings.openclaw_providerNamePlaceholder')} value={entry.key} onChange={(v) => handleProviderKeyChange(idx, v)} />
                    </div>
                    <div>
                      <div className='text-12px text-t-secondary mb-4px'>{t('settings.openclaw_baseUrl')}</div>
                      <Input placeholder='https://api.openai.com/v1' value={entry.provider.baseUrl || ''} onChange={(v) => handleProviderChange(idx, 'baseUrl', v)} />
                    </div>
                    <div>
                      <div className='text-12px text-t-secondary mb-4px'>API Key</div>
                      <Input.Password placeholder='sk-...' value={entry.provider.apiKey || ''} onChange={(v) => handleProviderChange(idx, 'apiKey', v)} autoComplete='off' />
                    </div>
                    <div>
                      <div className='text-12px text-t-secondary mb-4px'>{t('settings.openclaw_apiType')}</div>
                      <Select placeholder={t('settings.openclaw_apiType')} value={entry.provider.api || undefined} onChange={(v) => handleProviderChange(idx, 'api', v || '')} allowClear className='w-full'>
                        {API_TYPE_OPTIONS.map((o) => (
                          <Select.Option key={o.value} value={o.value}>
                            {o.label}
                          </Select.Option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <div className='flex items-center justify-between mb-4px'>
                        <span className='text-12px text-t-secondary'>{t('settings.openclaw_providerModels')}</span>
                        <Button type='text' size='mini' icon={<Plus size={12} />} onClick={() => handleAddModel(idx)}>
                          {t('settings.openclaw_addModel')}
                        </Button>
                      </div>
                      {(entry.provider.models || []).map((m, mi) => (
                        <div key={mi} className='flex gap-8px mb-8px'>
                          <Input placeholder='model-id' value={m.id} onChange={(v) => handleModelChange(idx, mi, 'id', v)} className='flex-1' />
                          <Input placeholder={t('settings.modelName')} value={m.name || ''} onChange={(v) => handleModelChange(idx, mi, 'name', v)} className='flex-1' />
                          <Button type='text' size='mini' icon={<Delete size={12} />} onClick={() => handleRemoveModel(idx, mi)} />
                        </div>
                      ))}
                    </div>
                  </div>
                </Collapse.Item>
              ))}
            </Collapse>
          )}

          <div className='mt-16px text-12px text-t-tertiary'>
            {t('settings.openclaw_configPath')}: {status?.configPath || '~/.sudoclaw/openclaw.json'}
          </div>

          <div className='mt-20px flex justify-end'>
            <Button type='primary' loading={saving} onClick={() => void saveConfig()}>
              {t('common.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        </Form>
      </div>
    </AionScrollArea>
  );
};

export default OpenClawModalContent;
