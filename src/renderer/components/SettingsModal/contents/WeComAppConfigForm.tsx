/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IChannelPluginStatus } from '@/channels/types';
import { acpConversation, channel } from '@/common/ipcBridge';
import { ConfigStorage } from '@/common/storage';
import { openExternalUrl } from '@/renderer/utils/platform';
import GeminiModelSelector from '@/renderer/pages/conversation/gemini/GeminiModelSelector';
import type { GeminiModelSelection } from '@/renderer/pages/conversation/gemini/useGeminiModelSelection';
import type { AcpBackendAll } from '@/types/acpTypes';
import { Button, Dropdown, Input, Menu, Message, Tooltip } from '@arco-design/web-react';
import { Copy, Down } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

const SectionHeader: React.FC<{ title: string; action?: React.ReactNode }> = ({ title, action }) => (
  <div className='flex items-center justify-between mb-12px'>
    <h3 className='text-14px font-500 text-t-primary m-0'>{title}</h3>
    {action}
  </div>
);

interface WeComAppConfigFormProps {
  pluginStatus: IChannelPluginStatus | null;
  modelSelection: GeminiModelSelection;
  onStatusChange: (status: IChannelPluginStatus | null) => void;
  onCredentialsChange?: (credentials: { corpId: string; agentId: string; appSecret: string; encodingAesKey?: string; callbackToken?: string; publicBaseUrl?: string }) => void;
}

const WECOM_APP_DOCS_URL = 'https://developer.work.weixin.qq.com/document/path/90665';
const PLUGIN_ID = 'wecom-app_default';
const CHANNEL_VISIBLE_AGENT_BACKEND: AcpBackendAll = 'openclaw-gateway';

const WeComAppConfigForm: React.FC<WeComAppConfigFormProps> = ({ pluginStatus, modelSelection, onStatusChange, onCredentialsChange }) => {
  const { t } = useTranslation();

  const [corpId, setCorpId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [encodingAesKey, setEncodingAesKey] = useState('');
  const [callbackToken, setCallbackToken] = useState('');
  const [publicBaseUrl, setPublicBaseUrl] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [touched, setTouched] = useState<{ corpId: boolean; agentId: boolean; appSecret: boolean }>({
    corpId: false,
    agentId: false,
    appSecret: false,
  });

  const [availableAgents, setAvailableAgents] = useState<Array<{ backend: AcpBackendAll; name: string; customAgentId?: string; isExtension?: boolean }>>([]);
  const [selectedAgent, setSelectedAgent] = useState<{ backend: AcpBackendAll; name?: string; customAgentId?: string }>({ backend: CHANNEL_VISIBLE_AGENT_BACKEND });

  // Load saved credentials
  useEffect(() => {
    const load = async () => {
      try {
        const result = await channel.getPluginCredentials.invoke({ pluginId: PLUGIN_ID });
        if (result.success && result.data) {
          setCorpId((prev) => prev || (result.data!.corpId as string) || '');
          setAgentId((prev) => prev || (result.data!.agentId as string) || '');
          setAppSecret((prev) => prev || (result.data!.appSecret as string) || '');
          setEncodingAesKey((prev) => prev || (result.data!.encodingAesKey as string) || '');
          setCallbackToken((prev) => prev || (result.data!.callbackToken as string) || '');
          setPublicBaseUrl((prev) => prev || (result.data!.publicBaseUrl as string) || '');
          onCredentialsChange?.({
            corpId: (result.data.corpId as string) || '',
            agentId: (result.data.agentId as string) || '',
            appSecret: (result.data.appSecret as string) || '',
            encodingAesKey: (result.data.encodingAesKey as string) || '',
            callbackToken: (result.data.callbackToken as string) || '',
            publicBaseUrl: (result.data.publicBaseUrl as string) || '',
          });
        }
      } catch (error) {
        console.error('[WeComAppConfig] Failed to load credentials:', error);
      }
    };
    if (pluginStatus) void load();
  }, [pluginStatus]);

  // Agents
  useEffect(() => {
    const loadAgentsAndSelection = async () => {
      try {
        const [agentsResp, saved] = await Promise.all([acpConversation.getAvailableAgents.invoke(), ConfigStorage.get('assistant.wecom-app.agent')]);
        if (agentsResp.success && agentsResp.data) {
          const visible = agentsResp.data.filter((a) => !a.isPreset && a.backend === CHANNEL_VISIBLE_AGENT_BACKEND);
          setAvailableAgents(visible.map((a) => ({ backend: a.backend, name: a.name, customAgentId: a.customAgentId, isExtension: a.isExtension })));
        }
        if (saved && typeof saved === 'object' && 'backend' in saved) {
          setSelectedAgent({
            backend: (saved as any).backend as AcpBackendAll,
            customAgentId: (saved as any).customAgentId,
            name: (saved as any).name,
          });
        }
      } catch (error) {
        console.error('[WeComAppConfig] Failed to load agents:', error);
      }
    };
    void loadAgentsAndSelection();
  }, []);

  const persistAgent = async (agent: { backend: AcpBackendAll; customAgentId?: string; name?: string }) => {
    try {
      await ConfigStorage.set('assistant.wecom-app.agent', agent);
      await channel.syncChannelSettings.invoke({ platform: 'wecom-app', agent }).catch((err) => console.warn('[WeComAppConfig] syncChannelSettings failed:', err));
      Message.success(t('settings.assistant.agentSwitched', 'Agent switched successfully'));
    } catch (error) {
      console.error('[WeComAppConfig] Failed to save agent:', error);
      Message.error(t('common.saveFailed', 'Failed to save'));
    }
  };

  const notifyCredentials = useCallback(() => {
    onCredentialsChange?.({ corpId, agentId, appSecret, encodingAesKey, callbackToken, publicBaseUrl });
  }, [corpId, agentId, appSecret, encodingAesKey, callbackToken, publicBaseUrl, onCredentialsChange]);

  const handleTest = async () => {
    setTouched({ corpId: true, agentId: true, appSecret: true });
    if (!corpId.trim() || !agentId.trim() || !appSecret.trim()) {
      Message.warning(t('settings.wecomApp.credentialsRequired', 'Please enter CorpID, AgentID, and App Secret'));
      return;
    }
    setTestLoading(true);
    try {
      const result = await channel.testPlugin.invoke({
        pluginId: PLUGIN_ID,
        token: '',
        extraConfig: {
          corpId: corpId.trim(),
          agentId: agentId.trim(),
          appSecret: appSecret.trim(),
        },
      });
      if (result.success && result.data?.success) {
        Message.success(t('settings.wecomApp.connectionSuccess', 'Connected to WeCom!'));
        await handleEnable();
      } else {
        Message.error(result.data?.error || t('settings.wecomApp.connectionFailed', 'Connection failed'));
      }
    } catch (error: any) {
      Message.error(error.message || t('settings.wecomApp.connectionFailed', 'Connection failed'));
    } finally {
      setTestLoading(false);
    }
  };

  const handleEnable = async () => {
    try {
      const result = await channel.enablePlugin.invoke({
        pluginId: PLUGIN_ID,
        config: {
          corpId: corpId.trim(),
          agentId: agentId.trim(),
          appSecret: appSecret.trim(),
          encodingAesKey: encodingAesKey.trim(),
          callbackToken: callbackToken.trim(),
          publicBaseUrl: publicBaseUrl.trim(),
        },
      });
      if (result.success) {
        Message.success(t('settings.wecomApp.pluginEnabled', 'WeCom App enabled'));
        const statusResult = await channel.getPluginStatus.invoke();
        if (statusResult.success && statusResult.data) {
          const next = statusResult.data.find((p) => p.type === 'wecom-app');
          onStatusChange(next || null);
        }
      } else {
        Message.error(result.msg || t('settings.wecomApp.enableFailed', 'Failed to enable WeCom App'));
      }
    } catch (error: any) {
      Message.error(error.message || t('settings.wecomApp.enableFailed', 'Failed to enable WeCom App'));
    }
  };

  const callbackUrl = (() => {
    const base = publicBaseUrl.trim().replace(/\/+$/, '');
    if (!base) return '';
    return `${base}/wecom-app/callback/${PLUGIN_ID}`;
  })();

  const copy = (text: string) => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
    Message.success(t('common.copySuccess', 'Copied'));
  };

  const isLocked = pluginStatus?.enabled && pluginStatus?.hasToken;
  const isGeminiAgent = selectedAgent.backend === 'gemini';
  const agentOptions: Array<{ backend: AcpBackendAll; name: string; customAgentId?: string; isExtension?: boolean }> = availableAgents.length > 0 ? availableAgents : [{ backend: CHANNEL_VISIBLE_AGENT_BACKEND, name: 'Sudoclaw' }];

  const DocsLink = () => (
    <a
      className='text-primary hover:underline cursor-pointer text-12px'
      href={WECOM_APP_DOCS_URL}
      onClick={(e) => {
        e.preventDefault();
        openExternalUrl(WECOM_APP_DOCS_URL).catch(console.error);
      }}
    >
      {t('settings.wecomApp.devDocsLink', 'WeCom App Developer Docs')}
    </a>
  );

  return (
    <div className='flex flex-col gap-16px'>
      <PreferenceRow label={t('settings.wecomApp.corpId', 'CorpID')} description={<DocsLink />} required>
        <Input
          value={corpId}
          onChange={(v) => {
            setCorpId(v);
            notifyCredentials();
          }}
          onBlur={() => setTouched((p) => ({ ...p, corpId: true }))}
          placeholder='wwxxxxxxxxxxxxxxxx'
          style={{ width: 260 }}
          status={touched.corpId && !corpId.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
          disabled={isLocked}
        />
      </PreferenceRow>

      <PreferenceRow label={t('settings.wecomApp.agentId', 'AgentID')} description={t('settings.wecomApp.agentIdDesc', 'The ID of your self-built app')} required>
        <Input
          value={agentId}
          onChange={(v) => {
            setAgentId(v);
            notifyCredentials();
          }}
          onBlur={() => setTouched((p) => ({ ...p, agentId: true }))}
          placeholder='1000002'
          style={{ width: 260 }}
          status={touched.agentId && !agentId.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
          disabled={isLocked}
        />
      </PreferenceRow>

      <PreferenceRow label={t('settings.wecomApp.appSecret', 'App Secret')} description={<DocsLink />} required>
        <Input.Password
          value={appSecret}
          onChange={(v) => {
            setAppSecret(v);
            notifyCredentials();
          }}
          onBlur={() => setTouched((p) => ({ ...p, appSecret: true }))}
          placeholder='xxxxxxxxxxxxxxxxxxxxxxx'
          style={{ width: 260 }}
          status={touched.appSecret && !appSecret.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
          visibilityToggle
          disabled={isLocked}
        />
      </PreferenceRow>

      <PreferenceRow label={t('settings.wecomApp.encodingAesKey', 'EncodingAESKey')} description={t('settings.wecomApp.encodingAesKeyDesc', '43 URL-safe base64 chars from the WeCom admin console')}>
        <Input.Password
          value={encodingAesKey}
          onChange={(v) => {
            setEncodingAesKey(v);
            notifyCredentials();
          }}
          placeholder='43 chars URL-safe base64'
          style={{ width: 260 }}
          visibilityToggle
          disabled={isLocked}
        />
      </PreferenceRow>

      <PreferenceRow label={t('settings.wecomApp.callbackToken', 'Callback Token')} description={t('settings.wecomApp.callbackTokenDesc', 'Token used to sign callback requests')}>
        <Input.Password
          value={callbackToken}
          onChange={(v) => {
            setCallbackToken(v);
            notifyCredentials();
          }}
          placeholder='callback token'
          style={{ width: 260 }}
          visibilityToggle
          disabled={isLocked}
        />
      </PreferenceRow>

      <PreferenceRow label={t('settings.wecomApp.publicBaseUrl', 'Public Base URL')} description={t('settings.wecomApp.publicBaseUrlDesc', 'Your reverse-proxy HTTPS host that forwards to this app (e.g. https://wecom.example.com)')}>
        <Input
          value={publicBaseUrl}
          onChange={(v) => {
            setPublicBaseUrl(v);
            notifyCredentials();
          }}
          placeholder='https://wecom.example.com'
          style={{ width: 260 }}
          disabled={isLocked}
        />
      </PreferenceRow>

      {callbackUrl && (
        <PreferenceRow label={t('settings.wecomApp.callbackUrl', 'Callback URL')} description={t('settings.wecomApp.callbackUrlDesc', 'Paste this URL into the WeCom admin console > 接收消息')}>
          <div className='flex items-center gap-8px'>
            <Tooltip content={callbackUrl}>
              <span className='text-12px text-t-secondary truncate max-w-360px'>{callbackUrl}</span>
            </Tooltip>
            <Button size='mini' icon={<Copy theme='outline' size={14} />} onClick={() => copy(callbackUrl)} />
          </div>
        </PreferenceRow>
      )}

      {!isLocked && (
        <div className='flex justify-end'>
          <Button type='primary' loading={testLoading} onClick={handleTest}>
            {t('settings.wecomApp.testAndConnect', 'Test & Connect')}
          </Button>
        </div>
      )}

      <PreferenceRow label={t('settings.wecomApp.agent', 'Agent')} description={t('settings.wecomApp.agentDesc', 'Used for WeCom App conversations')}>
        <Dropdown
          trigger='click'
          position='br'
          droplist={
            <Menu selectedKeys={[selectedAgent.customAgentId ? `${selectedAgent.backend}|${selectedAgent.customAgentId}` : selectedAgent.backend]}>
              {agentOptions.map((a) => {
                const key = a.customAgentId ? `${a.backend}|${a.customAgentId}` : a.backend;
                return (
                  <Menu.Item
                    key={key}
                    onClick={() => {
                      const next = { backend: a.backend, customAgentId: a.customAgentId, name: a.name };
                      setSelectedAgent(next);
                      void persistAgent(next);
                    }}
                  >
                    {a.name}
                  </Menu.Item>
                );
              })}
            </Menu>
          }
        >
          <Button type='secondary' className='min-w-160px flex items-center justify-between gap-8px'>
            <span className='truncate'>{selectedAgent.name || agentOptions[0]?.name || 'Sudoclaw'}</span>
            <Down theme='outline' size={14} />
          </Button>
        </Dropdown>
      </PreferenceRow>

      <PreferenceRow label={t('settings.assistant.defaultModel', 'Model')} description={t('settings.wecomApp.defaultModelDesc', 'Used for Agent conversations')}>
        <GeminiModelSelector selection={isGeminiAgent ? modelSelection : undefined} disabled={!isGeminiAgent} label={!isGeminiAgent ? t('settings.assistant.autoFollowCliModel', 'Auto-follow CLI runtime model') : undefined} variant='settings' />
      </PreferenceRow>

      {pluginStatus?.enabled && (
        <div className={`rd-12px p-16px border ${pluginStatus?.connected ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : pluginStatus?.error ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'}`}>
          <SectionHeader
            title={t('settings.wecomApp.connectionStatus', 'Connection Status')}
            action={<span className={`text-12px px-8px py-2px rd-4px ${pluginStatus?.connected ? 'bg-green-100 text-green-700' : pluginStatus?.error ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{pluginStatus?.connected ? t('settings.wecomApp.statusConnected', 'Connected') : pluginStatus?.error ? t('settings.wecomApp.statusError', 'Error') : t('settings.wecomApp.statusConnecting', 'Connecting...')}</span>}
          />
          {pluginStatus?.error && <div className='text-14px text-red-600 dark:text-red-400 mb-12px'>{pluginStatus.error}</div>}
          {pluginStatus?.connected && (
            <div className='text-14px text-t-secondary space-y-8px'>
              <p className='m-0'>
                <strong>1.</strong> {t('settings.wecomApp.step1', 'Point the WeCom admin console’s 接收消息 URL to the callback URL above')}
              </p>
              <p className='m-0'>
                <strong>2.</strong> {t('settings.wecomApp.step2', 'Chat with the app from WeCom to verify')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WeComAppConfigForm;
