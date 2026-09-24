/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Input, Message } from '@arco-design/web-react';
import { Key, Link, Lock, Phone, Protect, Server, User } from '@icon-park/react';
import type { AuthMethod } from '@sudowork/common/systemConfigTypes';
import { getMossServerPolicy, normalizeHttpOrigin } from '@sudowork/common/sudoworkServer';
import { ConfigStorage } from '@sudowork/common/storage';
import { TENANT_CONFIG_STORAGE_KEY, DEFAULT_TENANT_CONFIG, resolveTenantConfig } from '@sudowork/common/types/tenantConfig';
import { setAppMode } from '@sudowork/host-bridge/eeclawMode';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import SudoworkIcon from '@renderer/assets/sudowork-icon-dark.svg';
import AppLoader from '@renderer/components/AppLoader';
import WindowControls from '@renderer/components/WindowControls';
import ThirdPartyAuthPanel from './ThirdPartyAuthPanel';
import { useSystemLoginMethod } from '@renderer/hooks/useSystemLoginMethod';
import { isElectronDesktop, isMacOS } from '@renderer/utils/platform';
import { useAuth } from '../../context/AuthContext';
import './LoginPage.css';

const DEFAULT_MOSS_URL = 'https://agent.sudoprivacy.com';
const MOSS_URL_STORAGE_KEY = 'login.mossBaseUrl';
const showWindowControls = isElectronDesktop() && !isMacOS();
const isWebRuntime = typeof window !== 'undefined' && !window.electronAPI;

type LoginTab = 'phone' | 'password' | 'api_key' | 'register' | 'sso';

function isValidPhone(phone: string): boolean {
  if (phone.length === 11) return phone[0] === '1' && /^\d{11}$/.test(phone);
  if (phone.length >= 13 && phone.startsWith('+86')) {
    const number = phone.slice(3);
    return number.length === 11 && number[0] === '1' && /^\d{11}$/.test(number);
  }
  return false;
}

function getCachedTenantConfig(): Required<typeof DEFAULT_TENANT_CONFIG> {
  try {
    const cached = localStorage.getItem(TENANT_CONFIG_STORAGE_KEY);
    if (cached) return resolveTenantConfig(JSON.parse(cached));
  } catch {
    // Ignore invalid legacy cache and use the product defaults.
  }
  return DEFAULT_TENANT_CONFIG;
}

function preferredTab(methods: AuthMethod[], legacyMethod: number | null): LoginTab {
  const legacyPreferred: LoginTab = legacyMethod === 0 ? 'phone' : legacyMethod === 2 ? 'sso' : 'password';
  if (methods.includes(legacyPreferred)) return legacyPreferred;
  return (methods[0] as LoginTab | undefined) ?? 'password';
}

function generateOAuth2State(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { status, enterGuest, login, register, enterpriseLogin, enterpriseLoginWithOAuth2 } = useAuth();
  const [organizationCode, setOrganizationCode] = useState(() => localStorage.getItem('login.organizationCode') || '');
  const [organizationDraft, setOrganizationDraft] = useState(organizationCode);
  const [policyRetry, setPolicyRetry] = useState(0);
  const { loginMethod, authMethods, systemConfig, isLoading: isBootstrapLoading, error: policyError } = useSystemLoginMethod(organizationCode, undefined, policyRetry);
  const tenantConfig = getCachedTenantConfig();
  const availableMethods = useMemo(() => authMethods.filter((method) => method !== 'sso' || isElectronDesktop()), [authMethods]);
  const isRegistrationEnabled = availableMethods.includes('phone') && (systemConfig?.registration?.phone_enabled ?? true);
  const [loginTab, setLoginTab] = useState<LoginTab>(() => preferredTab(authMethods, loginMethod));
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [isServerExpanded, setIsServerExpanded] = useState(false);
  const [isServerLocked, setIsServerLocked] = useState(false);
  const [serverUrl, setServerUrl] = useState(() => (isWebRuntime ? (localStorage.getItem(MOSS_URL_STORAGE_KEY) ?? '') : DEFAULT_MOSS_URL));
  const [oauth2Config, setOauth2Config] = useState<{
    enabled: boolean;
    authorize_url?: string;
    require_state?: boolean;
  } | null>(null);
  const [isOauth2Loading, setIsOauth2Loading] = useState(false);
  const oauth2StateRef = useRef<string | null>(null);

  useEffect(() => {
    if (loginTab === 'register' && isRegistrationEnabled) return;
    if (!availableMethods.includes(loginTab as AuthMethod)) {
      setLoginTab(preferredTab(availableMethods, loginMethod));
    }
  }, [availableMethods, isRegistrationEnabled, loginMethod, loginTab]);

  useEffect(() => {
    if (!isElectronDesktop()) return;
    void getMossServerPolicy().then((policy) => {
      setServerUrl(policy.serverUrl);
      setIsServerLocked(policy.isLocked);
    });
  }, []);

  useEffect(() => {
    if (status === 'authenticated') void navigate('/guid', { replace: true });
  }, [navigate, status]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (loginTab !== 'sso' || !isElectronDesktop() || oauth2Config) return;
    setIsOauth2Loading(true);
    void getMossServerPolicy()
      .then((policy) => ipcBridge.eeclaw.oauth2Config.invoke({ serverUrl: policy.serverUrl }))
      .then((result) => setOauth2Config(result.success && result.data ? result.data : { enabled: false }))
      .finally(() => setIsOauth2Loading(false));
  }, [loginTab, oauth2Config]);

  useEffect(() => {
    if (!isElectronDesktop()) return;
    return ipcBridge.deepLink.received.on((payload) => {
      if (payload.action !== 'oauth2-callback') return;
      const { state, ...rest } = payload.params || {};
      if (oauth2Config?.require_state !== false && state !== oauth2StateRef.current) {
        setIsLoading(false);
        Message.error(t('login.thirdPartyStateInvalid'));
        return;
      }
      const params = Object.fromEntries(Object.entries(rest).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0));
      oauth2StateRef.current = null;
      if (Object.keys(params).length === 0) {
        setIsLoading(false);
        Message.error(t('login.thirdPartyFailed'));
        return;
      }
      void enterpriseLoginWithOAuth2(params).then((result) => {
        setIsLoading(false);
        if (result.success) window.location.reload();
        else Message.error(result.message || t('login.thirdPartyFailed'));
      });
    });
  }, [enterpriseLoginWithOAuth2, navigate, oauth2Config?.require_state, t]);

  const mossBaseUrl = (): string | undefined => {
    if (!isWebRuntime || !serverUrl.trim()) return undefined;
    return normalizeHttpOrigin(serverUrl);
  };

  const onLoginSucceeded = () => {
    if (isElectronDesktop()) {
      // setAppMode updates the persisted process setting. Reload once so all
      // mode-dependent providers initialize against the online Moss context.
      window.location.reload();
      return;
    }
    void navigate('/guid', { replace: true });
  };

  const onPrepareOnline = async (): Promise<boolean> => {
    if (isWebRuntime && !serverUrl.trim()) {
      localStorage.removeItem('sudowork_guest');
      return true;
    }
    const normalized = normalizeHttpOrigin(serverUrl);
    if (!normalized) {
      Message.warning(t('login.mossBaseUrlInvalid'));
      return false;
    }
    if (isElectronDesktop()) {
      await ConfigStorage.set('eeclaw.serverUrl', normalized);
      await setAppMode('e');
    }
    localStorage.removeItem('sudowork_guest');
    return true;
  };

  const onApplyServer = async () => {
    const normalized = normalizeHttpOrigin(serverUrl);
    if (!normalized) {
      Message.warning(t('login.mossBaseUrlInvalid'));
      return;
    }
    setIsLoading(true);
    try {
      if (isWebRuntime) {
        const response = await fetch(`/api/v1/system-config?mossBaseUrl=${encodeURIComponent(normalized)}`);
        if (!response.ok) throw new Error('server rejected');
        localStorage.setItem(MOSS_URL_STORAGE_KEY, normalized);
      } else {
        const result = await ipcBridge.eeclaw.verifyServer.invoke({ serverUrl: normalized });
        if (!result.success || !result.data) throw new Error('server unavailable');
        await ConfigStorage.set('eeclaw.serverUrl', normalized);
        await ConfigStorage.set('eeclaw.tenantName', resolveTenantConfig(result.data).app_company_name);
        localStorage.setItem(TENANT_CONFIG_STORAGE_KEY, JSON.stringify(resolveTenantConfig(result.data)));
      }
      window.location.reload();
    } catch {
      Message.error(t('login.serverVerifyFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const onSendCode = async () => {
    if (!isValidPhone(phone)) {
      Message.warning(t('login.phoneInvalid'));
      return;
    }
    if (!(await onPrepareOnline())) return;
    setIsLoading(true);
    try {
      const response = isWebRuntime
        ? await fetch('/api/auth/send-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ phone, ...(mossBaseUrl() ? { mossBaseUrl: mossBaseUrl() } : {}) }),
          })
        : await fetch(`${normalizeHttpOrigin(serverUrl)}/api/v1/auth/send-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone }),
          });
      const body = (await response.json()) as {
        success?: boolean;
        ok?: boolean;
        next_send_in?: number;
        nextSendIn?: number;
        msg?: string;
        message?: string;
      };
      const nextSendIn = body.next_send_in ?? body.nextSendIn;
      if (typeof nextSendIn === 'number') setCountdown(nextSendIn);
      if (response.ok && (body.success ?? body.ok)) Message.success(t('login.sendCodeSuccess'));
      else Message.error(body.message || body.msg || t('login.errors.serverError'));
    } catch {
      Message.error(t('login.errors.networkError'));
    } finally {
      setIsLoading(false);
    }
  };

  const onPhoneSubmit = async () => {
    if (!isValidPhone(phone) || !code.trim()) {
      Message.warning(t('login.requiredFields'));
      return;
    }
    if (!(await onPrepareOnline())) return;
    setIsLoading(true);
    try {
      const result = await login({ phone, code, mossBaseUrl: mossBaseUrl() });
      if (result.success) {
        onLoginSucceeded();
      } else {
        Message.error(result.message || t('login.errors.invalidCredentials'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const onRegisterSubmit = async () => {
    if (!isValidPhone(phone) || !code.trim() || !nickname.trim() || !invitationCode.trim()) {
      Message.warning(t('login.requiredFields'));
      return;
    }
    if (!(await onPrepareOnline())) return;
    setIsLoading(true);
    try {
      const result = await register({
        phone,
        code,
        nickname: nickname.trim(),
        invitation_code: invitationCode.trim(),
        mossBaseUrl: mossBaseUrl(),
      });
      if (result.success) onLoginSucceeded();
      else Message.error(result.message || t('login.pwdRegisterFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const onCredentialSubmit = async () => {
    if (!(await onPrepareOnline())) return;
    if (loginTab === 'password' && (!username.trim() || !password)) {
      Message.warning(t('login.requiredFields'));
      return;
    }
    if (loginTab === 'api_key' && !apiKey.trim()) {
      Message.warning(t('login.apiKeyRequired'));
      return;
    }
    setIsLoading(true);
    try {
      const result =
        loginTab === 'api_key'
          ? await enterpriseLogin({ api_key: apiKey.trim(), mossBaseUrl: mossBaseUrl() })
          : await enterpriseLogin({
              username: username.trim(),
              password,
              mossBaseUrl: mossBaseUrl(),
            });
      if (result.success) onLoginSucceeded();
      else Message.error(result.message || t('login.pwdLoginFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const onSsoLogin = async () => {
    if (!(await onPrepareOnline()) || !oauth2Config?.enabled || !oauth2Config.authorize_url) return;
    const state = generateOAuth2State();
    oauth2StateRef.current = state;
    const separator = oauth2Config.authorize_url.includes('?') ? '&' : '?';
    const url = oauth2Config.authorize_url.includes('{state}') ? oauth2Config.authorize_url.replace('{state}', encodeURIComponent(state)) : `${oauth2Config.authorize_url}${separator}state=${encodeURIComponent(state)}`;
    setIsLoading(true);
    try {
      await ipcBridge.shell.openExternal.invoke(url);
    } catch {
      setIsLoading(false);
      Message.error(t('login.thirdPartyOpenFailed'));
    }
  };

  const onUseOffline = async () => {
    setIsLoading(true);
    try {
      await enterGuest();
      await setAppMode('c');
      const result = await ipcBridge.application.startConsumerServices.invoke();
      if (result && !result.success) throw new Error(result.msg || 'Failed to start local services');
      window.location.reload();
    } catch (error) {
      setIsLoading(false);
      Message.error(error instanceof Error ? error.message : t('login.errors.serverError'));
    }
  };

  if (status === 'checking') return <AppLoader />;

  return (
    <div className='login-page'>
      {showWindowControls && (
        <div className='app-window-controls'>
          <WindowControls />
        </div>
      )}
      <div className='login-page__background'>
        <div className='login-page__background-circle login-page__background-circle--lg' />
        <div className='login-page__background-circle login-page__background-circle--md' />
        <div className='login-page__background-circle login-page__background-circle--sm' />
      </div>

      <div className='login-page__card'>
        <div className='login-page__header'>
          <div className='login-page__logo'>
            <img src={tenantConfig.logo || SudoworkIcon} alt={tenantConfig.app_name} className='w-64px h-64px object-contain' />
          </div>
          <h1 className='text-28px font-800 tracking-tighter bg-gradient-to-br from-primary to-purple-600 bg-clip-text text-transparent mb-8px'>{tenantConfig.app_name}</h1>
          <p className='text-13px text-secondary'>{tenantConfig.login_desp}</p>
        </div>

        <div className='login-tabs'>
          {availableMethods.includes('phone') && <LoginTabButton isActive={loginTab === 'phone'} label={t('login.phoneTab')} onClick={() => setLoginTab('phone')} />}
          {availableMethods.includes('password') && <LoginTabButton isActive={loginTab === 'password'} label={t('login.passwordTab')} onClick={() => setLoginTab('password')} />}
          {availableMethods.includes('api_key') && <LoginTabButton isActive={loginTab === 'api_key'} label={t('login.apiKeyTab')} onClick={() => setLoginTab('api_key')} />}
          {isRegistrationEnabled && <LoginTabButton isActive={loginTab === 'register'} label={t('login.pwdRegisterTab')} onClick={() => setLoginTab('register')} />}
          {availableMethods.includes('sso') && <LoginTabButton isActive={loginTab === 'sso'} label={t('login.ssoTab')} onClick={() => setLoginTab('sso')} />}
        </div>

        <div className='flex flex-col gap-20px mt-24px'>
          <div className='flex flex-col gap-8px'>
            <label htmlFor='login-organization-code' className='text-12px font-600 text-secondary'>
              企业码（留空使用平台默认入口）
            </label>
            <div className='flex gap-8px'>
              <Input id='login-organization-code' value={organizationDraft} onChange={setOrganizationDraft} placeholder='输入企业码' disabled={isLoading} />
              <Button
                disabled={isLoading || isBootstrapLoading}
                onClick={() => {
                  const code = organizationDraft.trim();
                  localStorage.setItem('login.organizationCode', code);
                  setOrganizationCode(code);
                  setPolicyRetry((value) => value + 1);
                }}
              >
                应用
              </Button>
            </div>
            {isBootstrapLoading ? <div role='status'>正在获取该企业的登录方式…</div> : null}
            {policyError ? (
              <div role='alert' className='text-red-500'>
                {policyError.message}
              </div>
            ) : null}
          </div>
          <fieldset disabled={isBootstrapLoading || Boolean(policyError)} style={{ border: 0, padding: 0, display: 'contents' }}>
            {loginTab === 'phone' && (
              <>
                <Input size='large' prefix={<Phone className='text-tertiary' />} placeholder={t('login.phonePlaceholder')} value={phone} onChange={setPhone} className='login-input !rd-12px h-48px' />
                <div className='flex w-full'>
                  <Input size='large' prefix={<Protect className='text-tertiary' />} placeholder={t('login.codePlaceholder')} value={code} onChange={setCode} maxLength={8} className='login-input !rd-l-12px h-48px flex-1' />
                  <Button size='large' disabled={countdown > 0 || isLoading} onClick={() => void onSendCode()} className='h-48px !rd-r-12px'>
                    {countdown > 0 ? t('login.countingDown', { count: countdown }) : t('login.sendCode')}
                  </Button>
                </div>
                <Button type='primary' size='large' loading={isLoading} onClick={() => void onPhoneSubmit()} className='login-btn-primary !rd-12px h-52px font-700 text-16px'>
                  {t('login.submit')}
                </Button>
              </>
            )}

            {loginTab === 'password' && (
              <>
                <Input size='large' prefix={<User className='text-tertiary' />} placeholder={t('login.pwdAccountPlaceholder')} value={username} onChange={setUsername} className='login-input !rd-12px h-48px' />
                <Input.Password size='large' prefix={<Lock className='text-tertiary' />} placeholder={t('login.pwdPasswordPlaceholder')} value={password} onChange={setPassword} className='login-input !rd-12px h-48px' />
                <Button type='primary' size='large' loading={isLoading} onClick={() => void onCredentialSubmit()} className='login-btn-primary !rd-12px h-52px font-700 text-16px'>
                  {t('login.pwdLoginBtn')}
                </Button>
              </>
            )}

            {loginTab === 'api_key' && (
              <>
                <Input.Password size='large' prefix={<Key className='text-tertiary' />} placeholder={t('login.apiKeyPlaceholder')} value={apiKey} onChange={setApiKey} className='login-input !rd-12px h-48px' />
                <Button type='primary' size='large' loading={isLoading} onClick={() => void onCredentialSubmit()} className='login-btn-primary !rd-12px h-52px font-700 text-16px'>
                  {t('login.submit')}
                </Button>
              </>
            )}

            {loginTab === 'register' && (
              <>
                <Input size='large' prefix={<Phone className='text-tertiary' />} placeholder={t('login.phonePlaceholder')} value={phone} onChange={setPhone} className='login-input !rd-12px h-48px' />
                <div className='flex w-full'>
                  <Input size='large' prefix={<Protect className='text-tertiary' />} placeholder={t('login.codePlaceholder')} value={code} onChange={setCode} maxLength={8} className='login-input !rd-l-12px h-48px flex-1' />
                  <Button size='large' disabled={countdown > 0 || isLoading} onClick={() => void onSendCode()} className='h-48px !rd-r-12px'>
                    {countdown > 0 ? t('login.countingDown', { count: countdown }) : t('login.sendCode')}
                  </Button>
                </div>
                <Input size='large' prefix={<User className='text-tertiary' />} placeholder={t('login.pwdNicknamePlaceholder')} value={nickname} onChange={setNickname} className='login-input !rd-12px h-48px' />
                <Input size='large' prefix={<Key className='text-tertiary' />} placeholder={t('login.pwdInvitationCodePlaceholder')} value={invitationCode} onChange={setInvitationCode} className='login-input !rd-12px h-48px' />
                <Button type='primary' size='large' loading={isLoading} onClick={() => void onRegisterSubmit()} className='login-btn-primary !rd-12px h-52px font-700 text-16px'>
                  {t('login.pwdRegisterBtn')}
                </Button>
              </>
            )}

            {loginTab === 'sso' && systemConfig?.third_party_auth?.enabled ? (
              <ThirdPartyAuthPanel compact appName={tenantConfig.app_name} logo={tenantConfig.logo} defaultLogo={SudoworkIcon} systemConfig={systemConfig} onBackToModeSelect={() => setLoginTab(preferredTab(availableMethods, loginMethod))} />
            ) : null}
            {loginTab === 'sso' && !systemConfig?.third_party_auth?.enabled && (
              <>
                <div className='login-third-party__icon'>
                  <Link theme='outline' size={32} />
                </div>
                <Button type='primary' size='large' loading={isLoading} disabled={isOauth2Loading || !oauth2Config?.enabled} onClick={() => void onSsoLogin()} className='login-btn-primary !rd-12px h-52px font-700 text-16px'>
                  {isLoading ? t('login.thirdPartyWaiting') : t('login.ssoLogin')}
                </Button>
                {!isOauth2Loading && !oauth2Config?.enabled && <div className='text-center text-12px text-tertiary'>{t('login.thirdPartyUnavailable')}</div>}
              </>
            )}
          </fieldset>
          {isServerExpanded ? (
            <div className='flex flex-col gap-8px'>
              <div className='text-12px font-600 text-secondary ml-4px'>{t('login.mossBaseUrlLabel')}</div>
              <div className='flex w-full'>
                <Input size='large' maxLength={2048} disabled={isServerLocked} prefix={<Server className='text-tertiary' />} placeholder={DEFAULT_MOSS_URL} value={serverUrl} onChange={setServerUrl} className='login-input !rd-l-12px h-48px flex-1' />
                <Button size='large' loading={isLoading} disabled={isServerLocked} onClick={() => void onApplyServer()} className='h-48px !rd-r-12px'>
                  {t('login.serverApply')}
                </Button>
              </div>
              {isServerLocked && <div className='text-12px text-tertiary ml-4px'>{t('login.serverLocked')}</div>}
            </div>
          ) : (
            <span className='text-12px text-tertiary cursor-pointer hover:text-secondary transition-colors' onClick={() => setIsServerExpanded(true)}>
              {t('login.customServerToggle')}
            </span>
          )}

          {isElectronDesktop() && (
            <div className='text-center'>
              <span className='text-12px text-tertiary cursor-pointer hover:text-secondary transition-colors' onClick={() => void onUseOffline()}>
                {t('login.offlineUse')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LoginTabButton({ isActive, label, onClick }: ILoginTabButtonProps) {
  return (
    <button type='button' className={`login-tab ${isActive ? 'login-tab--active' : ''}`} onClick={onClick}>
      {label}
    </button>
  );
}

interface ILoginTabButtonProps {
  isActive: boolean;
  label: string;
  onClick: () => void;
}
