/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IChannelPairingRequest, IChannelPluginStatus, IChannelUser } from '@/channels/types';
import { acpConversation, channel } from '@/common/ipcBridge';
import { ConfigStorage } from '@/common/storage';
import { openExternalUrl } from '@/renderer/utils/platform';
import GeminiModelSelector from '@/renderer/pages/conversation/gemini/GeminiModelSelector';
import type { GeminiModelSelection } from '@/renderer/pages/conversation/gemini/useGeminiModelSelection';
import type { AcpBackendAll } from '@/types/acpTypes';
import { Button, Dropdown, Empty, Input, Menu, Message, Spin, Tooltip } from '@arco-design/web-react';
import { CheckOne, CloseOne, Copy, Delete, Down, Refresh } from '@icon-park/react';
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

interface WeComConfigFormProps {
  pluginStatus: IChannelPluginStatus | null;
  modelSelection: GeminiModelSelection;
  onStatusChange: (status: IChannelPluginStatus | null) => void;
}

const WECOM_DEV_DOCS_URL = 'https://developer.work.weixin.qq.com/document/path/101463';

const WeComConfigForm: React.FC<WeComConfigFormProps> = ({ pluginStatus, modelSelection, onStatusChange }) => {
  const { t } = useTranslation();

  // WeCom credentials
  const [botId, setBotId] = useState('');
  const [secret, setSecret] = useState('');

  const [testLoading, setTestLoading] = useState(false);
  const [_credentialsTested, setCredentialsTested] = useState(false);
  const [touched, setTouched] = useState({ botId: false, secret: false });
  const [pairingLoading, setPairingLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [pendingPairings, setPendingPairings] = useState<IChannelPairingRequest[]>([]);
  const [authorizedUsers, setAuthorizedUsers] = useState<IChannelUser[]>([]);

  // Agent selection
  const [availableAgents, setAvailableAgents] = useState<Array<{ backend: AcpBackendAll; name: string; customAgentId?: string; isPreset?: boolean }>>([]);
  const [selectedAgent, setSelectedAgent] = useState<{ backend: AcpBackendAll; name?: string; customAgentId?: string }>({ backend: 'gemini' });

  // Load pending pairings
  const loadPendingPairings = useCallback(async () => {
    setPairingLoading(true);
    try {
      const result = await channel.getPendingPairings.invoke();
      if (result.success && result.data) {
        setPendingPairings(result.data.filter((p) => p.platformType === 'wecom'));
      }
    } catch (error) {
      console.error('[WeComConfig] Failed to load pending pairings:', error);
    } finally {
      setPairingLoading(false);
    }
  }, []);

  // Load authorized users
  const loadAuthorizedUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const result = await channel.getAuthorizedUsers.invoke();
      if (result.success && result.data) {
        setAuthorizedUsers(result.data.filter((u) => u.platformType === 'wecom'));
      }
    } catch (error) {
      console.error('[WeComConfig] Failed to load authorized users:', error);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void loadPendingPairings();
    void loadAuthorizedUsers();
  }, [loadPendingPairings, loadAuthorizedUsers]);

  // Load saved credentials for backfill
  useEffect(() => {
    if (!pluginStatus?.hasToken || botId || secret) return;

    const loadCredentials = async () => {
      try {
        const result = await channel.getPluginCredentials.invoke({ pluginId: 'wecom_default' });
        if (result.success && result.data) {
          if (result.data.botId) setBotId(result.data.botId);
          if (result.data.secret) setSecret(result.data.secret);
        }
      } catch (error) {
        console.error('[WeComConfig] Failed to load credentials:', error);
      }
    };

    void loadCredentials();
  }, [pluginStatus]);

  // Load available agents + saved selection
  useEffect(() => {
    const loadAgentsAndSelection = async () => {
      try {
        const [agentsResp, saved] = await Promise.all([acpConversation.getAvailableAgents.invoke(), ConfigStorage.get('assistant.wecom.agent')]);

        if (agentsResp.success && agentsResp.data) {
          const list = agentsResp.data.filter((a) => !a.isPreset).map((a) => ({ backend: a.backend, name: a.name, customAgentId: a.customAgentId, isPreset: a.isPreset, isExtension: a.isExtension }));
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

  // Listen for pairing requests
  useEffect(() => {
    const unsubscribe = channel.pairingRequested.on((request) => {
      if (request.platformType !== 'wecom') return;
      setPendingPairings((prev) => {
        const exists = prev.some((p) => p.code === request.code);
        if (exists) return prev;
        return [request, ...prev];
      });
    });
    return () => unsubscribe();
  }, []);

  // Listen for user authorization
  useEffect(() => {
    const unsubscribe = channel.userAuthorized.on((user) => {
      if (user.platformType !== 'wecom') return;
      setAuthorizedUsers((prev) => {
        const exists = prev.some((u) => u.id === user.id);
        if (exists) return prev;
        return [user, ...prev];
      });
      setPendingPairings((prev) => prev.filter((p) => p.platformUserId !== user.platformUserId));
    });
    return () => unsubscribe();
  }, []);

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

  // Approve pairing
  const handleApprovePairing = async (code: string) => {
    try {
      const result = await channel.approvePairing.invoke({ code });
      if (result.success) {
        Message.success(t('settings.assistant.pairingApproved', 'Pairing approved'));
        await loadPendingPairings();
        await loadAuthorizedUsers();
      } else {
        // Check if it's "already approved" - show as info instead of error
        const errorMsg = result.msg || t('settings.assistant.approveFailed', 'Failed to approve pairing');
        if (errorMsg.toLowerCase().includes('already')) {
          Message.info(t('settings.assistant.pairingAlreadyApproved', 'Pairing already approved'));
          await loadPendingPairings();
          await loadAuthorizedUsers();
        } else {
          Message.error(errorMsg);
        }
      }
    } catch (error: any) {
      Message.error(error.message);
    }
  };

  // Reject pairing
  const handleRejectPairing = async (code: string) => {
    try {
      const result = await channel.rejectPairing.invoke({ code });
      if (result.success) {
        Message.info(t('settings.assistant.pairingRejected', 'Pairing rejected'));
        await loadPendingPairings();
      } else {
        Message.error(result.msg || t('settings.assistant.rejectFailed', 'Failed to reject pairing'));
      }
    } catch (error: any) {
      Message.error(error.message);
    }
  };

  // Revoke user
  const handleRevokeUser = async (userId: string) => {
    try {
      const result = await channel.revokeUser.invoke({ userId });
      if (result.success) {
        Message.success(t('settings.assistant.userRevoked', 'User access revoked'));
        await loadAuthorizedUsers();
      } else {
        Message.error(result.msg || t('settings.assistant.revokeFailed', 'Failed to revoke user'));
      }
    } catch (error: any) {
      Message.error(error.message);
    }
  };

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    Message.success(t('common.copySuccess', 'Copied'));
  };

  // Format timestamp
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  // Calculate remaining time
  const getRemainingTime = (expiresAt: number) => {
    const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000 / 60));
    return `${remaining} min`;
  };

  const hasExistingUsers = authorizedUsers.length > 0;
  const isGeminiAgent = selectedAgent.backend === 'gemini';
  const agentOptions: Array<{ backend: AcpBackendAll; name: string; customAgentId?: string; isExtension?: boolean }> = availableAgents.length > 0 ? availableAgents : [{ backend: 'gemini', name: 'Gemini CLI' }];

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
        {hasExistingUsers ? (
          <Tooltip content={t('settings.assistant.tokenLocked', 'Please close the Channel and delete all authorized users before modifying')}>
            <span>
              <Input
                value={botId}
                onChange={(value) => {
                  setBotId(value);
                  handleCredentialsChange();
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, botId: true }))}
                placeholder={hasExistingUsers || pluginStatus?.hasToken ? '••••••••••••••••' : 'botxxxxxxxxxx'}
                style={{ width: 240 }}
                status={touched.botId && !botId.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
                disabled={hasExistingUsers}
              />
            </span>
          </Tooltip>
        ) : (
          <Input
            value={botId}
            onChange={(value) => {
              setBotId(value);
              handleCredentialsChange();
            }}
            onBlur={() => setTouched((prev) => ({ ...prev, botId: true }))}
            placeholder={hasExistingUsers || pluginStatus?.hasToken ? '••••••••••••••••' : 'botxxxxxxxxxx'}
            style={{ width: 240 }}
            status={touched.botId && !botId.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
            disabled={hasExistingUsers}
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
        {hasExistingUsers ? (
          <Tooltip content={t('settings.assistant.tokenLocked', 'Please close the Channel and delete all authorized users before modifying')}>
            <span>
              <Input.Password
                value={secret}
                onChange={(value) => {
                  setSecret(value);
                  handleCredentialsChange();
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, secret: true }))}
                placeholder={hasExistingUsers || pluginStatus?.hasToken ? '••••••••••••••••' : 'xxxxxxxxxxxxxxxxxx'}
                style={{ width: 240 }}
                status={touched.secret && !secret.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
                visibilityToggle
                disabled={hasExistingUsers}
              />
            </span>
          </Tooltip>
        ) : (
          <Input.Password
            value={secret}
            onChange={(value) => {
              setSecret(value);
              handleCredentialsChange();
            }}
            onBlur={() => setTouched((prev) => ({ ...prev, secret: true }))}
            placeholder={hasExistingUsers || pluginStatus?.hasToken ? '••••••••••••••••' : 'xxxxxxxxxxxxxxxxxx'}
            style={{ width: 240 }}
            status={touched.secret && !secret.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
            visibilityToggle
            disabled={hasExistingUsers}
          />
        )}
      </PreferenceRow>

      {/* Hint: Long connection mode */}
      {!pluginStatus?.connected && (
        <div className='text-12px leading-relaxed p-10px rd-8px bg-[rgba(var(--primary-6),0.08)] border border-[rgba(var(--primary-6),0.3)] text-t-secondary'>
          <div className='font-500 text-t-primary mb-4px'>{t('settings.wecom.longConnHint', 'WebSocket Long Connection Mode')}</div>
          <div>{t('settings.wecom.longConnDesc', 'No public IP required. Enable API mode in WeCom admin console and select "Long Connection".')}</div>
          <div className='mt-4px'>{t('settings.wecom.singleConnNote', 'Note: Each bot allows only one active connection. A new connection will disconnect the previous one.')}</div>
        </div>
      )}

      {/* Test Connection Button */}
      {!hasExistingUsers && !pluginStatus?.connected && (
        <div className='flex justify-end'>
          {pluginStatus?.hasToken && !botId.trim() && !secret.trim() ? <span className='text-12px text-t-tertiary mr-12px self-center'>{t('settings.wecom.credentialsSaved', 'Credentials already configured. Enter new values to update.')}</span> : null}
          <Button type='primary' loading={testLoading} onClick={handleTestConnection} disabled={pluginStatus?.hasToken && !botId.trim() && !secret.trim()}>
            {t('settings.wecom.testAndConnect', 'Test & Connect')}
          </Button>
        </div>
      )}

      {/* Agent Selection */}
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
              <span className='truncate'>{selectedAgent.name || availableAgents.find((a) => (a.customAgentId ? `${a.backend}|${a.customAgentId}` : a.backend) === (selectedAgent.customAgentId ? `${selectedAgent.backend}|${selectedAgent.customAgentId}` : selectedAgent.backend))?.name || selectedAgent.backend}</span>
              <Down theme='outline' size={14} />
            </Button>
          </Dropdown>
        </PreferenceRow>
      </div>

      {/* Default Model Selection */}
      <PreferenceRow label={t('settings.assistant.defaultModel', 'Model')} description={t('settings.wecom.defaultModelDesc', 'Used for Agent conversations')}>
        <GeminiModelSelector selection={isGeminiAgent ? modelSelection : undefined} disabled={!isGeminiAgent} label={!isGeminiAgent ? t('settings.assistant.autoFollowCliModel', 'Auto-follow CLI runtime model') : undefined} variant='settings' />
      </PreferenceRow>

      {/* Connection Status - always show when enabled */}
      {pluginStatus?.enabled && (
        <div className={`rd-12px p-16px border ${pluginStatus?.connected ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : pluginStatus?.error ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'}`}>
          <SectionHeader title={t('settings.wecom.connectionStatus', 'Connection Status')} action={<span className={`text-12px px-8px py-2px rd-4px ${pluginStatus?.connected ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : pluginStatus?.error ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'}`}>{pluginStatus?.connected ? t('settings.wecom.statusConnected', 'Connected') : pluginStatus?.error ? t('settings.wecom.statusError', 'Error') : t('settings.wecom.statusConnecting', 'Connecting...')}</span>} />
          {pluginStatus?.error && <div className='text-14px text-red-600 dark:text-red-400 mb-12px'>{pluginStatus.error}</div>}
          {pluginStatus?.connected && (
            <div className='text-14px text-t-secondary space-y-8px'>
              <p className='m-0 font-500'>{t('settings.assistant.nextSteps', 'Next Steps')}:</p>
              <p className='m-0'>
                <strong>1.</strong> {t('settings.wecom.step1', 'Open WeCom and find your AI bot')}
              </p>
              <p className='m-0'>
                <strong>2.</strong> {t('settings.wecom.step2Chat', 'You can chat with the AI assistant through WeCom!')}
              </p>
            </div>
          )}
          {!pluginStatus?.connected && !pluginStatus?.error && <div className='text-14px text-t-secondary'>{t('settings.wecom.waitingConnection', 'Connection is being established. Please wait...')}</div>}
        </div>
      )}
    </div>
  );
};

export default WeComConfigForm;
