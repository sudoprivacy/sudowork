/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Message, Select } from '@arco-design/web-react';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { SystemConfig, ThirdPartyAuthProvider } from '@/common/systemConfig';
import { buildCasLoginUrl, buildCasServiceUrl, parseCasCallbackAction, resolveThirdPartyAuthConfig } from '@/common/thirdPartyAuthConfig';
import { useAuth } from '../../../context/AuthContext';

export default function ThirdPartyAuthPanel({ appName, logo, defaultLogo, systemConfig, onBackToModeSelect }: IThirdPartyAuthPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { enterGuest, exchangeThirdPartyAuthCode, loginWithThirdPartyAuth } = useAuth();
  const resolvedConfig = useMemo(() => resolveThirdPartyAuthConfig(systemConfig), [systemConfig]);
  const [selectedProviderId, setSelectedProviderId] = useState(() => resolvedConfig?.defaultProvider || '');
  const [isWaiting, setIsWaiting] = useState(false);
  const pendingRef = useRef<{ providerId: string; service: string } | null>(null);

  useEffect(() => {
    if (resolvedConfig?.defaultProvider) {
      setSelectedProviderId((current) => current || resolvedConfig.defaultProvider);
    }
  }, [resolvedConfig?.defaultProvider]);

  const selectedProvider = useMemo(() => {
    return resolvedConfig?.providers.find((provider) => provider.id === selectedProviderId) || resolvedConfig?.providers[0] || null;
  }, [resolvedConfig?.providers, selectedProviderId]);

  useEffect(() => {
    return ipcBridge.deepLink.received.on((payload) => {
      const parsed = parseCasCallbackAction(payload.action);
      if (!parsed) return;

      const pending = pendingRef.current;
      const code = payload.params.code;
      const ticket = payload.params.ticket;
      if (parsed.action === 'logout') {
        pendingRef.current = null;
        setIsWaiting(false);
        Message.success(t('login.logoutSuccess'));
        return;
      }

      if (pending && parsed.providerId !== pending.providerId) {
        setIsWaiting(false);
        Message.error(t('login.thirdPartyStateInvalid'));
        return;
      }

      if (code) {
        setIsWaiting(true);
        void (async () => {
          const result = await exchangeThirdPartyAuthCode({
            provider: parsed.providerId,
            code,
          });
          pendingRef.current = null;
          setIsWaiting(false);
          if (result.success) {
            setTimeout(() => navigate('/guid', { replace: true }), 300);
          } else {
            Message.error(result.message || t('login.thirdPartyFailed'));
          }
        })();
        return;
      }

      if (!pending) {
        setIsWaiting(false);
        Message.error(t('login.thirdPartyStateInvalid'));
        return;
      }

      if (!ticket) {
        setIsWaiting(false);
        Message.error(t('login.thirdPartyMissingTicket'));
        return;
      }

      void (async () => {
        const result = await loginWithThirdPartyAuth({
          provider: pending.providerId,
          ticket,
          service: pending.service,
        });
        pendingRef.current = null;
        setIsWaiting(false);
        if (result.success) {
          setTimeout(() => navigate('/guid', { replace: true }), 300);
        } else {
          Message.error(result.message || t('login.thirdPartyFailed'));
        }
      })();
    });
  }, [exchangeThirdPartyAuthCode, loginWithThirdPartyAuth, navigate, t]);

  const onLogin = async () => {
    if (!selectedProvider) {
      Message.error(t('login.thirdPartyUnavailable'));
      return;
    }

    const service = buildCasServiceUrl(selectedProvider);
    let loginUrl = '';
    try {
      loginUrl = buildCasLoginUrl(selectedProvider, service);
    } catch {
      Message.error(t('login.thirdPartyUnavailable'));
      return;
    }
    pendingRef.current = { providerId: selectedProvider.id, service };
    setIsWaiting(true);

    try {
      await ipcBridge.shell.openExternal.invoke(loginUrl);
    } catch {
      pendingRef.current = null;
      setIsWaiting(false);
      Message.error(t('login.thirdPartyOpenFailed'));
    }
  };

  return (
    <section className='relative z-1 my-auto w-full max-w-md rounded-xl border border-border bg-card p-8 text-card-foreground shadow-xl [-webkit-app-region:no-drag] max-sm:p-6'>
      <header className='mb-7 text-center'>
        <div className='mx-auto mb-5 flex h-18 w-18 items-center justify-center rounded-xl bg-secondary shadow-sm'>
          <img src={logo || defaultLogo} alt='' className='h-14 w-14 object-contain' />
        </div>
        <h1 className='text-2xl font-700 tracking-tight text-foreground'>{appName}</h1>
        <p className='mt-2 text-sm leading-6 text-foreground-tertiary'>{t('login.thirdPartySubtitle')}</p>
      </header>

      <div className='flex flex-col gap-5'>
        <div className='mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-secondary text-secondary-foreground'>
          <ShieldCheck size={30} />
        </div>

        <div className='flex flex-col gap-2'>
          <div className='ml-1 text-sm font-600 text-foreground-secondary'>{t('login.thirdPartyProviderLabel')}</div>
          <Select value={selectedProvider?.id} onChange={(value) => setSelectedProviderId(String(value))} disabled={!resolvedConfig?.enabled || isWaiting} className='h-12 rounded-lg!' size='large'>
            {(resolvedConfig?.providers || []).map((provider: ThirdPartyAuthProvider) => (
              <Select.Option key={provider.id} value={provider.id}>
                {provider.name}
              </Select.Option>
            ))}
          </Select>
        </div>

        <Button type='primary' size='large' loading={isWaiting} disabled={!selectedProvider} onClick={() => void onLogin()} icon={<ExternalLink size={16} />} className='mt-1 h-12 rounded-lg text-base font-600'>
          {isWaiting ? t('login.thirdPartyWaiting') : t('login.thirdPartyLoginBtn', { provider: selectedProvider?.name || t('login.thirdPartyProviderFallback') })}
        </Button>

        <div className='text-center text-xs leading-5 text-muted-foreground'>{t('login.thirdPartyBrowserHint')}</div>

        {onBackToModeSelect && (
          <div className='flex items-center justify-center gap-2'>
            <Button type='text' size='small' className='text-foreground-tertiary! hover:text-foreground-secondary!' onClick={onBackToModeSelect}>
              {t('login.backToModeSelect')}
            </Button>
            <span className='text-foreground-quaternary'>·</span>
            <Button
              type='text'
              size='small'
              className='text-foreground-tertiary! hover:text-foreground-secondary!'
              onClick={async () => {
                await enterGuest();
                void navigate('/guid');
              }}
            >
              {t('login.skip')}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

interface IThirdPartyAuthPanelProps {
  appName: string;
  logo?: string;
  defaultLogo: string;
  systemConfig: SystemConfig | null;
  onBackToModeSelect?: () => void;
}
