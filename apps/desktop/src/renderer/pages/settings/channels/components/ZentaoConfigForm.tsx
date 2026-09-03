/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input, Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { channel } from '@sudowork/host-bridge/ipcBridge';
import type { IChannelPluginStatus } from '@sudowork/common/channelTypes';
import type { ChannelConfig } from '../types';
import ChannelItem from './ChannelItem';
import PreferenceRow from './PreferenceRow';

const ZentaoConfigForm: React.FC<{ pluginStatus?: IChannelPluginStatus | null; onStatusChange?: (status: IChannelPluginStatus | null) => void }> = (props) => {
  const { t } = useTranslation();
  const [internalPluginStatus, setInternalPluginStatus] = useState<IChannelPluginStatus | null>(null);
  const pluginStatus = props.pluginStatus !== undefined ? props.pluginStatus : internalPluginStatus;

  const [serverUrl, setServerUrl] = useState('');
  const [zentaoUsername, setZentaoUsername] = useState('');
  const [zentaoPassword, setZentaoPassword] = useState('');

  const [testLoading, setTestLoading] = useState(false);
  const [_credentialsTested, setCredentialsTested] = useState(false);
  const [touched, setTouched] = useState({ serverUrl: false, zentaoUsername: false, zentaoPassword: false });

  // Load plugin status on mount
  const loadPluginStatus = useCallback(async () => {
    try {
      const result = await channel.getPluginStatus.invoke();
      if (result.success && result.data) {
        const zentaoPlugin = result.data.find((p) => p.type === 'zentao');
        setInternalPluginStatus(zentaoPlugin || null);
      }
    } catch (error) {
      console.error('[ZentaoConfig] Failed to load plugin status:', error);
    }
  }, []);

  useEffect(() => {
    void loadPluginStatus();
  }, [loadPluginStatus]);

  // Load saved credentials for backfill
  useEffect(() => {
    if (!pluginStatus?.hasToken || serverUrl || zentaoUsername || zentaoPassword) return;

    const loadCredentials = async () => {
      try {
        const result = await channel.getPluginCredentials.invoke({ pluginId: 'zentao_default' });
        if (result.success && result.data) {
          if (result.data.serverUrl) setServerUrl(result.data.serverUrl);
          if (result.data.zentaoUsername) setZentaoUsername(result.data.zentaoUsername);
          if (result.data.zentaoPassword) setZentaoPassword(result.data.zentaoPassword);
        }
      } catch (error) {
        console.error('[ZentaoConfig] Failed to load credentials:', error);
      }
    };

    void loadCredentials();
  }, [pluginStatus, serverUrl, zentaoUsername, zentaoPassword]);

  // Test Zentao connection
  const handleTestConnection = async () => {
    setTouched({ serverUrl: true, zentaoUsername: true, zentaoPassword: true });

    if (!serverUrl.trim() || !zentaoUsername.trim() || !zentaoPassword.trim()) {
      Message.warning(t('settings.zentao.credentialsRequired', 'Please enter server URL, username and password'));
      return;
    }

    setTestLoading(true);
    setCredentialsTested(false);
    try {
      const result = await channel.testPlugin.invoke({
        pluginId: 'zentao_default',
        token: zentaoUsername.trim(),
        extraConfig: {
          appId: serverUrl.trim(),
          appSecret: zentaoPassword.trim(),
        },
      });

      if (result.success && result.data?.success) {
        setCredentialsTested(true);
        Message.success(t('settings.zentao.connectionSuccess', 'Zentao connected successfully!'));
        await handleAutoEnable();
      } else {
        setCredentialsTested(false);
        Message.error(result.data?.error || t('settings.zentao.connectionFailed', 'Connection failed'));
      }
    } catch (error: any) {
      setCredentialsTested(false);
      Message.error(error.message || t('settings.zentao.connectionFailed', 'Connection failed'));
    } finally {
      setTestLoading(false);
    }
  };

  // Auto-enable plugin after successful test
  const handleAutoEnable = async () => {
    try {
      const result = await channel.enablePlugin.invoke({
        pluginId: 'zentao_default',
        config: {
          serverUrl: serverUrl.trim(),
          zentaoUsername: zentaoUsername.trim(),
          zentaoPassword: zentaoPassword.trim(),
        },
      });

      if (result.success) {
        Message.success(t('settings.zentao.pluginEnabled', 'Zentao enabled'));
        const statusResult = await channel.getPluginStatus.invoke();
        if (statusResult.success && statusResult.data) {
          const zentaoPlugin = statusResult.data.find((p) => p.type === 'zentao');
          const newStatus = zentaoPlugin || null;
          setInternalPluginStatus(newStatus);
          props.onStatusChange?.(newStatus);
        }
      } else {
        console.error('[ZentaoConfig] enablePlugin failed:', result.msg);
        Message.error(result.msg || t('settings.zentao.enableFailed', 'Failed to enable Zentao'));
      }
    } catch (error: any) {
      console.error('[ZentaoConfig] Auto-enable failed:', error);
      Message.error(error.message || t('settings.zentao.enableFailed', 'Failed to enable Zentao'));
    }
  };

  const handleCredentialsChange = () => {
    setCredentialsTested(false);
  };

  const isCredentialsLocked = pluginStatus?.enabled && pluginStatus?.hasToken;

  return (
    <div className='flex flex-col gap-6 -mt-3'>
      {/* Server URL */}
      <PreferenceRow label={t('settings.zentao.serverUrl', 'Server URL')} description={t('settings.zentao.serverUrlDesc', 'Zentao server access URL')} required>
        <Input
          value={serverUrl}
          onChange={(value) => {
            setServerUrl(value);
            handleCredentialsChange();
          }}
          onBlur={() => setTouched((prev) => ({ ...prev, serverUrl: true }))}
          placeholder={isCredentialsLocked ? '••••••••••' : 'https://zentao.company.com'}
          style={{ width: 280 }}
          status={touched.serverUrl && !serverUrl.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
          disabled={isCredentialsLocked}
        />
      </PreferenceRow>

      {/* Username */}
      <PreferenceRow label={t('settings.zentao.username', 'Username')} description={t('settings.zentao.usernameDesc', 'Zentao login username')} required>
        <Input
          value={zentaoUsername}
          onChange={(value) => {
            setZentaoUsername(value);
            handleCredentialsChange();
          }}
          onBlur={() => setTouched((prev) => ({ ...prev, zentaoUsername: true }))}
          placeholder={isCredentialsLocked ? '••••••••••' : 'admin'}
          style={{ width: 280 }}
          status={touched.zentaoUsername && !zentaoUsername.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
          disabled={isCredentialsLocked}
        />
      </PreferenceRow>

      {/* Password */}
      <PreferenceRow label={t('settings.zentao.password', 'Password')} description={t('settings.zentao.passwordDesc', 'Zentao login password')} required>
        <Input.Password
          value={zentaoPassword}
          onChange={(value) => {
            setZentaoPassword(value);
            handleCredentialsChange();
          }}
          onBlur={() => setTouched((prev) => ({ ...prev, zentaoPassword: true }))}
          placeholder={isCredentialsLocked ? '••••••••••' : '••••••••••'}
          style={{ width: 280 }}
          status={touched.zentaoPassword && !zentaoPassword.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
          visibilityToggle
          disabled={isCredentialsLocked}
        />
      </PreferenceRow>

      {/* Test Connection Button - hide when credentials locked */}
      {!isCredentialsLocked && !pluginStatus?.connected && (
        <div className='flex justify-end'>
          {pluginStatus?.hasToken && !serverUrl.trim() && !zentaoUsername.trim() && !zentaoPassword.trim() ? <span className='text-12px text-tertiary mr-3 self-center'>{t('settings.zentao.credentialsSaved', 'Credentials already configured. Enter new values to update.')}</span> : null}
          <Button type='primary' loading={testLoading} onClick={handleTestConnection} disabled={pluginStatus?.hasToken && !serverUrl.trim() && !zentaoUsername.trim() && !zentaoPassword.trim()}>
            {t('settings.zentao.testAndConnect', 'Test & Connect')}
          </Button>
        </div>
      )}

      {/* Connection Status */}
      {pluginStatus?.enabled && (
        <div className={`rd-12px p-4 border ${pluginStatus?.connected ? 'bg-success-soft border-success-line' : pluginStatus?.error ? 'bg-danger-soft border-danger-line' : 'bg-warning-soft border-warning-line'}`}>
          <div className='flex items-center justify-between mb-3'>
            <h3 className='text-14px font-500 text-foreground m-0'>{t('settings.zentao.connectionStatus', 'Connection Status')}</h3>
            <span className={`text-12px px-2 py-0.5 rd-4px ${pluginStatus?.connected ? 'bg-success-soft text-success' : pluginStatus?.error ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'}`}>
              {pluginStatus?.connected ? t('settings.zentao.statusConnected', 'Connected') : pluginStatus?.error ? t('settings.zentao.statusError', 'Error') : t('settings.zentao.statusConnecting', 'Connecting...')}
            </span>
          </div>
          {pluginStatus?.error && <div className='text-14px text-danger mb-3'>{pluginStatus.error}</div>}
          {pluginStatus?.connected && (
            <div className='text-14px text-secondary space-y-2'>
              <p className='m-0 font-500'>{t('settings.assistant.nextSteps', '下一步操作')}:</p>
              <p className='m-0'>{t('settings.zentao.nextStepsText', '可以和 Sudoclaw 对话，直接使用禅道技能进行项目问题的跟踪与处理。')}</p>
            </div>
          )}
          {!pluginStatus?.connected && !pluginStatus?.error && <div className='text-14px text-secondary'>{t('settings.zentao.waitingConnection', '正在建立连接，请稍候...')}</div>}
        </div>
      )}
    </div>
  );
};

export default ZentaoConfigForm;

/**
 * Self-contained Zentao channel item with enable/disable toggle.
 * Manages its own plugin status and toggle logic internally.
 */
export const ZentaoChannelItem: React.FC = () => {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);
  const [pluginStatus, setPluginStatus] = useState<IChannelPluginStatus | null>(null);
  const [enableLoading, setEnableLoading] = useState(false);

  const loadPluginStatus = useCallback(async () => {
    try {
      const result = await channel.getPluginStatus.invoke();
      if (result.success && result.data) {
        const zentaoPlugin = result.data.find((p) => p.type === 'zentao');
        setPluginStatus(zentaoPlugin || null);
      }
    } catch (error) {
      console.error('[ZentaoChannelItem] Failed to load plugin status:', error);
    }
  }, []);

  useEffect(() => {
    void loadPluginStatus();
  }, [loadPluginStatus]);

  const handleToggle = useCallback(
    async (enabled: boolean) => {
      setEnableLoading(true);
      try {
        if (enabled) {
          if (!pluginStatus?.hasToken) {
            Message.warning(t('settings.zentao.credentialsRequired', 'Please configure Zentao credentials first'));
            setEnableLoading(false);
            return;
          }

          const result = await channel.enablePlugin.invoke({
            pluginId: 'zentao_default',
            config: {},
          });

          if (result.success) {
            Message.success(t('settings.zentao.pluginEnabled', 'Zentao enabled'));
            await loadPluginStatus();
          } else {
            Message.error(result.msg || t('settings.zentao.enableFailed', 'Failed to enable Zentao'));
          }
        } else {
          const result = await channel.disablePlugin.invoke({ pluginId: 'zentao_default' });

          if (result.success) {
            Message.success(t('settings.zentao.pluginDisabled', 'Zentao disabled'));
            await loadPluginStatus();
          } else {
            Message.error(result.msg || t('settings.zentao.disableFailed', 'Failed to disable Zentao'));
          }
        }
      } catch (error: any) {
        Message.error(error.message);
      } finally {
        setEnableLoading(false);
      }
    },
    [pluginStatus, loadPluginStatus, t]
  );

  const channelConfig: ChannelConfig = {
    id: 'zentao',
    title: t('settings.channels.zentaoTitle', 'Zentao'),
    description: t('settings.channels.zentaoDesc', 'Connect Zentao project management, AI can read and create bugs'),
    status: 'active',
    enabled: pluginStatus?.enabled || false,
    disabled: enableLoading,
    isConnected: pluginStatus?.connected || false,
    content: <ZentaoConfigForm pluginStatus={pluginStatus} onStatusChange={setPluginStatus} />,
  };

  return <ChannelItem channel={channelConfig} isCollapsed={collapsed} onToggleCollapse={() => setCollapsed((prev) => !prev)} onToggleEnabled={handleToggle} />;
};
