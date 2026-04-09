/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { secret } from '@/common/ipcBridge';
import { Button, Input, Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const NAMESPACE = 'service:jiansheku';

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

const JsbConfigForm: React.FC = () => {
  const { t } = useTranslation();
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadCredentials = useCallback(async () => {
    setLoading(true);
    try {
      const [keyResult, secretResult] = await Promise.all([
        secret.get.invoke({ namespace: NAMESPACE, key: 'app_key' }),
        secret.get.invoke({ namespace: NAMESPACE, key: 'app_secret' }),
      ]);
      if (keyResult.success && keyResult.data) setAppKey(keyResult.data);
      if (secretResult.success && secretResult.data) setAppSecret(secretResult.data);
    } catch (error) {
      console.error('[JsbConfig] Failed to load credentials:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCredentials();
  }, [loadCredentials]);

  const handleSave = async () => {
    if (!appKey.trim()) {
      Message.warning(t('settings.secrets.appKeyRequired', '请输入 App Key'));
      return;
    }
    if (!appSecret.trim()) {
      Message.warning(t('settings.secrets.appSecretRequired', '请输入 App Secret'));
      return;
    }

    setSaving(true);
    try {
      const [keyResult, secretResult] = await Promise.all([
        secret.put.invoke({
          namespace: NAMESPACE,
          key: 'app_key',
          value: appKey.trim(),
          description: '建设库开放平台 App Key',
        }),
        secret.put.invoke({
          namespace: NAMESPACE,
          key: 'app_secret',
          value: appSecret.trim(),
          description: '建设库开放平台 App Secret',
        }),
      ]);

      if (keyResult.success && secretResult.success) {
        Message.success(t('settings.secrets.saveSuccess', '秘钥保存成功'));
      } else {
        Message.error(t('settings.secrets.saveFailed', '秘钥保存失败'));
      }
    } catch (error) {
      console.error('[JsbConfig] Failed to save credentials:', error);
      Message.error(t('settings.secrets.saveFailed', '秘钥保存失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='flex flex-col gap-24px'>
      <div className='bg-fill-1 rd-12px pt-16px pr-16px pb-16px pl-0'>
        <PreferenceRow
          label={t('settings.secrets.appKey', 'App Key')}
          description={t('settings.secrets.appKeyDesc', '建设库开放平台的应用标识')}
          required
        >
          <Input
            value={appKey}
            onChange={setAppKey}
            placeholder={t('settings.secrets.appKeyPlaceholder', '请输入 App Key')}
            style={{ width: 240 }}
            disabled={loading}
          />
        </PreferenceRow>
        <PreferenceRow
          label={t('settings.secrets.appSecret', 'App Secret')}
          description={t('settings.secrets.appSecretDesc', '建设库开放平台的应用密钥')}
          required
        >
          <Input.Password
            value={appSecret}
            onChange={setAppSecret}
            placeholder={t('settings.secrets.appSecretPlaceholder', '请输入 App Secret')}
            style={{ width: 240 }}
            disabled={loading}
          />
        </PreferenceRow>
      </div>
      <div className='flex justify-end'>
        <Button type='primary' loading={saving} disabled={loading} onClick={handleSave}>
          {t('settings.secrets.save', '保存')}
        </Button>
      </div>
    </div>
  );
};

export default JsbConfigForm;
