/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IChannelPairingRequest, IChannelPluginStatus, IChannelUser, IPluginCredentials } from '@/channels/types';
import { acpConversation, channel } from '@/common/ipcBridge';
import { ConfigStorage } from '@/common/storage';
import { openExternalUrl } from '@/renderer/utils/platform';
import GeminiModelSelector from '@/renderer/pages/conversation/gemini/GeminiModelSelector';
import type { GeminiModelSelection } from '@/renderer/pages/conversation/gemini/useGeminiModelSelection';
import type { AcpBackendAll } from '@/types/acpTypes';
import { Button, Dropdown, Empty, Input, Menu, Message, Modal, Spin, Tooltip } from '@arco-design/web-react';
import { CheckOne, CloseOne, Copy, Delete, Down, Refresh, ScanCode } from '@icon-park/react';
import { QRCodeSVG } from 'qrcode.react';
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

interface LarkConfigFormProps {
  pluginStatus: IChannelPluginStatus | null;
  modelSelection: GeminiModelSelection;
  onStatusChange: (status: IChannelPluginStatus | null) => void;
}

const LARK_DEV_DOCS_URL = 'https://sudoclaw.sudoprivacy.com/guides/feishu.html';
const CHANNEL_VISIBLE_AGENT_BACKEND: AcpBackendAll = 'openclaw-gateway';

const LarkConfigForm: React.FC<LarkConfigFormProps> = ({ pluginStatus, modelSelection, onStatusChange }) => {
  const { t } = useTranslation();

  // Lark credentials
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [encryptKey, setEncryptKey] = useState('');
  const [verificationToken, setVerificationToken] = useState('');

  const [showOptional, setShowOptional] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [credentialsTested, setCredentialsTested] = useState(false);
  const [touched, setTouched] = useState({ appId: false, appSecret: false });
  const [pairingLoading, setPairingLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [pendingPairings, setPendingPairings] = useState<IChannelPairingRequest[]>([]);
  const [authorizedUsers, setAuthorizedUsers] = useState<IChannelUser[]>([]);

  // Agent selection (used for Lark conversations)
  const [availableAgents, setAvailableAgents] = useState<Array<{ backend: AcpBackendAll; name: string; customAgentId?: string; isPreset?: boolean }>>([]);
  const [selectedAgent, setSelectedAgent] = useState<{ backend: AcpBackendAll; name?: string; customAgentId?: string }>({ backend: 'gemini' });

  // lark-cli QR login (device flow)
  type LarkCliPhase = 'idle' | 'initializing' | 'qrcode' | 'success' | 'error' | 'expired';
  const [larkCliPhase, setLarkCliPhase] = useState<LarkCliPhase>('idle');
  const [larkCliModalOpen, setLarkCliModalOpen] = useState(false);
  const [larkCliVerificationUrl, setLarkCliVerificationUrl] = useState('');
  const [larkCliUserCode, setLarkCliUserCode] = useState('');
  const [larkCliExpiresAt, setLarkCliExpiresAt] = useState<number>(0);
  const [larkCliError, setLarkCliError] = useState('');
  const [larkCliLoggedInUser, setLarkCliLoggedInUser] = useState<string | undefined>(undefined);
  const [larkCliLoggedInAt, setLarkCliLoggedInAt] = useState<number | undefined>(undefined);
  const [larkCliInstalled, setLarkCliInstalled] = useState(true);
  const [larkCliBinPath, setLarkCliBinPath] = useState('');

  // Load pending pairings
  const loadPendingPairings = useCallback(async () => {
    setPairingLoading(true);
    try {
      const result = await channel.getPendingPairings.invoke();
      if (result.success && result.data) {
        // Filter for Lark platform only
        setPendingPairings(result.data.filter((p) => p.platformType === 'lark'));
      }
    } catch (error) {
      console.error('[LarkConfig] Failed to load pending pairings:', error);
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
        // Filter for Lark platform only
        setAuthorizedUsers(result.data.filter((u) => u.platformType === 'lark'));
      }
    } catch (error) {
      console.error('[LarkConfig] Failed to load authorized users:', error);
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
    // Only load if plugin has credentials configured and no values are currently entered
    if (!pluginStatus?.hasToken || appId || appSecret) return;

    const loadCredentials = async () => {
      try {
        const result = await channel.getPluginCredentials.invoke({ pluginId: 'lark_default' });
        if (result.success && result.data) {
          if (result.data.appId) setAppId(result.data.appId);
          if (result.data.appSecret) setAppSecret(result.data.appSecret);
          if (result.data.encryptKey) setEncryptKey(result.data.encryptKey);
          if (result.data.verificationToken) setVerificationToken(result.data.verificationToken);
        }
      } catch (error) {
        console.error('[LarkConfig] Failed to load credentials:', error);
      }
    };

    void loadCredentials();
  }, [pluginStatus]);

  // Load available agents + saved selection
  useEffect(() => {
    const loadAgentsAndSelection = async () => {
      try {
        const [agentsResp, saved] = await Promise.all([acpConversation.getAvailableAgents.invoke(), ConfigStorage.get('assistant.lark.agent')]);

        if (agentsResp.success && agentsResp.data) {
          const visibleAgents = agentsResp.data.filter((a) => !a.isPreset && a.backend === CHANNEL_VISIBLE_AGENT_BACKEND);
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
        console.error('[LarkConfig] Failed to load agents:', error);
      }
    };

    void loadAgentsAndSelection();
  }, []);

  const persistSelectedAgent = async (agent: { backend: AcpBackendAll; customAgentId?: string; name?: string }) => {
    try {
      await ConfigStorage.set('assistant.lark.agent', agent);
      await channel.syncChannelSettings.invoke({ platform: 'lark', agent }).catch((err) => console.warn('[LarkConfig] syncChannelSettings failed:', err));
      Message.success(t('settings.assistant.agentSwitched', 'Agent switched successfully'));
    } catch (error) {
      console.error('[LarkConfig] Failed to save agent:', error);
      Message.error(t('common.saveFailed', 'Failed to save'));
    }
  };

  // Load lark-cli install/login status on mount
  useEffect(() => {
    let cancelled = false;
    const loadLarkCliStatus = async () => {
      try {
        const result = await channel.larkCliStatus.invoke();
        if (cancelled || !result.success || !result.data) return;
        setLarkCliInstalled(result.data.installed);
        setLarkCliBinPath(result.data.binPath);
        if (result.data.loggedIn && result.data.user?.name) {
          setLarkCliLoggedInUser(result.data.user.name);
        }
      } catch (error) {
        console.warn('[LarkConfig] Failed to load lark-cli status:', error);
      }
    };
    void loadLarkCliStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reflect any persisted lark-cli login info from saved credentials
  useEffect(() => {
    if (!pluginStatus?.hasToken) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await channel.getPluginCredentials.invoke({ pluginId: 'lark_default' });
        if (cancelled || !result.success || !result.data) return;
        const creds = result.data as { larkCliUserName?: string; larkCliLoggedInAt?: number };
        if (creds.larkCliUserName) {
          setLarkCliLoggedInUser(creds.larkCliUserName);
          setLarkCliLoggedInAt(creds.larkCliLoggedInAt);
        }
      } catch (error) {
        console.warn('[LarkConfig] Failed to load lark-cli credentials:', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pluginStatus?.hasToken]);

  // Persist lark-cli token into plugin credentials (alongside appId/appSecret).
  const persistLarkCliLogin = useCallback(
    async (payload: { user?: { id?: string; name?: string }; token?: { accessToken: string; refreshToken?: string; expiresAt?: number } }) => {
      const config: Record<string, unknown> = {
        appId: appId.trim(),
        appSecret: appSecret.trim(),
        encryptKey: encryptKey.trim() || undefined,
        verificationToken: verificationToken.trim() || undefined,
        larkCliAccessToken: payload.token?.accessToken,
        larkCliRefreshToken: payload.token?.refreshToken,
        larkCliExpiresAt: payload.token?.expiresAt,
        larkCliUserId: payload.user?.id,
        larkCliUserName: payload.user?.name,
        larkCliLoggedInAt: Date.now(),
      };
      try {
        const result = await channel.enablePlugin.invoke({ pluginId: 'lark_default', config });
        if (!result.success) {
          console.error('[LarkConfig] persistLarkCliLogin enablePlugin failed:', result.msg);
          Message.error(result.msg || 'Failed to persist lark-cli login');
          return;
        }
        const statusResult = await channel.getPluginStatus.invoke();
        if (statusResult.success && statusResult.data) {
          const larkPlugin = statusResult.data.find((p) => p.type === 'lark');
          onStatusChange(larkPlugin || null);
        }
      } catch (error: any) {
        console.error('[LarkConfig] persistLarkCliLogin error:', error);
        Message.error(error?.message || 'Failed to persist lark-cli login');
      }
    },
    [appId, appSecret, encryptKey, verificationToken, onStatusChange]
  );

  // Listen for lark-cli QR login events
  useEffect(() => {
    const unsubscribe = channel.larkCliLogin.on((event) => {
      if (event.phase === 'initializing') {
        setLarkCliPhase('initializing');
        setLarkCliError('');
      } else if (event.phase === 'qrcode') {
        setLarkCliPhase('qrcode');
        if (event.verificationUrl) setLarkCliVerificationUrl(event.verificationUrl);
        if (event.userCode) setLarkCliUserCode(event.userCode);
        if (event.expiresAt) setLarkCliExpiresAt(event.expiresAt);
      } else if (event.phase === 'success') {
        setLarkCliPhase('success');
        setLarkCliLoggedInUser(event.user?.name);
        setLarkCliLoggedInAt(Date.now());
        Message.success(t('settings.lark.larkCli.loginSuccess', '扫码登录成功'));
        void persistLarkCliLogin({ user: event.user, token: event.token });
        setTimeout(() => setLarkCliModalOpen(false), 1200);
      } else if (event.phase === 'expired') {
        setLarkCliPhase('expired');
        setLarkCliError(event.message || t('settings.lark.larkCli.expired', '验证码已过期，请重试'));
      } else if (event.phase === 'error') {
        setLarkCliPhase('error');
        setLarkCliError(event.message || t('settings.lark.larkCli.error', '登录失败'));
      }
    });
    return () => unsubscribe();
  }, [t, persistLarkCliLogin]);

  const handleStartLarkCliLogin = useCallback(async () => {
    if (!appId.trim() || !appSecret.trim()) {
      Message.warning(t('settings.lark.credentialsRequired', 'Please enter App ID and App Secret'));
      setTouched({ appId: true, appSecret: true });
      return;
    }
    if (!larkCliInstalled) {
      Message.error(t('settings.lark.larkCli.notInstalled', 'lark-cli 未安装') + (larkCliBinPath ? ` (${larkCliBinPath})` : ''));
      return;
    }
    setLarkCliModalOpen(true);
    setLarkCliPhase('initializing');
    setLarkCliError('');
    setLarkCliVerificationUrl('');
    setLarkCliUserCode('');
    try {
      const result = await channel.larkCliStart.invoke({ appId: appId.trim(), appSecret: appSecret.trim(), brand: 'feishu' });
      if (!result.success) {
        setLarkCliPhase('error');
        setLarkCliError(result.msg || t('settings.lark.larkCli.error', '登录失败'));
      }
    } catch (error: any) {
      setLarkCliPhase('error');
      setLarkCliError(error?.message || String(error));
    }
  }, [appId, appSecret, larkCliInstalled, larkCliBinPath, t]);

  const handleCloseLarkCliModal = useCallback(() => {
    setLarkCliModalOpen(false);
    void channel.larkCliCancel.invoke().catch(() => {});
    if (larkCliPhase !== 'success') setLarkCliPhase('idle');
  }, [larkCliPhase]);

  const handleLarkCliLogout = useCallback(async () => {
    try {
      const result = await channel.larkCliLogout.invoke();
      if (!result.success) {
        Message.error(result.msg || t('settings.lark.larkCli.logoutFailed', '登出失败'));
        return;
      }
      setLarkCliLoggedInUser(undefined);
      setLarkCliLoggedInAt(undefined);
      // Clear stored token fields without disturbing the rest of the credentials.
      try {
        const cur = await channel.getPluginCredentials.invoke({ pluginId: 'lark_default' });
        if (cur.success && cur.data) {
          const cleared: IPluginCredentials = { ...cur.data };
          delete cleared.larkCliAccessToken;
          delete cleared.larkCliRefreshToken;
          delete cleared.larkCliExpiresAt;
          delete cleared.larkCliUserId;
          delete cleared.larkCliUserName;
          delete cleared.larkCliLoggedInAt;
          await channel.enablePlugin.invoke({ pluginId: 'lark_default', config: cleared as Record<string, unknown> });
        }
      } catch (err) {
        console.warn('[LarkConfig] clear lark-cli credentials failed:', err);
      }
      Message.success(t('settings.lark.larkCli.loggedOut', '已登出'));
    } catch (error: any) {
      Message.error(error?.message || t('settings.lark.larkCli.logoutFailed', '登出失败'));
    }
  }, [t]);

  // Cancel any in-flight lark-cli login on unmount
  useEffect(() => {
    return () => {
      void channel.larkCliCancel.invoke().catch(() => {});
    };
  }, []);

  // Listen for pairing requests
  useEffect(() => {
    const unsubscribe = channel.pairingRequested.on((request) => {
      if (request.platformType !== 'lark') return;
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
      if (user.platformType !== 'lark') return;
      setAuthorizedUsers((prev) => {
        const exists = prev.some((u) => u.id === user.id);
        if (exists) return prev;
        return [user, ...prev];
      });
      setPendingPairings((prev) => prev.filter((p) => p.platformUserId !== user.platformUserId));
    });
    return () => unsubscribe();
  }, []);

  // Test Lark connection
  const handleTestConnection = async () => {
    // Mark fields as touched to show validation errors
    setTouched({ appId: true, appSecret: true });

    if (!appId.trim() || !appSecret.trim()) {
      Message.warning(t('settings.lark.credentialsRequired', 'Please enter App ID and App Secret'));
      return;
    }

    setTestLoading(true);
    setCredentialsTested(false);
    try {
      const result = await channel.testPlugin.invoke({
        pluginId: 'lark_default',
        token: '', // Not used for Lark
        extraConfig: {
          appId: appId.trim(),
          appSecret: appSecret.trim(),
        },
      });

      if (result.success && result.data?.success) {
        setCredentialsTested(true);
        Message.success(t('settings.lark.connectionSuccess', 'Connected to Lark API!'));

        // Auto-enable bot after successful test
        await handleAutoEnable();
      } else {
        setCredentialsTested(false);
        Message.error(result.data?.error || t('settings.lark.connectionFailed', 'Connection failed'));
      }
    } catch (error: any) {
      setCredentialsTested(false);
      Message.error(error.message || t('settings.lark.connectionFailed', 'Connection failed'));
    } finally {
      setTestLoading(false);
    }
  };

  // Auto-enable plugin after successful test
  const handleAutoEnable = async () => {
    try {
      const result = await channel.enablePlugin.invoke({
        pluginId: 'lark_default',
        config: {
          appId: appId.trim(),
          appSecret: appSecret.trim(),
          encryptKey: encryptKey.trim() || undefined,
          verificationToken: verificationToken.trim() || undefined,
        },
      });

      if (result.success) {
        Message.success(t('settings.lark.pluginEnabled', 'Lark bot enabled'));
        const statusResult = await channel.getPluginStatus.invoke();
        if (statusResult.success && statusResult.data) {
          const larkPlugin = statusResult.data.find((p) => p.type === 'lark');
          onStatusChange(larkPlugin || null);
        }
      } else {
        // Show error to user when enable fails
        console.error('[LarkConfig] enablePlugin failed:', result.msg);
        Message.error(result.msg || t('settings.lark.enableFailed', 'Failed to enable Lark plugin'));
      }
    } catch (error: any) {
      console.error('[LarkConfig] Auto-enable failed:', error);
      Message.error(error.message || t('settings.lark.enableFailed', 'Failed to enable Lark plugin'));
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

  const hasExistingUsers = authorizedUsers.length > 0;
  const isGeminiAgent = selectedAgent.backend === 'gemini';
  const agentOptions: Array<{ backend: AcpBackendAll; name: string; customAgentId?: string; isExtension?: boolean }> = availableAgents.length > 0 ? availableAgents : [{ backend: CHANNEL_VISIBLE_AGENT_BACKEND, name: 'Sudoclaw' }];

  return (
    <div className='flex flex-col gap-24px'>
      {/* App ID */}
      <PreferenceRow
        label={t('settings.lark.appId', 'App ID')}
        description={
          <span>
            <a
              className='text-primary hover:underline cursor-pointer text-12px'
              href={LARK_DEV_DOCS_URL}
              onClick={(e) => {
                e.preventDefault();
                openExternalUrl(LARK_DEV_DOCS_URL).catch(console.error);
              }}
            >
              {t('settings.lark.devConsoleLink', 'Feishu Developer Console')}
            </a>{' '}
            {t('settings.lark.appIdDescSuffix', 'to get your App ID')}
          </span>
        }
        required
      >
        {hasExistingUsers ? (
          <Tooltip content={t('settings.assistant.tokenLocked', '请先关闭 Channel 并删除所有已授权用户后，再尝试修改')}>
            <span>
              <Input
                value={appId}
                onChange={(value) => {
                  setAppId(value);
                  handleCredentialsChange();
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, appId: true }))}
                placeholder={hasExistingUsers || pluginStatus?.hasToken ? '••••••••••••••••' : 'cli_xxxxxxxxxx'}
                style={{ width: 240 }}
                status={touched.appId && !appId.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
                disabled={hasExistingUsers}
              />
            </span>
          </Tooltip>
        ) : (
          <Input
            value={appId}
            onChange={(value) => {
              setAppId(value);
              handleCredentialsChange();
            }}
            onBlur={() => setTouched((prev) => ({ ...prev, appId: true }))}
            placeholder={hasExistingUsers || pluginStatus?.hasToken ? '••••••••••••••••' : 'cli_xxxxxxxxxx'}
            style={{ width: 240 }}
            status={touched.appId && !appId.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
            disabled={hasExistingUsers}
          />
        )}
      </PreferenceRow>

      {/* App Secret */}
      <PreferenceRow
        label={t('settings.lark.appSecret', 'App Secret')}
        description={
          <span>
            <a
              className='text-primary hover:underline cursor-pointer text-12px'
              href={LARK_DEV_DOCS_URL}
              onClick={(e) => {
                e.preventDefault();
                openExternalUrl(LARK_DEV_DOCS_URL).catch(console.error);
              }}
            >
              {t('settings.lark.devConsoleLink', 'Feishu Developer Console')}
            </a>{' '}
            {t('settings.lark.appSecretDescSuffix', 'to get App Secret')}
          </span>
        }
        required
      >
        {hasExistingUsers ? (
          <Tooltip content={t('settings.assistant.tokenLocked', '请先关闭 Channel 并删除所有已授权用户后，再尝试修改')}>
            <span>
              <Input.Password
                value={appSecret}
                onChange={(value) => {
                  setAppSecret(value);
                  handleCredentialsChange();
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, appSecret: true }))}
                placeholder={hasExistingUsers || pluginStatus?.hasToken ? '••••••••••••••••' : 'xxxxxxxxxxxxxxxxxx'}
                style={{ width: 240 }}
                status={touched.appSecret && !appSecret.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
                visibilityToggle
                disabled={hasExistingUsers}
              />
            </span>
          </Tooltip>
        ) : (
          <Input.Password
            value={appSecret}
            onChange={(value) => {
              setAppSecret(value);
              handleCredentialsChange();
            }}
            onBlur={() => setTouched((prev) => ({ ...prev, appSecret: true }))}
            placeholder={hasExistingUsers || pluginStatus?.hasToken ? '••••••••••••••••' : 'xxxxxxxxxxxxxxxxxx'}
            style={{ width: 240 }}
            status={touched.appSecret && !appSecret.trim() && !pluginStatus?.hasToken ? 'error' : undefined}
            visibilityToggle
            disabled={hasExistingUsers}
          />
        )}
      </PreferenceRow>

      {/* Optional fields toggle */}
      <div className='flex items-center gap-4px text-12px text-t-tertiary cursor-pointer select-none' onClick={() => setShowOptional((prev) => !prev)}>
        <Down theme='outline' size={12} style={{ transform: showOptional ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
        <span>{showOptional ? t('settings.lark.hideOptionalFields', 'Hide optional settings') : t('settings.lark.showOptionalFields', 'Show optional settings')}</span>
      </div>

      {showOptional && (
        <>
          {/* Encrypt Key (Optional) */}
          <PreferenceRow label={t('settings.lark.encryptKey', 'Encrypt Key')} description={t('settings.lark.encryptKeyDesc', 'Optional: For event encryption (from Event Subscription settings)')}>
            {hasExistingUsers ? (
              <Tooltip content={t('settings.assistant.tokenLocked', '请先关闭 Channel 并删除所有已授权用户后，再尝试修改')}>
                <span>
                  <Input.Password
                    value={encryptKey}
                    onChange={(value) => {
                      setEncryptKey(value);
                      handleCredentialsChange();
                    }}
                    placeholder={t('settings.lark.optional', 'Optional')}
                    style={{ width: 240 }}
                    visibilityToggle
                    disabled={hasExistingUsers}
                  />
                </span>
              </Tooltip>
            ) : (
              <Input.Password
                value={encryptKey}
                onChange={(value) => {
                  setEncryptKey(value);
                  handleCredentialsChange();
                }}
                placeholder={t('settings.lark.optional', 'Optional')}
                style={{ width: 240 }}
                visibilityToggle
                disabled={hasExistingUsers}
              />
            )}
          </PreferenceRow>

          {/* Verification Token (Optional) */}
          <PreferenceRow label={t('settings.lark.verificationToken', 'Verification Token')} description={t('settings.lark.verificationTokenDesc', 'Optional: For event verification (from Event Subscription settings)')}>
            {hasExistingUsers ? (
              <Tooltip content={t('settings.assistant.tokenLocked', '请先关闭 Channel 并删除所有已授权用户后，再尝试修改')}>
                <span>
                  <Input.Password
                    value={verificationToken}
                    onChange={(value) => {
                      setVerificationToken(value);
                      handleCredentialsChange();
                    }}
                    placeholder={t('settings.lark.optional', 'Optional')}
                    style={{ width: 240 }}
                    visibilityToggle
                    disabled={hasExistingUsers}
                  />
                </span>
              </Tooltip>
            ) : (
              <Input.Password
                value={verificationToken}
                onChange={(value) => {
                  setVerificationToken(value);
                  handleCredentialsChange();
                }}
                placeholder={t('settings.lark.optional', 'Optional')}
                style={{ width: 240 }}
                visibilityToggle
                disabled={hasExistingUsers}
              />
            )}
          </PreferenceRow>
        </>
      )}

      {/* Test Connection Button - only show when not connected or no existing users */}
      {!hasExistingUsers && !pluginStatus?.connected && (
        <div className='flex justify-end'>
          {pluginStatus?.hasToken && !appId.trim() && !appSecret.trim() ? (
            // Credentials already saved but not entered in UI - show info message
            <span className='text-12px text-t-tertiary mr-12px self-center'>{t('settings.lark.credentialsSaved', 'Credentials already configured. Enter new values to update.')}</span>
          ) : null}
          <Button type='primary' loading={testLoading} onClick={handleTestConnection} disabled={pluginStatus?.hasToken && !appId.trim() && !appSecret.trim()}>
            {t('settings.lark.testAndConnect', 'Test & Connect')}
          </Button>
        </div>
      )}

      {/* lark-cli QR Login (device flow) */}
      <div className='flex flex-col gap-8px pt-12px border-t border-fill-3'>
        <SectionHeader title={t('settings.lark.larkCli.title', '扫码登录 (lark-cli)')} />
        <div className='text-12px text-t-tertiary'>{t('settings.lark.larkCli.description', '通过 lark-cli 的飞书设备授权流程登录，获取用户访问令牌；前置条件：已安装 lark-cli 并填写上方 App ID / App Secret。')}</div>
        {!larkCliInstalled && (
          <div className='text-12px text-orange-600 dark:text-orange-400'>
            {t('settings.lark.larkCli.notInstalledHint', '未在')} <code className='bg-fill-3 px-4px rd-2px'>{larkCliBinPath || '~/.nexus/bin/lark-cli'}</code>{' '}
            {t('settings.lark.larkCli.notInstalledHintTail', '找到 lark-cli，请先安装：')}{' '}
            <code className='bg-fill-3 px-4px rd-2px'>npx skills add larksuite/cli -g -y</code>
          </div>
        )}
        {larkCliLoggedInUser ? (
          <div className='flex items-center justify-between bg-fill-1 rd-8px p-12px'>
            <div className='flex items-center gap-8px'>
              <div className='w-8px h-8px rd-50% bg-green-500' />
              <span className='text-13px text-t-primary'>
                {t('settings.lark.larkCli.loggedInAs', '已登录')}: <strong>{larkCliLoggedInUser}</strong>
              </span>
              {larkCliLoggedInAt && <span className='text-12px text-t-tertiary'>{new Date(larkCliLoggedInAt).toLocaleString()}</span>}
            </div>
            <div className='flex items-center gap-8px'>
              <Button size='small' icon={<ScanCode size={14} />} onClick={handleStartLarkCliLogin} disabled={!larkCliInstalled}>
                {t('settings.lark.larkCli.relogin', '重新登录')}
              </Button>
              <Button size='small' status='danger' onClick={handleLarkCliLogout} disabled={!larkCliInstalled}>
                {t('settings.lark.larkCli.logout', '登出')}
              </Button>
            </div>
          </div>
        ) : (
          <div className='flex justify-end'>
            <Button type='primary' icon={<ScanCode size={14} />} onClick={handleStartLarkCliLogin} disabled={!larkCliInstalled}>
              {t('settings.lark.larkCli.scanLogin', '扫码登录')}
            </Button>
          </div>
        )}
      </div>

      {/* lark-cli QR Login Modal */}
      <Modal
        title={t('settings.lark.larkCli.modalTitle', '扫码登录飞书 (lark-cli)')}
        visible={larkCliModalOpen}
        onCancel={handleCloseLarkCliModal}
        footer={
          <div className='flex justify-end gap-8px'>
            {(larkCliPhase === 'error' || larkCliPhase === 'expired') && (
              <Button type='primary' onClick={handleStartLarkCliLogin}>
                {t('common.retry', '重试')}
              </Button>
            )}
            <Button onClick={handleCloseLarkCliModal}>{larkCliPhase === 'success' ? t('common.close', '关闭') : t('common.cancel', '取消')}</Button>
          </div>
        }
        maskClosable={false}
        style={{ width: 480 }}
      >
        <div className='flex flex-col items-center gap-16px py-12px'>
          {larkCliPhase === 'initializing' && (
            <div className='flex flex-col items-center gap-8px py-32px'>
              <Spin size={32} />
              <span className='text-12px text-t-tertiary'>{t('settings.lark.larkCli.initializing', '正在初始化 lark-cli…')}</span>
            </div>
          )}
          {larkCliPhase === 'qrcode' && larkCliVerificationUrl && (
            <>
              <div className='bg-white rd-8px p-12px'>
                <QRCodeSVG value={larkCliVerificationUrl} size={200} level='M' />
              </div>
              <div className='flex flex-col items-center gap-4px'>
                <div className='text-12px text-t-tertiary'>{t('settings.lark.larkCli.verificationCode', '验证码')}</div>
                <div className='text-20px font-600 tracking-widest font-mono text-t-primary'>{larkCliUserCode}</div>
              </div>
              <div className='text-12px text-t-tertiary text-center'>
                {t('settings.lark.larkCli.scanHint', '使用飞书扫一扫，或在浏览器打开：')}
                <br />
                <button
                  className='text-primary hover:underline cursor-pointer bg-transparent border-none p-0 text-12px break-all'
                  onClick={() => openExternalUrl(larkCliVerificationUrl).catch(console.error)}
                >
                  {larkCliVerificationUrl}
                </button>
              </div>
              {larkCliExpiresAt > 0 && (
                <div className='text-11px text-t-tertiary'>
                  {t('settings.lark.larkCli.expiresIn', '剩余有效期')}: {Math.max(0, Math.ceil((larkCliExpiresAt - Date.now()) / 60000))} {t('settings.lark.larkCli.minutes', '分钟')}
                </div>
              )}
            </>
          )}
          {larkCliPhase === 'success' && (
            <div className='flex flex-col items-center gap-8px py-32px'>
              <CheckOne size={48} theme='filled' fill='#22c55e' />
              <span className='text-14px text-t-primary'>
                {t('settings.lark.larkCli.loginSuccess', '扫码登录成功')}
                {larkCliLoggedInUser ? ` — ${larkCliLoggedInUser}` : ''}
              </span>
            </div>
          )}
          {(larkCliPhase === 'error' || larkCliPhase === 'expired') && (
            <div className='flex flex-col items-center gap-8px py-24px'>
              <CloseOne size={32} theme='filled' fill='#ef4444' />
              <span className='text-13px text-red-600 dark:text-red-400 text-center px-12px break-words'>{larkCliError}</span>
            </div>
          )}
        </div>
      </Modal>

      {/* Agent Selection */}
      <div className='flex flex-col gap-8px'>
        <PreferenceRow label={t('settings.lark.agent', 'Agent')} description={t('settings.lark.agentDesc', 'Used for Lark conversations')}>
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
              <span className='truncate'>{agentOptions[0]?.name || 'Sudoclaw'}</span>
              <Down theme='outline' size={14} />
            </Button>
          </Dropdown>
        </PreferenceRow>
      </div>

      {/* Default Model Selection */}
      <PreferenceRow label={t('settings.assistant.defaultModel', '对话模型')} description={t('settings.lark.defaultModelDesc', '用于Agent对话时调用')}>
        <GeminiModelSelector selection={isGeminiAgent ? modelSelection : undefined} disabled={!isGeminiAgent} label={!isGeminiAgent ? t('settings.assistant.autoFollowCliModel', '自动跟随CLI运行时的模型') : undefined} variant='settings' />
      </PreferenceRow>

      {/* Connection Status - show when bot is enabled */}
      {pluginStatus?.enabled && authorizedUsers.length === 0 && (
        <div className={`rd-12px p-16px border ${pluginStatus?.connected ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : pluginStatus?.error ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'}`}>
          <SectionHeader title={t('settings.lark.connectionStatus', 'Connection Status')} action={<span className={`text-12px px-8px py-2px rd-4px ${pluginStatus?.connected ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : pluginStatus?.error ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'}`}>{pluginStatus?.connected ? t('settings.lark.statusConnected', 'Connected') : pluginStatus?.error ? t('settings.lark.statusError', 'Error') : t('settings.lark.statusConnecting', 'Connecting...')}</span>} />
          {pluginStatus?.error && <div className='text-14px text-red-600 dark:text-red-400 mb-12px'>{pluginStatus.error}</div>}
          {pluginStatus?.connected && (
            <div className='text-14px text-t-secondary space-y-8px'>
              <p className='m-0 font-500'>{t('settings.assistant.nextSteps', 'Next Steps')}:</p>
              <p className='m-0'>
                <strong>1.</strong> {t('settings.lark.step1', 'Open Feishu/Lark and find your bot application')}
              </p>
              <p className='m-0'>
                <strong>2.</strong> {t('settings.lark.step2', 'Send any message to initiate pairing')}
              </p>
              <p className='m-0'>
                <strong>3.</strong> {t('settings.lark.step3', 'A pairing request will appear below. Click "Approve" to authorize the user.')}
              </p>
              <p className='m-0'>
                <strong>4.</strong> {t('settings.lark.step4', 'Once approved, you can start chatting with the AI assistant through Lark!')}
              </p>
            </div>
          )}
          {!pluginStatus?.connected && !pluginStatus?.error && <div className='text-14px text-t-secondary'>{t('settings.lark.waitingConnection', 'WebSocket connection is being established. Please wait...')}</div>}
        </div>
      )}

      {/* Pending Pairings */}
      {pluginStatus?.enabled && authorizedUsers.length === 0 && (
        <div className='bg-fill-1 rd-12px pt-16px pr-16px pb-16px pl-0'>
          <SectionHeader
            title={t('settings.assistant.pendingPairings', 'Pending Pairing Requests')}
            action={
              <Button size='mini' type='text' icon={<Refresh size={14} />} loading={pairingLoading} onClick={loadPendingPairings}>
                {t('conversation.workspace.refresh', 'Refresh')}
              </Button>
            }
          />

          {pairingLoading ? (
            <div className='flex justify-center py-24px'>
              <Spin />
            </div>
          ) : pendingPairings.length === 0 ? (
            <Empty description={t('settings.assistant.noPendingPairings', 'No pending pairing requests')} />
          ) : (
            <div className='flex flex-col gap-12px'>
              {pendingPairings.map((pairing) => (
                <div key={pairing.code} className='flex items-center justify-between bg-fill-2 rd-8px p-12px'>
                  <div className='flex-1'>
                    <div className='flex items-center gap-8px'>
                      <span className='text-14px font-500 text-t-primary'>{pairing.displayName || 'Unknown User'}</span>
                      <Tooltip content={t('settings.assistant.copyCode', 'Copy pairing code')}>
                        <button className='p-4px bg-transparent border-none text-t-tertiary hover:text-t-primary cursor-pointer' onClick={() => copyToClipboard(pairing.code)}>
                          <Copy size={14} />
                        </button>
                      </Tooltip>
                    </div>
                    <div className='text-12px text-t-tertiary mt-4px'>
                      {t('settings.assistant.pairingCode', 'Code')}: <code className='bg-fill-3 px-4px rd-2px'>{pairing.code}</code>
                      <span className='mx-8px'>|</span>
                      {t('settings.assistant.expiresIn', 'Expires in')}: {getRemainingTime(pairing.expiresAt)}
                    </div>
                  </div>
                  <div className='flex items-center gap-8px'>
                    <Button type='primary' size='small' icon={<CheckOne size={14} />} onClick={() => handleApprovePairing(pairing.code)}>
                      {t('settings.assistant.approve', 'Approve')}
                    </Button>
                    <Button type='secondary' size='small' status='danger' icon={<CloseOne size={14} />} onClick={() => handleRejectPairing(pairing.code)}>
                      {t('settings.assistant.reject', 'Reject')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Authorized Users */}
      {authorizedUsers.length > 0 && (
        <div className='bg-fill-1 rd-12px pt-16px pr-16px pb-16px pl-0'>
          <SectionHeader
            title={t('settings.assistant.authorizedUsers', 'Authorized Users')}
            action={
              <Button size='mini' type='text' icon={<Refresh size={14} />} loading={usersLoading} onClick={loadAuthorizedUsers}>
                {t('common.refresh', 'Refresh')}
              </Button>
            }
          />

          {usersLoading ? (
            <div className='flex justify-center py-24px'>
              <Spin />
            </div>
          ) : authorizedUsers.length === 0 ? (
            <Empty description={t('settings.assistant.noAuthorizedUsers', 'No authorized users yet')} />
          ) : (
            <div className='flex flex-col gap-12px'>
              {authorizedUsers.map((user) => (
                <div key={user.id} className='flex items-center justify-between bg-fill-2 rd-8px p-12px'>
                  <div className='flex-1'>
                    <div className='text-14px font-500 text-t-primary'>{user.displayName || 'Unknown User'}</div>
                    <div className='text-12px text-t-tertiary mt-4px'>
                      {t('settings.assistant.platform', 'Platform')}: {user.platformType}
                      <span className='mx-8px'>|</span>
                      {t('settings.assistant.authorizedAt', 'Authorized')}: {formatTime(user.authorizedAt)}
                    </div>
                  </div>
                  <Tooltip content={t('settings.assistant.revokeAccess', 'Revoke access')}>
                    <Button type='text' status='danger' size='small' icon={<Delete size={16} />} onClick={() => handleRevokeUser(user.id)} />
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

export default LarkConfigForm;
