/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Dropdown, Empty, Input, Menu, Message, Spin, Tooltip } from '@arco-design/web-react';
import { IconCheckCircle, IconCloseCircle, IconCopy, IconDelete, IconDown, IconRefresh } from '@arco-design/web-react/icon';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IChannelPairingRequest, IChannelPluginStatus, IChannelUser } from '@/channels/types';
import { acpConversation, channel } from '@/common/ipcBridge';
import { ConfigStorage } from '@/common/storage';
import { CHANNEL_DEFAULT_AGENT_BACKEND, type AcpBackendAll } from '@/types/acpTypes';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import PreferenceRow from './PreferenceRow';

interface TelegramConfigFormProps {
  pluginStatus: IChannelPluginStatus | null;
  onStatusChange: (status: IChannelPluginStatus | null) => void;
  onTokenChange?: (token: string) => void;
}

const TelegramConfigForm: React.FC<TelegramConfigFormProps> = ({ pluginStatus, onStatusChange, onTokenChange }) => {
  const { t } = useTranslation();
  const { isEnterprise } = useAppMode();

  const [telegramToken, setTelegramToken] = useState('');
  const [testLoading, setTestLoading] = useState(false);

  const [pairingLoading, setPairingLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [pendingPairings, setPendingPairings] = useState<IChannelPairingRequest[]>([]);
  const [authorizedUsers, setAuthorizedUsers] = useState<IChannelUser[]>([]);

  // Agent selection (used for Telegram conversations)
  const [availableAgents, setAvailableAgents] = useState<Array<{ backend: AcpBackendAll; name: string; customAgentId?: string; isPreset?: boolean; isExtension?: boolean }>>([]);
  const [selectedAgent, setSelectedAgent] = useState<{ backend: AcpBackendAll; name?: string; customAgentId?: string }>({ backend: CHANNEL_DEFAULT_AGENT_BACKEND });

  // Load pending pairings
  const loadPendingPairings = useCallback(async () => {
    setPairingLoading(true);
    try {
      const result = await channel.getPendingPairings.invoke();
      if (result.success && result.data) {
        setPendingPairings(result.data.filter((p) => p.platformType === 'telegram'));
      }
    } catch (error) {
      console.error('[ChannelSettings] Failed to load pending pairings:', error);
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
        setAuthorizedUsers(result.data.filter((u) => u.platformType === 'telegram'));
      }
    } catch (error) {
      console.error('[ChannelSettings] Failed to load authorized users:', error);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void loadPendingPairings();
    void loadAuthorizedUsers();
  }, [loadPendingPairings, loadAuthorizedUsers]);

  // Refresh when plugin status changes
  useEffect(() => {
    if (pluginStatus?.enabled) {
      void loadPendingPairings();
      void loadAuthorizedUsers();
    } else {
      setPendingPairings([]);
      setAuthorizedUsers([]);
    }
  }, [pluginStatus?.enabled, loadPendingPairings, loadAuthorizedUsers]);

  // Load saved credentials for backfill
  useEffect(() => {
    // Only load if plugin has token configured and no token is currently entered
    if (!pluginStatus?.hasToken || telegramToken) return;

    const loadCredentials = async () => {
      try {
        const result = await channel.getPluginCredentials.invoke({ pluginId: 'telegram_default' });
        if (result.success && result.data?.token) {
          setTelegramToken(result.data.token);
        }
      } catch (error) {
        console.error('[TelegramConfig] Failed to load credentials:', error);
      }
    };

    void loadCredentials();
  }, [pluginStatus, telegramToken]);

  // Load available agents + saved selection
  useEffect(() => {
    const loadAgentsAndSelection = async () => {
      try {
        const [agentsResp, saved] = await Promise.all([acpConversation.getAvailableAgents.invoke(), ConfigStorage.get('assistant.telegram.agent')]);

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
        console.error('[TelegramConfig] Failed to load agents:', error);
      }
    };

    void loadAgentsAndSelection();
  }, []);

  const persistSelectedAgent = async (agent: { backend: AcpBackendAll; customAgentId?: string; name?: string }) => {
    try {
      await ConfigStorage.set('assistant.telegram.agent', agent);
      await channel.syncChannelSettings.invoke({ platform: 'telegram', agent }).catch((err) => console.warn('[TelegramConfig] syncChannelSettings failed:', err));
      Message.success(t('settings.assistant.agentSwitched', 'Agent switched successfully'));
    } catch (error) {
      console.error('[TelegramConfig] Failed to save agent:', error);
      Message.error(t('common.saveFailed', 'Failed to save'));
    }
  };

  // Listen for pairing requests
  useEffect(() => {
    const unsubscribe = channel.pairingRequested.on((request) => {
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
      setAuthorizedUsers((prev) => {
        const exists = prev.some((u) => u.id === user.id);
        if (exists) return prev;
        return [user, ...prev];
      });
      setPendingPairings((prev) => prev.filter((p) => p.platformUserId !== user.platformUserId));
    });
    return () => unsubscribe();
  }, []);

  // Test Telegram connection
  const handleTestConnection = async () => {
    if (!telegramToken.trim()) {
      Message.warning(t('settings.assistant.tokenRequired', 'Please enter a bot token'));
      return;
    }

    setTestLoading(true);

    try {
      const result = await channel.testPlugin.invoke({
        pluginId: 'telegram_default',
        token: telegramToken.trim(),
      });

      if (result.success && result.data?.success) {
        Message.success(t('settings.assistant.connectionSuccess', `Connected! Bot: @${result.data.botUsername || 'unknown'}`));

        // Auto-enable bot after successful test
        await handleAutoEnable();
      } else {
        Message.error(result.data?.error || t('settings.assistant.connectionFailed', 'Connection failed'));
      }
    } catch (error: any) {
      Message.error(error.message || t('settings.assistant.connectionFailed', 'Connection failed'));
    } finally {
      setTestLoading(false);
    }
  };

  // Auto-enable plugin after successful test
  const handleAutoEnable = async () => {
    try {
      const result = await channel.enablePlugin.invoke({
        pluginId: 'telegram_default',
        config: { token: telegramToken.trim() },
      });

      if (result.success) {
        Message.success(t('settings.assistant.pluginEnabled', 'Telegram bot enabled'));
        const statusResult = await channel.getPluginStatus.invoke();
        if (statusResult.success && statusResult.data) {
          const telegramPlugin = statusResult.data.find((p) => p.type === 'telegram');
          onStatusChange(telegramPlugin || null);
        }
      }
    } catch (error: any) {
      console.error('[ChannelSettings] Auto-enable failed:', error);
    }
  };

  // Reset token tested state when token changes
  const handleTokenChange = (value: string) => {
    setTelegramToken(value);
    onTokenChange?.(value);
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
        Message.error(result.msg || t('settings.assistant.approveFailed', 'Failed to approve pairing'));
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

  const agentOptions: Array<{ backend: AcpBackendAll; name: string; customAgentId?: string; isExtension?: boolean }> = availableAgents.length > 0 ? availableAgents : [{ backend: CHANNEL_DEFAULT_AGENT_BACKEND, name: 'Sudo Code' }];

  return (
    <div className='flex flex-col gap-6 -mt-3'>
      <PreferenceRow label={t('settings.assistant.botToken', 'Bot Token')} description={t('settings.assistant.botTokenDesc', 'Open Telegram, find @BotFather and send /newbot to get your Bot Token.')}>
        <div className='flex items-center gap-2'>
          {authorizedUsers.length > 0 ? (
            <Tooltip content={t('settings.assistant.tokenLocked', '请先关闭 Channel 并删除所有已授权用户后，再尝试修改')}>
              <span>
                <Input.Password value={telegramToken} onChange={handleTokenChange} placeholder={authorizedUsers.length > 0 || pluginStatus?.hasToken ? '••••••••••••••••' : '123456:ABC-DEF...'} style={{ width: 240 }} visibilityToggle disabled={authorizedUsers.length > 0} />
              </span>
            </Tooltip>
          ) : (
            <Input.Password value={telegramToken} onChange={handleTokenChange} placeholder={authorizedUsers.length > 0 || pluginStatus?.hasToken ? '••••••••••••••••' : '123456:ABC-DEF...'} style={{ width: 240 }} visibilityToggle disabled={authorizedUsers.length > 0} />
          )}
          {authorizedUsers.length > 0 ? (
            <Tooltip content={t('settings.assistant.tokenLocked', '请先关闭 Channel 并删除所有已授权用户后，再尝试修改')}>
              <span>
                <Button type='outline' loading={testLoading} onClick={handleTestConnection} disabled={authorizedUsers.length > 0}>
                  {t('settings.assistant.testConnection', 'Test')}
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Button type='outline' loading={testLoading} onClick={handleTestConnection} disabled={authorizedUsers.length > 0}>
              {t('settings.assistant.testConnection', 'Test')}
            </Button>
          )}
        </div>
      </PreferenceRow>

      {/* Agent Selection - hidden in enterprise mode (uses Moss remote agent) */}
      {!isEnterprise && (
        <div className='flex flex-col gap-2'>
          <PreferenceRow label={t('settings.lark.agent', 'Agent')} description={t('settings.assistant.agentDescTelegram', 'Used for Telegram conversations')}>
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
              <Button type='secondary' className='min-w-40' icon={<IconDown style={{ fontSize: 14 }} />}>
                {agentOptions[0]?.name || 'Sudo Code'}
              </Button>
            </Dropdown>
          </PreferenceRow>
        </div>
      )}

      {/* Next Steps Guide - show when bot is enabled and no authorized users yet */}
      {pluginStatus?.enabled && pluginStatus?.connected && authorizedUsers.length === 0 && (
        <div className='bg-fill-1 rd-12px p-4 border border-light'>
          <div className='flex items-center justify-between mb-3'>
            <h3 className='text-14px font-500 text-foreground m-0'>{t('settings.assistant.nextSteps', 'Next Steps')}</h3>
          </div>
          <div className='text-14px text-secondary space-y-2'>
            <p className='m-0'>
              <strong>1.</strong> {t('settings.assistant.step1', 'Open Telegram and search for your bot')}
              {pluginStatus.botUsername && (
                <span className='ml-1'>
                  <code className='bg-fill-2 px-1.5 py-0.5 rd-4px'>@{pluginStatus.botUsername}</code>
                </span>
              )}
            </p>
            <p className='m-0'>
              <strong>2.</strong> {t('settings.assistant.step2', 'Send any message or click /start to initiate pairing')}
            </p>
            <p className='m-0'>
              <strong>3.</strong> {t('settings.assistant.step3', 'A pairing request will appear below. Click "Approve" to authorize the user.')}
            </p>
            <p className='m-0'>
              <strong>4.</strong> {t('settings.assistant.step4', 'Once approved, you can start chatting with Gemini through Telegram!')}
            </p>
          </div>
        </div>
      )}

      {/* Pending Pairings - show when bot is enabled and no authorized users yet */}
      {pluginStatus?.enabled && authorizedUsers.length === 0 && (
        <div className='bg-fill-1 rd-12px pt-4 pr-4 pb-4 pl-0'>
          <div className='flex items-center justify-between mb-3'>
            <h3 className='text-14px font-500 text-foreground m-0'>{t('settings.assistant.pendingPairings', 'Pending Pairing Requests')}</h3>
            <Button size='mini' type='text' icon={<IconRefresh style={{ fontSize: 14 }} />} loading={pairingLoading} onClick={loadPendingPairings}>
              {t('common.refresh', 'Refresh')}
            </Button>
          </div>

          {pairingLoading ? (
            <div className='flex justify-center py-6'>
              <Spin />
            </div>
          ) : pendingPairings.length === 0 ? (
            <Empty description={t('settings.assistant.noPendingPairings', 'No pending pairing requests')} />
          ) : (
            <div className='flex flex-col gap-3'>
              {pendingPairings.map((pairing) => (
                <div key={pairing.code} className='flex items-center justify-between bg-fill-2 rd-8px p-3'>
                  <div className='flex-1'>
                    <div className='flex items-center gap-2'>
                      <span className='text-14px font-500 text-foreground'>{pairing.displayName || 'Unknown User'}</span>
                      <Tooltip content={t('settings.assistant.copyCode', 'Copy pairing code')}>
                        <button className='p-1 bg-transparent border-none text-tertiary hover:text-foreground cursor-pointer' onClick={() => copyToClipboard(pairing.code)}>
                          <IconCopy style={{ fontSize: 14 }} />
                        </button>
                      </Tooltip>
                    </div>
                    <div className='text-12px text-tertiary mt-1'>
                      {t('settings.assistant.pairingCode', 'Code')}: <code className='bg-fill-3 px-1 rd-2px'>{pairing.code}</code>
                      <span className='mx-2'>|</span>
                      {t('settings.assistant.expiresIn', 'Expires in')}: {getRemainingTime(pairing.expiresAt)}
                    </div>
                  </div>
                  <div className='flex items-center gap-2'>
                    <Button type='primary' size='small' icon={<IconCheckCircle style={{ fontSize: 14 }} />} onClick={() => handleApprovePairing(pairing.code)}>
                      {t('settings.assistant.approve', 'Approve')}
                    </Button>
                    <Button type='secondary' size='small' status='danger' icon={<IconCloseCircle style={{ fontSize: 14 }} />} onClick={() => handleRejectPairing(pairing.code)}>
                      {t('settings.assistant.reject', 'Reject')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Authorized Users - show when there are authorized users */}
      {authorizedUsers.length > 0 && (
        <div className='bg-fill-1 rd-12px pt-4 pr-4 pb-4 pl-0'>
          <div className='flex items-center justify-between mb-3'>
            <h3 className='text-14px font-500 text-foreground m-0'>{t('settings.assistant.authorizedUsers', 'Authorized Users')}</h3>
            <Button size='mini' type='text' icon={<IconRefresh style={{ fontSize: 14 }} />} loading={usersLoading} onClick={loadAuthorizedUsers}>
              {t('common.refresh', 'Refresh')}
            </Button>
          </div>

          {usersLoading ? (
            <div className='flex justify-center py-6'>
              <Spin />
            </div>
          ) : authorizedUsers.length === 0 ? (
            <Empty description={t('settings.assistant.noAuthorizedUsers', 'No authorized users yet')} />
          ) : (
            <div className='flex flex-col gap-3'>
              {authorizedUsers.map((user) => (
                <div key={user.id} className='flex items-center justify-between bg-fill-2 rd-8px p-3'>
                  <div className='flex-1'>
                    <div className='text-14px font-500 text-foreground'>{user.displayName || 'Unknown User'}</div>
                    <div className='text-12px text-tertiary mt-1'>
                      {t('settings.assistant.platform', 'Platform')}: {user.platformType}
                      <span className='mx-2'>|</span>
                      {t('settings.assistant.authorizedAt', 'Authorized')}: {formatTime(user.authorizedAt)}
                    </div>
                  </div>
                  <Tooltip content={t('settings.assistant.revokeAccess', 'Revoke access')}>
                    <Button type='text' status='danger' size='small' icon={<IconDelete style={{ fontSize: 16 }} />} onClick={() => handleRevokeUser(user.id)} />
                  </Tooltip>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TelegramConfigForm;
