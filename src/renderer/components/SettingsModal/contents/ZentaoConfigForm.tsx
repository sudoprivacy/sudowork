/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IChannelPluginStatus } from '@/channels/types';
import { channel } from '@/common/ipcBridge';
import { Button, Input, Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Preference row component
 */
const PreferenceRow: React.FC<{
  label: string;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
}> = ({ label, description, extra, required, children }) => (
  <div className='flex items-center justify-between gap-24px py-12px'>
    <div className='flex-1'>
      <div className='flex items-center gap-8px'>
        <span className='text-14px text-t-primary'>
          {label}
          {required && <span className='text-red-500 ml-2px'>*</span>}
        </span>
        {extra}
      </div>
      {description && <div className='text-12px text-t-tertiary mt-2px'>{description}</div>}
    </div>
    <div className='flex items-center'>{children}</div>
  </div>
);

/**
 * Section header component
 */
const SectionHeader: React.FC<{ title: string; action?: React.ReactNode }> = ({ title, action }) => (
  <div className='flex items-center justify-between mb-12px'>
    <h3 className='text-14px font-500 text-t-primary m-0'>{title}</h3>
    {action}
  </div>
);

interface ZentaoConfigFormProps {
  pluginStatus: IChannelPluginStatus | null;
  onStatusChange: (status: IChannelPluginStatus | null) => void;
}

const ZentaoConfigForm: React.FC<ZentaoConfigFormProps> = ({ pluginStatus, onStatusChange }) => {
  const { t } = useTranslation();

  const [serverUrl, setServerUrl] = useState('');
  const [zentaoUsername, setZentaoUsername] = useState('');
  const [zentaoPassword, setZentaoPassword] = useState('');

  const [testLoading, setTestLoading] = useState(false);
  const [_credentialsTested, setCredentialsTested] = useState(false);
  const [touched, setTouched] = useState({ serverUrl: false, zentaoUsername: false, zentaoPassword: false });

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
          onStatusChange(zentaoPlugin || null);
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

  return (
    <div className='flex flex-col gap-24px'>
      {/* Server URL */}
      <PreferenceRow label={t('settings.zentao.serverUrl', 'Server URL')} description={t('settings.zentao.serverUrlDesc', 'Zentao server access URL')} required>
        <Input
          value={serverUrl}
          onChange={(value) => {
            setServerUrl(value);
            handleCredentialsChange();
          }}
          onBlur={() => setTouched((prev) => ({ ...prev, serverUrl: true }))}
          placeholder={pluginStatus?.hasToken ? '••••••••••' : 'https://zentao.company.com'}
          style={{ width: 280 }}
          status={touched.serverUrl && !serverUrl.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
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
          placeholder={pluginStatus?.hasToken ? '••••••••••' : 'admin'}
          style={{ width: 280 }}
          status={touched.zentaoUsername && !zentaoUsername.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
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
          placeholder={pluginStatus?.hasToken ? '••••••••••' : '••••••••••'}
          style={{ width: 280 }}
          status={touched.zentaoPassword && !zentaoPassword.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
          visibilityToggle
        />
      </PreferenceRow>

      {/* Test Connection Button */}
      {!pluginStatus?.connected && (
        <div className='flex justify-end'>
          {pluginStatus?.hasToken && !serverUrl.trim() && !zentaoUsername.trim() && !zentaoPassword.trim() ? <span className='text-12px text-t-tertiary mr-12px self-center'>{t('settings.zentao.credentialsSaved', 'Credentials already configured. Enter new values to update.')}</span> : null}
          <Button type='primary' loading={testLoading} onClick={handleTestConnection} disabled={pluginStatus?.hasToken && !serverUrl.trim() && !zentaoUsername.trim() && !zentaoPassword.trim()}>
            {t('settings.zentao.testAndConnect', 'Test & Connect')}
          </Button>
        </div>
      )}

      {/* Connection Status */}
      {pluginStatus?.enabled && (
        <div className={`rd-12px p-16px border ${pluginStatus?.connected ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : pluginStatus?.error ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'}`}>
          <SectionHeader title={t('settings.zentao.connectionStatus', 'Connection Status')} action={<span className={`text-12px px-8px py-2px rd-4px ${pluginStatus?.connected ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : pluginStatus?.error ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'}`}>{pluginStatus?.connected ? t('settings.zentao.statusConnected', 'Connected') : pluginStatus?.error ? t('settings.zentao.statusError', 'Error') : t('settings.zentao.statusConnecting', 'Connecting...')}</span>} />
          {pluginStatus?.error && <div className='text-14px text-red-600 dark:text-red-400 mb-12px'>{pluginStatus.error}</div>}
          {pluginStatus?.connected && <div className='text-14px text-t-secondary'>{t('settings.zentao.connectedDesc', 'Zentao is connected. AI can now read and create bugs.')}</div>}
        </div>
      )}
    </div>
  );
};

export default ZentaoConfigForm;
