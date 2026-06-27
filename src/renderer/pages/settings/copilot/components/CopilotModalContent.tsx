import { Alert, Button, Space, Spin, Tag, Typography } from '@arco-design/web-react';
import { Folder, Robot, User } from '@icon-park/react';
import { IconRefresh } from '@arco-design/web-react/icon';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ISudoclawStatus } from '@/common/ipcBridge';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import StatusCard from '@/renderer/pages/settings/copilot/components/StatusCard';

const { Title, Text } = Typography;

// ==================== 主组件 / Main Component ====================

const CopilotModalContent: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<ISudoclawStatus | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState<{ error?: string; stdout?: string; stderr?: string } | null>(null);

  // Copilot Runtime Loading (for status updates)
  const [runtimeLoading, setRuntimeLoading] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setRuntimeLoading(true);
    try {
      const statusRes = await ipcBridge.sudoclaw.getStatus.invoke();
      if (statusRes?.success && statusRes.data) {
        setStatus(statusRes.data);
      }
    } catch (err) {
      console.error('[CopilotSettings] Load failed:', err);
    } finally {
      setLoading(false);
      setRuntimeLoading(false);
    }
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
              配置 Sudo Code
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
            <Button type='primary' icon={<IconRefresh />} loading={runtimeLoading} onClick={handleRefreshRuntime}>
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
          <StatusCard title='连接状态' value={isConnected ? '已连接' : '未连接'} icon={<Folder theme='outline' size='24' fill={isConnected ? 'var(--success)' : '#999'} />} status={isConnected ? 'success' : 'error'} description={status?.gatewayUrl} />
          <StatusCard title='Agent' value={status?.agentName || '未设置'} icon={<Robot theme='outline' size='24' fill={'var(--foreground)'} />} status='info' description={status?.model} />
          <StatusCard title='工作区' value={status?.workspace ? '已配置' : '未配置'} icon={<Folder theme='outline' size='24' fill={status?.workspace ? 'var(--warning)' : '#999'} />} status={status?.workspace ? 'success' : 'info'} description={status?.workspace} />
          <StatusCard title='会话状态' value={status?.hasActiveSession ? '活动中' : '空闲'} icon={<User theme='outline' size='24' fill={status?.hasActiveSession ? 'var(--success)' : '#999'} />} status={status?.hasActiveSession ? 'success' : 'info'} description={status?.sessionKey || '无活动会话'} />
        </div>
      </div>
    </AionScrollArea>
  );
};

export default CopilotModalContent;
