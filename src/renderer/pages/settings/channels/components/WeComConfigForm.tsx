import { Button, Dropdown, Input, Menu, Message, Tooltip } from '@arco-design/web-react';
import { Down } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IChannelPluginStatus } from '@/channels/types';
import { acpConversation, channel } from '@/common/ipcBridge';
import { ConfigStorage } from '@/common/storage';
import { openExternalUrl } from '@/renderer/utils/platform';
import GeminiModelSelector from '@/renderer/pages/settings/channels/components/GeminiModelSelector';
import { CHANNEL_DEFAULT_AGENT_BACKEND, type AcpBackendAll } from '@/types/acpTypes';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import type { GeminiModelSelection } from '../hooks/useGeminiModelSelection';

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
        <span className='text-14px text-foreground'>
          {label}
          {required && <span className='text-red-500 ml-2px'>*</span>}
        </span>
        {extra}
      </div>
      {description && <div className='text-12px text-tertiary mt-2px'>{description}</div>}
    </div>
    <div className='flex items-center'>{children}</div>
  </div>
);

/**
 * Section header component
 */
const SectionHeader: React.FC<{ title: string; action?: React.ReactNode }> = ({ title, action }) => (
  <div className='flex items-center justify-between mb-12px'>
    <h3 className='text-14px font-500 text-foreground m-0'>{title}</h3>
    {action}
  </div>
);

interface WeComConfigFormProps {
  pluginStatus: IChannelPluginStatus | null;
  modelSelection: GeminiModelSelection;
  onStatusChange: (status: IChannelPluginStatus | null) => void;
  onCredentialsChange?: (credentials: { botId: string; secret: string }) => void;
}

const WECOM_DEV_DOCS_URL = 'https://sudowork.sudoprivacy.com/guides/wecom.html';
const WeComConfigForm: React.FC<WeComConfigFormProps> = ({ pluginStatus, modelSelection, onStatusChange, onCredentialsChange }) => {
  const { t } = useTranslation();
  const { isEnterprise } = useAppMode();

  // WeCom credentials
  const [botId, setBotId] = useState('');
  const [secret, setSecret] = useState('');

  const [testLoading, setTestLoading] = useState(false);
  const [_credentialsTested, setCredentialsTested] = useState(false);
  const [touched, setTouched] = useState({ botId: false, secret: false });

  // Agent selection
  const [availableAgents, setAvailableAgents] = useState<Array<{ backend: AcpBackendAll; name: string; customAgentId?: string; isPreset?: boolean }>>([]);
  const [selectedAgent, setSelectedAgent] = useState<{ backend: AcpBackendAll; name?: string; customAgentId?: string }>({ backend: 'gemini' });

  // Load saved credentials for backfill (when hasToken or when disabled but credentials exist)
  useEffect(() => {
    const loadCredentials = async () => {
      try {
        const result = await channel.getPluginCredentials.invoke({ pluginId: 'wecom_default' });
        if (result.success && result.data) {
          const loadedBotId = result.data.botId || '';
          const loadedSecret = result.data.secret || '';

          // Update local state only if empty
          if (!botId && loadedBotId) {
            setBotId(loadedBotId);
          }
          if (!secret && loadedSecret) {
            setSecret(loadedSecret);
          }

          // Always notify parent of loaded credentials (for ref sync)
          if (loadedBotId && loadedSecret) {
            onCredentialsChange?.({ botId: loadedBotId, secret: loadedSecret });
          }
        }
      } catch (error) {
        console.error('[WeComConfig] Failed to load credentials:', error);
      }
    };

    // Always try to load credentials when plugin status changes
    if (pluginStatus) {
      void loadCredentials();
    }
  }, [pluginStatus]);

  // Load available agents + saved selection
  useEffect(() => {
    const loadAgentsAndSelection = async () => {
      try {
        const [agentsResp, saved] = await Promise.all([acpConversation.getAvailableAgents.invoke(), ConfigStorage.get('assistant.wecom.agent')]);

        if (agentsResp.success && agentsResp.data) {
          const visibleAgents = agentsResp.data.filter((a) => !a.isPreset && a.backend === CHANNEL_DEFAULT_AGENT_BACKEND);
          const list = visibleAgents.map((a) => ({ backend: a.backend, name: a.name, customAgentId: a.customAgentId, isPreset: a.isPreset, isExtension: a.isExtension }));
          setAvailableAgents(list);
        }

        if (saved && typeof saved === 'object' && 'backend' in saved && typeof (saved as any).backend === 'string') {
          setSelectedAgent({
            backend: (saved as any).backend as AcpBackendAll,
            customAgentId: (saved as any).customAgentId,
            name: (saved as any).name,
          });
        } else if (typeof saved === 'string') {
          setSelectedAgent({ backend: saved as AcpBackendAll });
        }
      } catch (error) {
        console.error('[WeComConfig] Failed to load agents:', error);
      }
    };

    void loadAgentsAndSelection();
  }, []);

  const persistSelectedAgent = async (agent: { backend: AcpBackendAll; customAgentId?: string; name?: string }) => {
    try {
      await ConfigStorage.set('assistant.wecom.agent', agent);
      await channel.syncChannelSettings.invoke({ platform: 'wecom', agent }).catch((err) => console.warn('[WeComConfig] syncChannelSettings failed:', err));
      Message.success(t('settings.assistant.agentSwitched', 'Agent switched successfully'));
    } catch (error) {
      console.error('[WeComConfig] Failed to save agent:', error);
      Message.error(t('common.saveFailed', 'Failed to save'));
    }
  };

  // Test WeCom connection
  const handleTestConnection = async () => {
    setTouched({ botId: true, secret: true });

    if (!botId.trim() || !secret.trim()) {
      Message.warning(t('settings.wecom.credentialsRequired', 'Please enter Bot ID and Secret'));
      return;
    }

    setTestLoading(true);
    setCredentialsTested(false);
    try {
      const result = await channel.testPlugin.invoke({
        pluginId: 'wecom_default',
        token: '',
        extraConfig: {
          appId: botId.trim(),
          appSecret: secret.trim(),
        },
      });

      if (result.success && result.data?.success) {
        setCredentialsTested(true);
        Message.success(t('settings.wecom.connectionSuccess', 'Connected to WeCom!'));
        await handleAutoEnable();
      } else {
        setCredentialsTested(false);
        Message.error(result.data?.error || t('settings.wecom.connectionFailed', 'Connection failed'));
      }
    } catch (error: any) {
      setCredentialsTested(false);
      Message.error(error.message || t('settings.wecom.connectionFailed', 'Connection failed'));
    } finally {
      setTestLoading(false);
    }
  };

  // Auto-enable plugin after successful test
  const handleAutoEnable = async () => {
    try {
      const result = await channel.enablePlugin.invoke({
        pluginId: 'wecom_default',
        config: {
          botId: botId.trim(),
          secret: secret.trim(),
        },
      });

      if (result.success) {
        Message.success(t('settings.wecom.pluginEnabled', 'WeCom bot enabled'));
        const statusResult = await channel.getPluginStatus.invoke();
        if (statusResult.success && statusResult.data) {
          const wecomPlugin = statusResult.data.find((p) => p.type === 'wecom');
          onStatusChange(wecomPlugin || null);
        }
      } else {
        console.error('[WeComConfig] enablePlugin failed:', result.msg);
        Message.error(result.msg || t('settings.wecom.enableFailed', 'Failed to enable WeCom plugin'));
      }
    } catch (error: any) {
      console.error('[WeComConfig] Auto-enable failed:', error);
      Message.error(error.message || t('settings.wecom.enableFailed', 'Failed to enable WeCom plugin'));
    }
  };

  // Reset credentials tested state when credentials change
  const handleCredentialsChange = () => {
    setCredentialsTested(false);
  };

  // Notify parent of credential changes
  const notifyCredentialsChange = useCallback(
    (newBotId: string, newSecret: string) => {
      onCredentialsChange?.({ botId: newBotId, secret: newSecret });
    },
    [onCredentialsChange]
  );

  // Lock credentials when plugin is enabled and has valid token
  // Unlock when disabled to allow reconfiguration
  const isCredentialsLocked = pluginStatus?.enabled && pluginStatus?.hasToken;
  const isGeminiAgent = selectedAgent.backend === 'gemini';
  const agentOptions: Array<{ backend: AcpBackendAll; name: string; customAgentId?: string; isExtension?: boolean }> = availableAgents.length > 0 ? availableAgents : [{ backend: CHANNEL_DEFAULT_AGENT_BACKEND, name: 'Sudo Code' }];

  return (
    <div className='flex flex-col gap-24px'>
      {/* Bot ID */}
      <PreferenceRow
        label={t('settings.wecom.botId', 'Bot ID')}
        description={
          <span>
            <a
              className='text-primary hover:underline cursor-pointer text-12px'
              href={WECOM_DEV_DOCS_URL}
              onClick={(e) => {
                e.preventDefault();
                openExternalUrl(WECOM_DEV_DOCS_URL).catch(console.error);
              }}
            >
              {t('settings.wecom.devConsoleLink', 'WeCom Developer Docs')}
            </a>{' '}
            {t('settings.wecom.botIdDescSuffix', 'to get your Bot ID')}
          </span>
        }
        required
      >
        {isCredentialsLocked ? (
          <Tooltip content={t('settings.wecom.credentialsLocked', 'Disable the channel to modify credentials')}>
            <span>
              <Input
                value={botId}
                onChange={(value) => {
                  setBotId(value);
                  handleCredentialsChange();
                  notifyCredentialsChange(value, secret);
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, botId: true }))}
                placeholder={isCredentialsLocked ? '••••••••••••••••' : 'botxxxxxxxxxx'}
                style={{ width: 240 }}
                status={touched.botId && !botId.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
                disabled={isCredentialsLocked}
              />
            </span>
          </Tooltip>
        ) : (
          <Input
            value={botId}
            onChange={(value) => {
              setBotId(value);
              handleCredentialsChange();
              notifyCredentialsChange(value, secret);
            }}
            onBlur={() => setTouched((prev) => ({ ...prev, botId: true }))}
            placeholder={isCredentialsLocked ? '••••••••••••••••' : 'botxxxxxxxxxx'}
            style={{ width: 240 }}
            status={touched.botId && !botId.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
            disabled={isCredentialsLocked}
          />
        )}
      </PreferenceRow>

      {/* Secret */}
      <PreferenceRow
        label={t('settings.wecom.secret', 'Secret')}
        description={
          <span>
            <a
              className='text-primary hover:underline cursor-pointer text-12px'
              href={WECOM_DEV_DOCS_URL}
              onClick={(e) => {
                e.preventDefault();
                openExternalUrl(WECOM_DEV_DOCS_URL).catch(console.error);
              }}
            >
              {t('settings.wecom.devConsoleLink', 'WeCom Developer Docs')}
            </a>{' '}
            {t('settings.wecom.secretDescSuffix', 'to get your Secret')}
          </span>
        }
        required
      >
        {isCredentialsLocked ? (
          <Tooltip content={t('settings.wecom.credentialsLocked', 'Disable the channel to modify credentials')}>
            <span>
              <Input.Password
                value={secret}
                onChange={(value) => {
                  setSecret(value);
                  handleCredentialsChange();
                  notifyCredentialsChange(botId, value);
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, secret: true }))}
                placeholder={isCredentialsLocked ? '••••••••••••••••' : 'xxxxxxxxxxxxxxxxxx'}
                style={{ width: 240 }}
                status={touched.secret && !secret.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
                visibilityToggle
                disabled={isCredentialsLocked}
              />
            </span>
          </Tooltip>
        ) : (
          <Input.Password
            value={secret}
            onChange={(value) => {
              setSecret(value);
              handleCredentialsChange();
              notifyCredentialsChange(botId, value);
            }}
            onBlur={() => setTouched((prev) => ({ ...prev, secret: true }))}
            placeholder={isCredentialsLocked ? '••••••••••••••••' : 'xxxxxxxxxxxxxxxxxx'}
            style={{ width: 240 }}
            status={touched.secret && !secret.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
            visibilityToggle
            disabled={isCredentialsLocked}
          />
        )}
      </PreferenceRow>

      {/* Hint: Long connection mode */}
      {!pluginStatus?.connected && (
        <div className='text-12px leading-relaxed p-10px rd-8px bg-[rgba(var(--primary-6),0.08)] border border-[rgba(var(--primary-6),0.3)] text-secondary'>
          <div className='font-500 text-foreground mb-4px'>{t('settings.wecom.longConnHint', 'WebSocket Long Connection Mode')}</div>
          <div>{t('settings.wecom.longConnDesc', 'No public IP required. Enable API mode in WeCom admin console and select "Long Connection".')}</div>
          <div className='mt-4px'>{t('settings.wecom.singleConnNote', 'Note: Each bot allows only one active connection. A new connection will disconnect the previous one.')}</div>
        </div>
      )}

      {/* Test Connection Button - show when not connected and not locked */}
      {!isCredentialsLocked && !pluginStatus?.connected && (
        <div className='flex justify-end'>
          {pluginStatus?.hasToken && !botId.trim() && !secret.trim() ? <span className='text-12px text-tertiary mr-12px self-center'>{t('settings.wecom.credentialsSaved', 'Credentials already configured. Enter new values to update.')}</span> : null}
          <Button type='primary' loading={testLoading} onClick={handleTestConnection} disabled={pluginStatus?.hasToken && !botId.trim() && !secret.trim()}>
            {t('settings.wecom.testAndConnect', 'Test & Connect')}
          </Button>
        </div>
      )}

      {/* Agent Selection - hidden in enterprise mode (uses Moss remote agent) */}
      {!isEnterprise && (
        <div className='flex flex-col gap-8px'>
          <PreferenceRow label={t('settings.wecom.agent', 'Agent')} description={t('settings.wecom.agentDesc', 'Used for WeCom conversations')}>
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
                          const currentKey = selectedAgent.customAgentId ? `${selectedAgent.backend}|${selectedAgent.customAgentId}` : selectedAgent.backend;
                          if (key === currentKey) {
                            return;
                          }
                          const next = { backend: a.backend, customAgentId: a.customAgentId, name: a.name };
                          setSelectedAgent(next);
                          void persistSelectedAgent(next);
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
                <span className='truncate'>{agentOptions[0]?.name || 'Sudo Code'}</span>
                <Down theme='outline' size={14} />
              </Button>
            </Dropdown>
          </PreferenceRow>
        </div>
      )}

      {/* Default Model Selection - hidden in enterprise mode */}
      {!isEnterprise && (
        <PreferenceRow label={t('settings.assistant.defaultModel', 'Model')} description={t('settings.wecom.defaultModelDesc', 'Used for Agent conversations')}>
          <GeminiModelSelector selection={isGeminiAgent ? modelSelection : undefined} disabled={!isGeminiAgent} label={!isGeminiAgent ? t('settings.assistant.autoFollowCliModel', 'Auto-follow CLI runtime model') : undefined} variant='settings' />
        </PreferenceRow>
      )}

      {/* Connection Status - always show when enabled */}
      {pluginStatus?.enabled && (
        <div
          className={`rd-12px p-16px border ${pluginStatus?.connected ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : pluginStatus?.error ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'}`}
        >
          <SectionHeader
            title={t('settings.wecom.connectionStatus', 'Connection Status')}
            action={
              <span
                className={`text-12px px-8px py-2px rd-4px ${pluginStatus?.connected ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : pluginStatus?.error ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'}`}
              >
                {pluginStatus?.connected ? t('settings.wecom.statusConnected', 'Connected') : pluginStatus?.error ? t('settings.wecom.statusError', 'Error') : t('settings.wecom.statusConnecting', 'Connecting...')}
              </span>
            }
          />
          {pluginStatus?.error && <div className='text-14px text-red-600 dark:text-red-400 mb-12px'>{pluginStatus.error}</div>}
          {pluginStatus?.connected && (
            <div className='text-14px text-secondary space-y-8px'>
              <p className='m-0 font-500'>{t('settings.assistant.nextSteps', 'Next Steps')}:</p>
              <p className='m-0'>
                <strong>1.</strong> {t('settings.wecom.step1', 'Open WeCom and find your AI bot')}
              </p>
              <p className='m-0'>
                <strong>2.</strong> {t('settings.wecom.step2Chat', 'You can chat with the AI assistant through WeCom!')}
              </p>
            </div>
          )}
          {!pluginStatus?.connected && !pluginStatus?.error && <div className='text-14px text-secondary'>{t('settings.wecom.waitingConnection', 'Connection is being established. Please wait...')}</div>}
        </div>
      )}
    </div>
  );
};

export default WeComConfigForm;
