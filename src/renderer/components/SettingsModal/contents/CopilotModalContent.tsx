/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { SudoclawConfig, SudoclawProvider, ISudoclawStatus } from '@/common/ipcBridge';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { Alert, Button, Card, Collapse, Form, Input, Message, Modal, Popconfirm, Select, Space, Spin, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { Delete, Edit, Folder, Plus, Refresh, Robot, User } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { iconColors } from '@/renderer/theme/colors';
import { fs } from '@/common/ipcBridge';
import { useSettingsViewMode } from '../settingsViewContext';

const { Title, Text } = Typography;

const DEFAULT_BASE_URL = 'https://hk.sudorouter.ai/v1';

const API_TYPE_OPTIONS = [
  { value: 'openai-responses', label: 'OpenAI' },
  { value: 'anthropic-messages', label: 'Anthropic' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'custom', label: 'Custom' },
];

type ProviderEntry = { key: string; provider: SudoclawProvider };

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
            <Tooltip content={description}>
              <div className='text-12px text-t-tertiary mt-4px truncate'>{description}</div>
            </Tooltip>
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
  const [status, setStatus] = useState<ISudoclawStatus | null>(null);
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState<{ error?: string; stdout?: string; stderr?: string } | null>(null);
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  // Copilot Runtime Loading (for status updates)
  const [runtimeLoading, setRuntimeLoading] = useState(false);

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
        // Prompt user to restart Gateway
        Modal.confirm({
          title: '配置已保存',
          content: '配置已保存成功。需要重启 Gateway 才能生效，是否立即重启？',
          okText: '重启 Gateway',
          cancelText: '稍后重启',
          onOk: async () => {
            const restartRes = await ipcBridge.sudoclaw.restartGateway.invoke();
            if (restartRes?.success) {
              Message.success('Gateway 重启中...');
              setTimeout(() => {
                void loadConfig();
              }, 3000);
            } else {
              Message.error(restartRes?.msg || '重启失败');
            }
          },
        });
      } else {
        Message.error(res?.msg || t('common.saveFailed', { defaultValue: 'Save failed' }));
      }
    } catch (err) {
      Message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [buildPatchFromForm, t, loadConfig]);

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

  const handleRefreshRuntime = async () => {
    setRuntimeLoading(true);
    setTestStatus('testing');
    setTestError(null);
    try {
      await loadConfig();
      // Test connection after refreshing status
      const res = await ipcBridge.sudoclaw.testGateway.invoke();
      if (res?.success && res.data?.success) {
        setTestStatus('ok');
        setTestError(null);
      } else {
        setTestStatus('error');
        setTestError({ error: res?.data?.error || 'Connection failed' });
      }
    } catch (err) {
      setTestStatus('error');
      setTestError({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setRuntimeLoading(false);
    }
  };

  const restartGateway = async () => {
    try {
      const isRunning = testStatus === 'ok';
      Modal.confirm({
        title: isRunning ? '重启 Sudoclaw Gateway' : '启动 Sudoclaw Gateway',
        content: isRunning ? '确定要重启 Sudoclaw Gateway 吗？这可能会中断正在进行的对话。' : 'Sudoclaw Gateway 未运行，是否立即启动？',
        okText: '确定',
        cancelText: '取消',
        onOk: async () => {
          const res = await ipcBridge.sudoclaw.restartGateway.invoke();
          if (res?.success) {
            Message.success(isRunning ? 'Gateway 重启中...' : 'Gateway 启动中...');
            // Refresh status and test connection after restart
            setTestStatus('testing');
            setTimeout(async () => {
              await loadConfig();
              try {
                const testRes = await ipcBridge.sudoclaw.testGateway.invoke();
                if (testRes?.success && testRes.data?.success) {
                  setTestStatus('ok');
                  setTestError(null);
                } else {
                  setTestStatus('error');
                  setTestError({ error: testRes?.data?.error || 'Connection failed' });
                }
              } catch (err) {
                setTestStatus('error');
                setTestError({ error: err instanceof Error ? err.message : String(err) });
              }
            }, 3000);
          } else {
            Message.error(res?.msg || '重启失败');
          }
        },
      });
    } catch (error) {
      Message.error('重启失败');
    }
  };

  useEffect(() => {
    // Initial load with connection test
    setTestStatus('testing');
    void loadConfig()
      .then(async () => {
        try {
          const res = await ipcBridge.sudoclaw.testGateway.invoke();
          if (res?.success && res.data?.success) {
            setTestStatus('ok');
          } else {
            setTestStatus('error');
            setTestError({ error: res?.data?.error || 'Connection failed' });
          }
        } catch (err) {
          setTestStatus('error');
          setTestError({ error: err instanceof Error ? err.message : String(err) });
        }
      })
      .catch((err) => {
        console.error('Failed to load config:', err);
        setTestStatus('error');
        setTestError({ error: err instanceof Error ? err.message : String(err) });
      });
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
            {testStatus === 'testing' && (
              <Tag color='blue' size='large'>
                测试中...
              </Tag>
            )}
            {testStatus === 'ok' && (
              <Tag color='green' size='large'>
                已连接
              </Tag>
            )}
            {testStatus === 'error' && (
              <Tag color='red' size='large'>
                未连接
              </Tag>
            )}
            <Button type='primary' icon={<Refresh />} loading={runtimeLoading} onClick={handleRefreshRuntime}>
              刷新
            </Button>
          </Space>
        </div>

        {testStatus === 'error' && (
          <Alert
            type='error'
            className='mb-24px'
            content={
              <div>
                <div className='font-500 mb-4px'>Sudoclaw 连接失败</div>
                <div className='text-13px'>{testError?.error || '请确保 Sudoclaw 已安装并运行。'}</div>
              </div>
            }
          />
        )}

        {testStatus === 'ok' && !isConnected && (
          <Alert
            type='warning'
            className='mb-24px'
            content={
              <div>
                <div className='font-500 mb-4px'>Sudoclaw 状态异常</div>
                <div className='text-13px'>Gateway 运行中但会话未建立，请尝试重启 Gateway。</div>
              </div>
            }
          />
        )}

        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-16px mb-24px'>
          <StatusCard title='连接状态' value={isConnected ? '已连接' : '未连接'} icon={<Folder theme='outline' size='24' fill={isConnected ? iconColors.success : '#999'} />} status={isConnected ? 'success' : 'error'} description={status?.gatewayUrl} />
          <StatusCard title='Agent' value={status?.agentName || '未设置'} icon={<Robot theme='outline' size='24' fill={iconColors.primary} />} status='info' description={status?.model} />
          <StatusCard title='工作区' value={status?.workspace ? '已配置' : '未配置'} icon={<Folder theme='outline' size='24' fill={status?.workspace ? iconColors.warning : '#999'} />} status={status?.workspace ? 'success' : 'info'} description={status?.workspace} />
          <StatusCard title='会话状态' value={status?.hasActiveSession ? '活动中' : '空闲'} icon={<User theme='outline' size='24' fill={status?.hasActiveSession ? iconColors.success : '#999'} />} status={status?.hasActiveSession ? 'success' : 'info'} description={status?.sessionKey || '无活动会话'} />
        </div>
      </div>
    </AionScrollArea>
  );
};

export default CopilotModalContent;
