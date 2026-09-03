/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Space, Spin, Tag } from '@arco-design/web-react';
import { IconRefresh } from '@arco-design/web-react/icon';
import { Bot, Folder, User } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ISudoclawStatus } from '@sudowork/host-bridge/ipcBridge';
import { ipcBridge } from '@/common';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import StatusCard from '@/renderer/pages/settings/copilot/components/StatusCard';
import PageWrapper from '@renderer/components/base/PageWrapper';

export default function CopilotSettings() {
  const { t } = useTranslation();
  const connectionFailedMessage = t('settings.copilotSettings.connectionFailed', '连接失败');
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<ISudoclawStatus | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState<{ error?: string; stdout?: string; stderr?: string } | null>(null);

  // Copilot Runtime Loading (for status updates)
  const [isRuntimeLoading, setIsRuntimeLoading] = useState(false);

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    setIsRuntimeLoading(true);
    try {
      const statusRes = await ipcBridge.sudoclaw.getStatus.invoke();
      if (statusRes?.success && statusRes.data) {
        setStatus(statusRes.data);
      }
    } catch (err) {
      console.error('[CopilotSettings] Load failed:', err);
    } finally {
      setIsLoading(false);
      setIsRuntimeLoading(false);
    }
  }, []);

  const onRefreshRuntime = async () => {
    setIsRuntimeLoading(true);
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
        setTestError({ error: res?.data?.error || connectionFailedMessage });
      }
    } catch (err) {
      setTestStatus('error');
      setTestError({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsRuntimeLoading(false);
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
            setTestError({ error: res?.data?.error || connectionFailedMessage });
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
  }, [connectionFailedMessage, loadConfig]);

  if (isLoading) {
    return (
      <PageWrapper title={t('settings.copilot', 'Copilot')} subtitle={t('settings.copilotSettings.subtitle', '配置 Sudo Code')}>
        <div className='f-center py-12 h-full'>
          <Spin tip={t('common.loading', '加载中...')} />
        </div>
      </PageWrapper>
    );
  }

  const isConnected = status?.isConnected ?? false;
  const actions = (
    <Space>
      {testStatus === 'testing' && (
        <Tag color='blue' size='large' className='rd-full'>
          {t('settings.copilotSettings.testing', '测试中...')}
        </Tag>
      )}
      {testStatus === 'ok' && (
        <Tag color='green' size='large' className='rd-full'>
          {t('settings.copilotSettings.connected', '已连接')}
        </Tag>
      )}
      {testStatus === 'error' && (
        <Tag color='red' size='large' className='rd-full'>
          {t('settings.copilotSettings.disconnected', '未连接')}
        </Tag>
      )}
      <Button type='primary' icon={<IconRefresh />} loading={isRuntimeLoading} onClick={onRefreshRuntime}>
        {t('common.refresh', '刷新')}
      </Button>
    </Space>
  );

  return (
    <PageWrapper title={t('settings.copilot', 'Copilot')} subtitle={t('settings.copilotSettings.subtitle', '配置 Sudo Code')} actions={actions}>
      <AionScrollArea className='h-full'>
        <div className='mt-3'>
          {testStatus === 'error' && (
            <Alert
              type='error'
              className='mb-6'
              content={
                <div>
                  <div className='font-500 mb-1'>{t('settings.copilotSettings.sudoclawConnectionFailed', 'Sudoclaw 连接失败')}</div>
                  <div className='text-13px'>{testError?.error || t('settings.copilotSettings.sudoclawInstallHint', '请确保 Sudoclaw 已安装并运行。')}</div>
                </div>
              }
            />
          )}

          {testStatus === 'ok' && !isConnected && (
            <Alert
              type='warning'
              className='mb-6'
              content={
                <div>
                  <div className='font-500 mb-1'>{t('settings.copilotSettings.statusAbnormal', 'Sudoclaw 状态异常')}</div>
                  <div className='text-13px'>{t('settings.copilotSettings.gatewayRunningNoSession', 'Gateway 运行中但会话未建立，请尝试重启 Gateway。')}</div>
                </div>
              }
            />
          )}

          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6'>
            <StatusCard
              title={t('settings.copilotSettings.connectionStatus', '连接状态')}
              value={isConnected ? t('settings.copilotSettings.connected', '已连接') : t('settings.copilotSettings.disconnected', '未连接')}
              icon={<Folder size={24} className={isConnected ? 'text-success' : 'text-tertiary'} />}
              status={isConnected ? 'success' : 'error'}
              description={status?.gatewayUrl}
            />
            <StatusCard title={t('settings.copilotSettings.agent', 'Agent')} value={status?.agentName || t('settings.copilotSettings.notSet', '未设置')} icon={<Bot size={24} className='text-foreground' />} status='info' description={status?.model} />
            <StatusCard
              title={t('settings.copilotSettings.workspace', '工作区')}
              value={status?.workspace ? t('settings.copilotSettings.configured', '已配置') : t('settings.copilotSettings.notConfigured', '未配置')}
              icon={<Folder size={24} className={status?.workspace ? 'text-warning' : 'text-tertiary'} />}
              status={status?.workspace ? 'success' : 'info'}
              description={status?.workspace}
            />
            <StatusCard
              title={t('settings.copilotSettings.sessionStatus', '会话状态')}
              value={status?.hasActiveSession ? t('settings.copilotSettings.active', '活动中') : t('settings.copilotSettings.idle', '空闲')}
              icon={<User size={24} className={status?.hasActiveSession ? 'text-success' : 'text-tertiary'} />}
              status={status?.hasActiveSession ? 'success' : 'info'}
              description={status?.sessionKey || t('settings.copilotSettings.noActiveSession', '无活动会话')}
            />
          </div>
        </div>
      </AionScrollArea>
    </PageWrapper>
  );
}
