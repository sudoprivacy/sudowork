/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { secret } from '@/common/ipcBridge';
import { Button, Input, Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const NAMESPACE = 'service:zentao';

/**
 * 偏好设置行组件
 */
const PreferenceRow: React.FC<{ label: string; description?: React.ReactNode; required?: boolean; children: React.ReactNode }> = ({ label, description, required, children }) => (
  <div className='flex items-center justify-between gap-24px py-12px'>
    <div className='flex-1'>
      <div className='flex items-center gap-8px'>
        <span className='text-14px text-t-primary'>
          {label}
          {required && <span className='text-red-500 ml-2px'>*</span>}
        </span>
      </div>
      {description && <div className='text-12px text-t-tertiary mt-2px'>{description}</div>}
    </div>
    <div className='flex items-center'>{children}</div>
  </div>
);

const ZentaoSecretForm: React.FC = () => {
  const { t } = useTranslation();
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadCredentials = useCallback(async () => {
    setLoading(true);
    try {
      const [urlResult, userResult, passResult] = await Promise.all([
        secret.get.invoke({ namespace: NAMESPACE, key: 'server_url' }),
        secret.get.invoke({ namespace: NAMESPACE, key: 'username' }),
        secret.get.invoke({ namespace: NAMESPACE, key: 'password' }),
      ]);
      if (urlResult.success && urlResult.data) setServerUrl(urlResult.data);
      if (userResult.success && userResult.data) setUsername(userResult.data);
      if (passResult.success && passResult.data) setPassword(passResult.data);
    } catch (error) {
      console.error('[ZentaoSecretForm] Failed to load credentials:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCredentials();
  }, [loadCredentials]);

  const handleSave = async () => {
    if (!serverUrl.trim()) {
      Message.warning(t('settings.secrets.zentao.serverUrlRequired', '请输入服务器地址'));
      return;
    }
    if (!username.trim()) {
      Message.warning(t('settings.secrets.zentao.usernameRequired', '请输入用户名'));
      return;
    }
    if (!password.trim()) {
      Message.warning(t('settings.secrets.zentao.passwordRequired', '请输入密码'));
      return;
    }

    setSaving(true);
    try {
      const [urlResult, userResult, passResult] = await Promise.all([
        secret.put.invoke({ namespace: NAMESPACE, key: 'server_url', value: serverUrl.trim().replace(/\/+$/, ''), description: 'Zentao server URL' }),
        secret.put.invoke({ namespace: NAMESPACE, key: 'username', value: username.trim(), description: 'Zentao username' }),
        secret.put.invoke({ namespace: NAMESPACE, key: 'password', value: password.trim(), description: 'Zentao password' }),
      ]);

      if (urlResult.success && userResult.success && passResult.success) {
        Message.success(t('settings.secrets.saveSuccess', '秘钥保存成功'));
      } else {
        Message.error(t('settings.secrets.saveFailed', '秘钥保存失败'));
      }
    } catch (error) {
      console.error('[ZentaoSecretForm] Failed to save credentials:', error);
      Message.error(t('settings.secrets.saveFailed', '秘钥保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!serverUrl.trim() || !username.trim() || !password.trim()) {
      Message.warning(t('settings.secrets.zentao.credentialsRequired', '请输入服务器地址、用户名和密码'));
      return;
    }

    setTesting(true);
    try {
      const result = await secret.testZentao.invoke({
        serverUrl: serverUrl.trim().replace(/\/+$/, ''),
        username: username.trim(),
        password: password.trim(),
      });

      if (result.success && result.data?.success) {
        Message.success(t('settings.secrets.zentao.connectionSuccess', '禅道连接成功！'));
      } else {
        Message.error(result.data?.error || t('settings.secrets.zentao.connectionFailed', '连接失败'));
      }
    } catch (error: any) {
      Message.error(error.message || t('settings.secrets.zentao.connectionFailed', '连接失败'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className='flex flex-col gap-24px'>
      <div className='bg-fill-1 rd-12px pt-16px pr-16px pb-16px pl-0'>
        <PreferenceRow label={t('settings.secrets.zentao.serverUrl', '服务器地址')} description={t('settings.secrets.zentao.serverUrlDesc', '禅道服务器的访问地址')} required>
          <Input value={serverUrl} onChange={setServerUrl} placeholder='https://zentao.company.com' style={{ width: 240 }} disabled={loading} />
        </PreferenceRow>
        <PreferenceRow label={t('settings.secrets.zentao.username', '用户名')} description={t('settings.secrets.zentao.usernameDesc', '禅道登录用户名')} required>
          <Input value={username} onChange={setUsername} placeholder='admin' style={{ width: 240 }} disabled={loading} />
        </PreferenceRow>
        <PreferenceRow label={t('settings.secrets.zentao.password', '密码')} description={t('settings.secrets.zentao.passwordDesc', '禅道登录密码')} required>
          <Input.Password value={password} onChange={setPassword} placeholder='••••••••••' style={{ width: 240 }} disabled={loading} visibilityToggle />
        </PreferenceRow>
      </div>
      <div className='flex justify-end gap-8px'>
        <Button loading={testing} disabled={loading || saving} onClick={handleTestConnection}>
          {t('settings.secrets.zentao.testConnection', '测试连接')}
        </Button>
        <Button type='primary' loading={saving} disabled={loading || testing} onClick={handleSave}>
          {t('settings.secrets.save', '保存')}
        </Button>
      </div>
    </div>
  );
};

export default ZentaoSecretForm;
