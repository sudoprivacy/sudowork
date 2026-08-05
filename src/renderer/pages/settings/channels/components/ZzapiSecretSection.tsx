/**
 * 中资 (zzapi) section of 秘钥管理.
 *
 * Stores the app key / secret in the local Nexus vault under `service:zzapi`.
 * The main process prefetches them from the same namespace and hands them to
 * agent child processes as ZZAPI_APP_KEY / ZZAPI_APP_SECRET
 * (see process/services/zzapi/zzapiCredentials.ts), so the values never need to
 * be typed into a terminal or written to disk in plaintext.
 *
 * "测试并连接" validates against the platform's token endpoint before writing,
 * so a typo can't be stored as a working credential — same order as 禅道's
 * test-then-connect.
 *
 * Consumer-mode only, mirroring ZentaoChannelItem: in enterprise mode the
 * credentials are provisioned centrally through the tenant config section, and
 * the main process reads them from Moss under a per-user namespace instead.
 */

import { Button, Input, Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { secret, zzapiCli } from '@/common/ipcBridge';
import { buildNamespace } from '@/common/nexus/namespace';
import type { ChannelConfig } from '../types';
import ChannelItem from './ChannelItem';
import PreferenceRow from './PreferenceRow';

const NAMESPACE = buildNamespace('zzapi');
const APP_KEY = 'app_key';
const APP_SECRET = 'app_secret';

type ConnectionState = { status: 'idle' | 'testing' | 'connected' | 'error'; error?: string };

const ZzapiConfigForm: React.FC<{ configured: boolean; onSaved: () => void }> = ({ configured, onSaved }) => {
  const { t } = useTranslation();
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [touched, setTouched] = useState({ appKey: false, appSecret: false });
  const [connection, setConnection] = useState<ConnectionState>({ status: 'idle' });

  const testing = connection.status === 'testing';

  const handleTestAndConnect = useCallback(async () => {
    setTouched({ appKey: true, appSecret: true });

    const key = appKey.trim();
    const keySecret = appSecret.trim();
    if (!key || !keySecret) {
      Message.warning(t('zzapi.secrets.needBoth', '请填写 App Key 和 App Secret'));
      return;
    }

    setConnection({ status: 'testing' });
    try {
      const res = await zzapiCli.testCredentials.invoke({ appKey: key, appSecret: keySecret });
      if (!res?.success || !res.data?.ok) {
        const error = res?.data?.error || res?.msg || t('zzapi.secrets.testFailed', '连接失败');
        setConnection({ status: 'error', error });
        Message.error(error);
        return;
      }

      // Only persist after the platform accepted the pair.
      const saved = await Promise.all([secret.put.invoke({ namespace: NAMESPACE, key: APP_KEY, value: key, description: '中资 App Key' }), secret.put.invoke({ namespace: NAMESPACE, key: APP_SECRET, value: keySecret, description: '中资 App Secret' })]);

      if (!saved.every((r) => r?.success)) {
        const error = saved.find((r) => !r?.success)?.msg || t('zzapi.secrets.saveFailed', '保存失败');
        setConnection({ status: 'error', error });
        Message.error(error);
        return;
      }

      // Turn the integration on after a successful test, matching 禅道's
      // test-then-connect: a user who just verified credentials expects them in
      // effect without a second click.
      await zzapiCli.setEnabled.invoke({ enabled: true });

      setConnection({ status: 'connected' });
      Message.success(t('zzapi.secrets.connected', '连接成功，凭证已保存，新会话即可使用'));
      // Drop the plaintext from component state right after saving.
      setAppKey('');
      setAppSecret('');
      onSaved();
    } catch (e) {
      const error = e instanceof Error ? e.message : t('zzapi.secrets.testFailed', '连接失败');
      setConnection({ status: 'error', error });
      Message.error(error);
    }
  }, [appKey, appSecret, onSaved, t]);

  const onCredentialChange = useCallback(() => {
    // Any edit invalidates the previous verdict.
    setConnection((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }));
  }, []);

  const showStatus = connection.status !== 'idle';

  return (
    <div className='flex flex-col gap-6 -mt-3'>
      <PreferenceRow label={t('zzapi.secrets.appKey', 'App Key')} description={t('zzapi.secrets.appKeyDesc', '中资开放平台的 App Key')} required>
        <Input
          value={appKey}
          onChange={(value) => {
            setAppKey(value);
            onCredentialChange();
          }}
          onBlur={() => setTouched((prev) => ({ ...prev, appKey: true }))}
          placeholder={configured ? t('zzapi.secrets.keepExisting', '已保存，留空则不修改') : 'App Key'}
          style={{ width: 280 }}
          status={touched.appKey && !appKey.trim() && !configured ? 'error' : undefined}
          autoComplete='off'
        />
      </PreferenceRow>

      <PreferenceRow label={t('zzapi.secrets.appSecret', 'App Secret')} description={t('zzapi.secrets.appSecretDesc', '中资开放平台的 App Secret')} required>
        <Input.Password
          value={appSecret}
          onChange={(value) => {
            setAppSecret(value);
            onCredentialChange();
          }}
          onBlur={() => setTouched((prev) => ({ ...prev, appSecret: true }))}
          placeholder={configured ? '••••••••••' : 'App Secret'}
          style={{ width: 280 }}
          status={touched.appSecret && !appSecret.trim() && !configured ? 'error' : undefined}
          visibilityToggle
          autoComplete='new-password'
        />
      </PreferenceRow>

      <div className='flex justify-end'>
        <Button type='primary' loading={testing} onClick={handleTestAndConnect}>
          {t('zzapi.secrets.testAndConnect', '测试并连接')}
        </Button>
      </div>

      {showStatus && (
        <div className={`rd-12px p-4 border ${connection.status === 'connected' ? 'bg-success-soft border-success-line' : connection.status === 'error' ? 'bg-danger-soft border-danger-line' : 'bg-warning-soft border-warning-line'}`}>
          <div className='flex items-center justify-between mb-3'>
            <h3 className='text-14px font-500 text-foreground m-0'>{t('zzapi.secrets.connectionStatus', '连接状态')}</h3>
            <span className={`text-12px px-2 py-0.5 rd-4px ${connection.status === 'connected' ? 'bg-success-soft text-success' : connection.status === 'error' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'}`}>
              {connection.status === 'connected' ? t('zzapi.secrets.statusConnected', '已连接') : connection.status === 'error' ? t('zzapi.secrets.statusError', '失败') : t('zzapi.secrets.statusTesting', '连接中...')}
            </span>
          </div>
          {connection.status === 'error' && <div className='text-14px text-danger'>{connection.error}</div>}
          {connection.status === 'testing' && <div className='text-14px text-secondary'>{t('zzapi.secrets.waitingConnection', '正在验证凭证，请稍候...')}</div>}
          {connection.status === 'connected' && (
            <div className='text-14px text-secondary space-y-2'>
              <p className='m-0 font-500'>{t('settings.assistant.nextSteps', '下一步操作')}:</p>
              <p className='m-0'>{t('zzapi.secrets.nextStepsText', '可以直接让 AI 助手查询商品市场参考价、历史价格趋势与供应商名录。')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ZzapiSecretSection: React.FC = () => {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [toggleLoading, setToggleLoading] = useState(false);

  /** Existence check only — reads metadata, never pulls the values into the renderer. */
  const loadStatus = useCallback(async () => {
    try {
      const res = await zzapiCli.getEnabled.invoke();
      if (res?.success && res.data) {
        setConfigured(res.data.hasCredentials);
        setEnabled(res.data.enabled && res.data.hasCredentials);
      }
    } catch {
      /* best-effort — the form still works */
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleToggle = useCallback(
    async (next: boolean) => {
      if (next && !configured) {
        Message.warning(t('zzapi.secrets.credentialsRequired', '请先配置并测试凭证'));
        return;
      }
      setToggleLoading(true);
      try {
        const res = await zzapiCli.setEnabled.invoke({ enabled: next });
        if (res?.success) {
          setEnabled(next);
        } else {
          Message.error(res?.msg || t('zzapi.secrets.toggleFailed', '操作失败'));
        }
      } finally {
        setToggleLoading(false);
      }
    },
    [configured, t]
  );

  const channelConfig: ChannelConfig = {
    id: 'zhongzi',
    title: t('zzapi.secrets.title', '中资'),
    status: 'active',
    // Drives the 已启用/未启用 label. isConnected stays false so the wording
    // matches 禅道 rather than introducing a third 已配置 state.
    enabled,
    disabled: toggleLoading,
    content: <ZzapiConfigForm configured={configured} onSaved={loadStatus} />,
  };

  return <ChannelItem channel={channelConfig} isCollapsed={collapsed} onToggleCollapse={() => setCollapsed((prev) => !prev)} onToggleEnabled={handleToggle} />;
};

export default ZzapiSecretSection;
