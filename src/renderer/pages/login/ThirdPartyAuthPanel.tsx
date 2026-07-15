import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Message, Select } from '@arco-design/web-react';
import { PeopleSafe, Link } from '@icon-park/react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { SystemConfig, ThirdPartyAuthProvider } from '@/common/systemConfig';
import { buildCasLoginUrl, buildCasServiceUrl, parseCasCallbackAction, resolveThirdPartyAuthConfig } from '@/common/thirdPartyAuthConfig';
import { useAuth } from '../../context/AuthContext';
import './LoginPage.css';

export default function ThirdPartyAuthPanel({ appName, logo, defaultLogo, systemConfig, onBackToModeSelect }: IThirdPartyAuthPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { exchangeThirdPartyAuthCode, loginWithThirdPartyAuth } = useAuth();
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
    <div className='login-page__card'>
      <div className='login-page__header'>
        <div className='login-page__logo'>
          <img src={logo || defaultLogo} alt={appName} className='w-64px h-64px object-contain' />
        </div>
        <h1 className='text-28px font-800 tracking-tighter bg-gradient-to-br from-primary to-purple-600 bg-clip-text text-transparent mb-8px'>{appName}</h1>
        <p className='text-13px text-secondary'>{t('login.thirdPartySubtitle')}</p>
      </div>

      <div className='flex flex-col gap-20px mt-24px'>
        <div className='login-third-party__icon'>
          <PeopleSafe theme='outline' size={32} />
        </div>

        <div className='flex flex-col gap-8px'>
          <div className='text-12px font-600 text-secondary ml-4px'>{t('login.thirdPartyProviderLabel')}</div>
          <Select value={selectedProvider?.id} onChange={(value) => setSelectedProviderId(String(value))} disabled={!resolvedConfig?.enabled || isWaiting} className='login-third-party__select' size='large'>
            {(resolvedConfig?.providers || []).map((provider: ThirdPartyAuthProvider) => (
              <Select.Option key={provider.id} value={provider.id}>
                {provider.name}
              </Select.Option>
            ))}
          </Select>
        </div>

        <Button type='primary' size='large' loading={isWaiting} disabled={!selectedProvider} onClick={() => void onLogin()} icon={<Link />} className='login-btn-primary !rd-12px h-52px mt-12px font-700 text-16px'>
          {isWaiting ? t('login.thirdPartyWaiting') : t('login.thirdPartyLoginBtn', { provider: selectedProvider?.name || t('login.thirdPartyProviderFallback') })}
        </Button>

        <div className='text-center text-12px text-tertiary mt-2px'>{t('login.thirdPartyBrowserHint')}</div>

        {onBackToModeSelect && (
          <div className='text-center mt-12px'>
            <span className='text-12px text-tertiary cursor-pointer hover:text-secondary transition-colors' onClick={onBackToModeSelect}>
              {t('login.backToModeSelect')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

interface IThirdPartyAuthPanelProps {
  appName: string;
  logo?: string;
  defaultLogo: string;
  systemConfig: SystemConfig | null;
  onBackToModeSelect?: () => void;
}
