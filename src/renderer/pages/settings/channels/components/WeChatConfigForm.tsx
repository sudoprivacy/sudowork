/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Dropdown, Menu, Message, Spin } from '@arco-design/web-react';
import { IconDown, IconRefresh } from '@arco-design/web-react/icon';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import type { IChannelPluginStatus } from '@/channels/types';
import { openExternalUrl } from '@/renderer/utils/platform';
import { acpConversation, channel } from '@/common/ipcBridge';
import { ConfigStorage } from '@/common/storage';
import { CHANNEL_DEFAULT_AGENT_BACKEND, type AcpBackendAll } from '@/types/acpTypes';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import type { GeminiModelSelection, LoginPhase } from '../types';
import { WECHAT_GUIDE_URL } from '../utils';
import GeminiModelSelector from './GeminiModelSelector';
import PreferenceRow from './PreferenceRow';

interface WeChatConfigFormProps {
  pluginStatus: IChannelPluginStatus | null;
  modelSelection: GeminiModelSelection;
  onStatusChange?: (status: IChannelPluginStatus | null) => void;
}

const WeChatConfigForm: React.FC<WeChatConfigFormProps> = ({ pluginStatus, modelSelection, onStatusChange }) => {
  const { t } = useTranslation();
  const { isEnterprise } = useAppMode();

  const isConnected = pluginStatus?.connected || false;
  const [phase, setPhase] = useState<LoginPhase>(isConnected ? 'success' : 'idle');
  const [qrUrl, setQrUrl] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Agent selection
  const [availableAgents, setAvailableAgents] = useState<Array<{ backend: AcpBackendAll; name: string; customAgentId?: string; isPreset?: boolean }>>([]);
  const [selectedAgent, setSelectedAgent] = useState<{ backend: AcpBackendAll; name?: string; customAgentId?: string }>({ backend: CHANNEL_DEFAULT_AGENT_BACKEND });

  // Sync connected status to phase
  useEffect(() => {
    if (isConnected) {
      setPhase('success');
    } else if (phase === 'success') {
      setPhase('idle');
    }
    // Keep this tied to connection status only; adding phase can interrupt local QR login state transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  // Load available agents + saved selection
  useEffect(() => {
    const loadAgentsAndSelection = async () => {
      try {
        const [agentsResp, saved] = await Promise.all([acpConversation.getAvailableAgents.invoke(), ConfigStorage.get('assistant.wechat.agent')]);

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
        console.error('[WeChatConfig] Failed to load agents:', error);
      }
    };

    void loadAgentsAndSelection();
  }, []);

  const persistSelectedAgent = async (agent: { backend: AcpBackendAll; customAgentId?: string; name?: string }) => {
    try {
      await ConfigStorage.set('assistant.wechat.agent', agent);
      await channel.syncChannelSettings.invoke({ platform: 'wechat', agent }).catch((err) => console.warn('[WeChatConfig] syncChannelSettings failed:', err));
      Message.success(t('settings.assistant.agentSwitched', 'Agent switched successfully'));
    } catch (error) {
      console.error('[WeChatConfig] Failed to save agent:', error);
      Message.error(t('common.saveFailed', 'Failed to save'));
    }
  };

  // Handle QR login confirmed: enable WeChat plugin with credentials
  const handleConfirmed = useCallback(
    async (botToken: string, accountId: string) => {
      try {
        const result = await channel.enablePlugin.invoke({
          pluginId: 'wechat_default',
          config: { token: botToken, accountId },
        });

        if (result.success) {
          setPhase('success');
          Message.success(t('settings.channels.wechat.installSuccess', 'WeChat connected successfully'));
          const statusResult = await channel.getPluginStatus.invoke();
          if (statusResult.success && statusResult.data) {
            const wechatStatus = statusResult.data.find((p) => p.type === 'wechat');
            onStatusChange?.(wechatStatus || null);
          }
        } else {
          setPhase('error');
          setErrorMessage(result.msg || 'Failed to enable WeChat plugin');
        }
      } catch (error: any) {
        setPhase('error');
        setErrorMessage(error.message || 'Failed to enable WeChat plugin');
      }
    },
    [t, onStatusChange]
  );

  // Listen for QR login events
  useEffect(() => {
    const unsubscribe = channel.wechatQrLogin.on((event) => {
      console.log('[WeChatConfig] QR login event:', event.phase);

      if (event.phase === 'qrcode') {
        setPhase('qrcode');
        if (event.qrUrl) {
          setQrUrl(event.qrUrl);
        }
      } else if (event.phase === 'scanned') {
        setPhase('scanned');
      } else if (event.phase === 'confirmed') {
        void handleConfirmed(event.botToken || '', event.accountId || '');
      } else if (event.phase === 'error') {
        setPhase('error');
        setErrorMessage(event.message || t('settings.channels.wechat.installFailed', 'Login failed'));
      } else if (event.phase === 'timeout') {
        setPhase('error');
        setErrorMessage(event.message || t('settings.channels.wechat.qrExpired', 'QR code expired'));
      }
    });
    return () => unsubscribe();
  }, [t, handleConfirmed]);

  // Start QR login
  const handleStartLogin = useCallback(async () => {
    setPhase('loading');
    setErrorMessage('');
    setQrUrl('');

    try {
      const result = await channel.wechatStartQrLogin.invoke();
      if (!result.success) {
        setPhase('error');
        setErrorMessage(result.msg || t('settings.channels.wechat.installFailed', 'Login failed'));
      }
    } catch (error: any) {
      setPhase('error');
      setErrorMessage(error.message || String(error));
    }
  }, [t]);

  // Cancel QR login on unmount
  useEffect(() => {
    return () => {
      void channel.wechatCancelQrLogin.invoke().catch(() => {});
    };
  }, []);

  const isGeminiAgent = selectedAgent.backend === 'gemini';
  const agentOptions: Array<{ backend: AcpBackendAll; name: string; customAgentId?: string; isExtension?: boolean }> = availableAgents.length > 0 ? availableAgents : [{ backend: CHANNEL_DEFAULT_AGENT_BACKEND, name: 'Sudo Code' }];

  const renderQRCodeSection = () => {
    if (phase !== 'qrcode' && phase !== 'scanned') return null;

    return (
      <div className='flex flex-col items-center gap-3 p-4 rd-8px bg-fill-1 border border-light'>
        <div className='text-14px font-500 text-foreground'>{phase === 'scanned' ? t('settings.channels.wechat.scanned', 'Scanned! Confirm on your phone...') : t('settings.channels.wechat.scanQR', 'Scan with WeChat')}</div>
        <div className='bg-white rd-8px p-3'>
          {qrUrl ? (
            <QRCodeSVG value={qrUrl} size={200} level='H' />
          ) : (
            <div className='flex flex-col items-center gap-2'>
              <Spin size={32} />
              <span className='text-12px text-tertiary'>{t('settings.channels.wechat.loadingQR', 'Loading QR code...')}</span>
            </div>
          )}
        </div>
        <div className='text-12px text-tertiary'>{t('settings.channels.wechat.scanHint', 'Open WeChat on your phone and scan the QR code above')}</div>
      </div>
    );
  };

  const renderConnectionSection = () => {
    if (phase === 'success' || isConnected) {
      return (
        <div className='flex items-center gap-2 p-3 rd-8px bg-success-soft border border-success-line'>
          <div className='size-2 rd-full bg-success' />
          <span className='text-13px text-foreground'>{t('settings.channels.wechat.connected', 'WeChat is connected')}</span>
        </div>
      );
    }

    if (phase === 'loading') {
      return (
        <div className='flex flex-col items-center gap-3 p-6'>
          <Spin size={32} />
          <span className='text-14px text-secondary'>{t('settings.channels.wechat.installing', 'Preparing QR code...')}</span>
        </div>
      );
    }

    if (phase === 'error') {
      return (
        <div className='flex flex-col gap-3 p-3 rd-8px bg-danger-soft border border-danger-line'>
          <div className='text-13px text-danger'>{errorMessage}</div>
          <Button type='outline' status='warning' onClick={handleStartLogin} className='self-start'>
            <IconRefresh style={{ fontSize: 14 }} className='mr-1' />
            {t('common.retry', 'Retry')}
          </Button>
        </div>
      );
    }

    return (
      <div className='flex flex-col gap-3'>
        <div className='text-13px text-secondary leading-relaxed'>
          {t('settings.channels.wechat.installDesc', 'Scan the QR code with WeChat to connect your personal WeChat account.')} <span className='text-warning text-12px'>{t('settings.channels.wechat.privacyWarning', 'Note: All messages sent via WeChat will pass through WeChat servers first.')}</span>{' '}
          <a
            className='text-primary hover:underline cursor-pointer text-12px'
            href={WECHAT_GUIDE_URL}
            onClick={(e) => {
              e.preventDefault();
              openExternalUrl(WECHAT_GUIDE_URL).catch(console.error);
            }}
          >
            {t('settings.channels.wechat.guideLink', '跟随教程')}
          </a>
        </div>
        <Button type='primary' onClick={handleStartLogin} className='self-start'>
          {t('settings.channels.wechat.install', 'Connect WeChat')}
        </Button>
      </div>
    );
  };

  return (
    <div className='flex flex-col gap-6'>
      {/* Connection / QR Login */}
      {renderConnectionSection()}
      {renderQRCodeSection()}

      {/* Agent Selection - hidden in enterprise mode (uses Moss remote agent) */}
      {!isEnterprise && (
        <div className='flex flex-col gap-2'>
          <PreferenceRow label={t('settings.channels.wechat.agent', 'Agent')} description={t('settings.channels.wechat.agentDesc', 'Used for WeChat conversations')}>
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

      {/* Default Model Selection - hidden in enterprise mode */}
      {!isEnterprise && (
        <PreferenceRow label={t('settings.assistant.defaultModel', 'Model')} description={t('settings.channels.wechat.defaultModelDesc', 'Used for Agent conversations')}>
          <GeminiModelSelector selection={isGeminiAgent ? modelSelection : undefined} disabled={!isGeminiAgent} label={!isGeminiAgent ? t('settings.assistant.autoFollowCliModel', 'Auto-follow CLI runtime model') : undefined} variant='settings' />
        </PreferenceRow>
      )}
    </div>
  );
};

export default WeChatConfigForm;
