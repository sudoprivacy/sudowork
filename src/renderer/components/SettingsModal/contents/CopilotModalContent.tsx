/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { SudoclawConfig, SudoclawProvider } from '@/common/ipcBridge';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { Alert, Button, Card, Collapse, Form, Input, Message, Modal, Popconfirm, Select, Space, Spin, Tag, Typography } from '@arco-design/web-react';
import { Delete, Edit, Folder, Plus, Refresh, Robot, User, Config } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { iconColors } from '@/renderer/theme/colors';
import { fs } from '@/common/ipcBridge';
import { useSettingsViewMode } from '../settingsViewContext';

const { Title, Text } = Typography;

const DEFAULT_BASE_URL = 'https://hk.sudorouter.ai/v1';

const API_TYPE_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'custom', label: 'Custom' },
];

type ProviderEntry = { key: string; provider: SudoclawProvider };

// ==================== Types ====================

interface SudoclawStatus {
  installed: boolean;
  configPath: string;
  gatewayRunning?: boolean;
  gatewayPort?: number;
  gatewayHost?: string;
  gatewayUrl?: string;
  isConnected?: boolean;
  hasActiveSession?: boolean;
  sessionKey?: string | null;
  workspace?: string;
  agentName?: string;
  model?: string;
  cliPath?: string;
  version?: string;
  error?: string;
}

// ==================== 子组件 / Sub-components ====================

/**
 * 状态卡片 / Status Card
 */
const StatusCard: React.FC<{
  title: string;
  value: string | number;
  icon: React.ReactNode;
  status?: 'success' | 'warning' | 'error' | 'info';
  description?: string;
}> = ({ title, value, icon, status = 'info', description }) => {
  const statusColors = {
    success: { bg: '#52c41a15', text: '#52c41a' },
    warning: { bg: '#faad1415', text: '#faad14' },
    error: { bg: '#ff4d4f15', text: '#ff4d4f' },
    info: { bg: `${iconColors.primary}15`, text: iconColors.primary },
  };

  const colors = statusColors[status];

  return (
    <Card className='rd-12px hover:shadow-md transition-shadow'>
      <div className='flex items-start gap-12px'>
        <div className='w-48px h-48px rounded-12px flex items-center justify-center flex-shrink-0' style={{ backgroundColor: colors.bg }}>
          {icon}
        </div>
        <div className='flex-1 min-w-0'>
          <div className='text-13px text-t-secondary mb-4px'>{title}</div>
          <div className='text-20px font-600 text-t-primary truncate' title={String(value)}>
            {value}
          </div>
          {description && (
            <div className='text-12px text-t-tertiary mt-4px truncate' title={description}>
              {description}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};

// ==================== 主组件 / Main Component ====================

const CopilotModalContent: React.FC = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SudoclawStatus | null>(null);
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState<{ error?: string; stdout?: string; stderr?: string } | null>(null);
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  // Copilot Runtime Loading (for status updates)
  const [runtimeLoading, setRuntimeLoading] = useState(false);

  // 编辑配置弹窗
  const [editConfigVisible, setEditConfigVisible] = useState(false);
  const [configContent, setConfigContent] = useState('');
  const [configLoading, setConfigLoading] = useState(false);
  const [configPath, setConfigPath] = useState('');

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setRuntimeLoading(true);
    try {
      const [configRes, statusRes] = await Promise.all([ipcBridge.sudoclaw.getConfig.invoke(), ipcBridge.sudoclaw.getStatus.invoke()]);
      if (statusRes?.success && statusRes.data) {
        setStatus(statusRes.data);
      }
      if (configRes?.success && configRes.data) {
        const c = configRes.data;
        form.setFieldsValue({
          primaryModel: c.agents?.defaults?.model?.primary || 'sudorouter/gemini-3-flash-preview',
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
          primaryModel: 'sudorouter/gemini-3-flash-preview',
          modelsMode: 'merge',
        });
        setProviders([]);
      }
    } catch (err) {
      console.error('[CopilotSettings] Load failed:', err);
    } finally {
      setLoading(false);
      setRuntimeLoading(false);
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
        models: models?.length ? models : [],
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
            primary: values.primaryModel || 'sudorouter/gemini-3-flash-preview',
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
    setProviders((prev) => {
      const hasSudorouter = prev.some((p) => p.key === 'sudorouter');
      const defaultKey = hasSudorouter ? `provider_${Date.now()}` : 'sudorouter';
      return [
        ...prev,
        {
          key: defaultKey,
          provider: {
            baseUrl: DEFAULT_BASE_URL,
            models: [{ id: 'gemini-3-flash-preview', name: 'gemini-3-flash-preview' }],
          },
        },
      ];
    });
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
        // Refresh status after successful test to update "isConnected"
        void loadConfig();
      } else {
        setTestStatus('error');
        setTestError({ error, stdout, stderr });
      }
    } catch (err) {
      setTestStatus('error');
      setTestError({ error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const handleRefreshRuntime = async () => {
    await loadConfig();
    Message.success('状态已刷新');
  };

  const restartGateway = async () => {
    try {
      if (status?.gatewayRunning) {
        Modal.confirm({
          title: '重启 Sudoclaw Gateway',
          content: '确定要重启 Sudoclaw Gateway 吗？这可能会中断正在进行的对话。',
          okText: '确定',
          cancelText: '取消',
          onOk: async () => {
            const res = await ipcBridge.sudoclaw.restartGateway.invoke();
            if (res?.success) {
              Message.success('重启命令已发送，请稍候...');
              setTimeout(() => {
                void loadConfig();
              }, 5000);
            } else {
              Message.error(res?.msg || '重启失败');
            }
          },
        });
      } else {
        Message.info('Sudoclaw Gateway 未运行，无需重启');
      }
    } catch (error) {
      Message.error('重启失败');
    }
  };

  const openConfigEditor = async () => {
    setConfigLoading(true);
    try {
      const homeDir = await ipcBridge.application.getPath.invoke({ name: 'home' });
      const configFilePath = `${homeDir}/.nexus/.sudoclaw/openclaw.json`;
      setConfigPath(configFilePath);

      const res = await ipcBridge.sudoclaw.getConfig.invoke();
      if (res?.success && res.data) {
        setConfigContent(JSON.stringify(res.data, null, 2));
        setEditConfigVisible(true);
      } else {
        Message.warning('无法读取配置文件内容');
      }
    } catch (error) {
      Message.error('读取配置失败');
    } finally {
      setConfigLoading(false);
    }
  };

  const handleSaveRawConfig = async () => {
    setConfigLoading(true);
    try {
      const parsed = JSON.parse(configContent);
      const res = await ipcBridge.sudoclaw.saveConfig.invoke({ config: parsed });
      if (res?.success) {
        Message.success('配置已保存并应用');
        setEditConfigVisible(false);
        await loadConfig();
      } else {
        Message.error(res?.msg || '保存配置失败');
      }
    } catch (error) {
      Message.error('JSON 格式错误：' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setConfigLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  if (loading) {
    return (
      <div className='flex items-center justify-center py-48px h-full'>
        <Spin tip={t('common.loading', { defaultValue: 'Loading...' })} />
      </div>
    );
  }

  const isConnected = status?.isConnected ?? false;

  return (
    <AionScrollArea className='h-full'>
      <div className='px-16px md:px-24px py-16px'>
        <div className='flex items-center justify-between mb-24px'>
          <div>
            <Title heading={5} className='m-0 text-18px'>
              Copilot
            </Title>
            <Text type='secondary' className='text-13px'>
              配置 SudoClaw
            </Text>
          </div>
          <Space>
            {isConnected && (
              <Tag color='green' size='large'>
                已连接
              </Tag>
            )}
            <Button type='primary' icon={<Refresh />} loading={runtimeLoading} onClick={handleRefreshRuntime}>
              刷新
            </Button>
          </Space>
        </div>

        {!isConnected && (
          <Alert
            type='warning'
            className='mb-24px'
            content={
              <div>
                <div className='font-500 mb-4px'>Sudoclaw 未连接</div>
                <div className='text-13px'>请确保 Sudoclaw 已安装并运行。</div>
              </div>
            }
          />
        )}

        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-16px mb-24px'>
          <StatusCard title='连接状态' value={isConnected ? '已连接' : '未连接'} icon={<Config theme='outline' size='24' fill={isConnected ? iconColors.success : '#999'} />} status={isConnected ? 'success' : 'error'} description={status?.gatewayUrl} />
          <StatusCard title='Agent' value={status?.agentName || '未设置'} icon={<Robot theme='outline' size='24' fill={iconColors.primary} />} status='info' description={status?.model} />
          <StatusCard title='工作区' value={status?.workspace ? '已配置' : '未配置'} icon={<Folder theme='outline' size='24' fill={status?.workspace ? iconColors.warning : '#999'} />} status={status?.workspace ? 'success' : 'info'} description={status?.workspace} />
          <StatusCard title='会话状态' value={status?.hasActiveSession ? '活动中' : '空闲'} icon={<User theme='outline' size='24' fill={status?.hasActiveSession ? iconColors.success : '#999'} />} status={status?.hasActiveSession ? 'success' : 'info'} description={status?.sessionKey || '无活动会话'} />
        </div>

        <div className='mb-24px p-12px rd-8px bg-t-fill-2'>
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
              {testError.stderr && <pre className='mt-2px whitespace-pre-wrap break-words'>{testError.stderr}</pre>}
              {testError.stdout && <pre className='mt-2px whitespace-pre-wrap break-words'>{testError.stdout}</pre>}
            </div>
          )}
        </div>

        <Card title='🚀 模型与供应商配置' className='mb-24px rd-12px'>
          <Form form={form} layout='vertical'>
            <Form.Item label={t('settings.openclaw_modelsMode')} field='modelsMode'>
              <Select>
                <Select.Option value='merge'>{t('settings.openclaw_modelsModeMerge')}</Select.Option>
                <Select.Option value='replace'>{t('settings.openclaw_modelsModeReplace')}</Select.Option>
              </Select>
            </Form.Item>

            <Form.Item label={t('settings.openclaw_primaryModel')} field='primaryModel'>
              <Input placeholder='sudorouter/gemini-3-flash-preview' allowClear />
            </Form.Item>

            <div className='flex items-center justify-between mb-8px'>
              <span className='text-14px font-600 text-t-primary'>{t('settings.openclaw_providers')}</span>
              <Button type='text' size='small' icon={<Plus size={14} />} onClick={handleAddProvider}>
                {t('settings.openclaw_addProvider')}
              </Button>
            </div>

            {providers.length > 0 && (
              <Collapse defaultActiveKey={providers.map((_, i) => String(i))} className='mb-16px'>
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

            <div className='flex justify-end'>
              <Button type='primary' loading={saving} onClick={() => void saveConfig()}>
                {t('common.save', { defaultValue: 'Save' })}
              </Button>
            </div>
          </Form>
        </Card>

        <Card title='📝 配置文件' className='rd-12px'>
          <div className='flex items-center justify-between'>
            <div className='flex-1'>
              <div className='text-14px text-t-primary font-500'>Sudoclaw 配置文件</div>
              <div className='text-12px text-t-tertiary mt-2px'>直接编辑 ~/.nexus/.sudoclaw/openclaw.json</div>
            </div>
            <Space>
              <Button icon={<Edit />} onClick={openConfigEditor} loading={configLoading}>
                编辑配置
              </Button>
              <Button icon={<Refresh />} onClick={restartGateway}>
                重启 Gateway
              </Button>
            </Space>
          </div>
        </Card>
      </div>

      {editConfigVisible && (
        <Modal title='编辑 OpenClaw 配置' visible={editConfigVisible} onOk={handleSaveRawConfig} onCancel={() => setEditConfigVisible(false)} width={800} confirmLoading={configLoading}>
          <div className='flex flex-col gap-8px'>
            <Text type='secondary' className='text-12px'>
              路径：{configPath}
            </Text>
            <Input.TextArea value={configContent} onChange={(value) => setConfigContent(value)} style={{ height: 400, fontFamily: 'monospace', fontSize: 13 }} />
          </div>
        </Modal>
      )}
    </AionScrollArea>
  );
};

export default CopilotModalContent;
