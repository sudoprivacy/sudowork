/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Input, Message } from '@arco-design/web-react';
import { Phone, Protect, Key, User, Lock } from '@icon-park/react';
import { getSudoworkServerBaseUrl } from '@/common/sudoworkServer';
import { DEFAULT_TENANT_CONFIG, TENANT_CONFIG_STORAGE_KEY, resolveCachedTenantConfig } from '@/common/types/tenantConfig';
import SudoworkIcon from '@/renderer/assets/sudowork-icon-dark.svg';
import { isElectronDesktop, isMacOS } from '@/renderer/utils/platform';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { useSystemLoginMethod } from '@/renderer/hooks/useSystemLoginMethod';
import { ConfigStorage } from '@/common/storage';
import { ipcBridge } from '@/common';
import WindowControls from '../../components/WindowControls';
import { useAuth, GUEST_FLAG_KEY } from '../../context/AuthContext';
import AppLoader from '../../components/AppLoader';
import PasswordAuthPanel from './PasswordAuthPanel';
import ThirdPartyAuthPanel from './ThirdPartyAuthPanel';

// Generate a random state token to bind the OAuth2 authorize request to its callback.
function generateOAuth2State(): string {
  const bytes = new Uint8Array(16);
  (globalThis.crypto || window.crypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Windows/Linux 显示自定义窗口按钮；macOS 由系统原生信号灯负责，避免重复
// Windows/Linux render custom window controls; macOS relies on native traffic lights, so skip them to avoid duplicates
const showWindowControls = isElectronDesktop() && !isMacOS();

function LoginShell({ children }: ILoginShellProps) {
  return (
    <main className='relative flex min-h-screen items-center justify-center overflow-x-hidden overflow-y-auto bg-background px-4 py-12 text-foreground [-webkit-app-region:drag]'>
      {showWindowControls && (
        <div className='fixed right-0 top-0 z-50 h-8 [-webkit-app-region:no-drag]'>
          <WindowControls />
        </div>
      )}
      <div aria-hidden='true' className='pointer-events-none absolute inset-0 overflow-hidden'>
        <div className='absolute -left-32 -top-40 h-96 w-96 rounded-full bg-secondary opacity-80 blur-3xl' />
        <div className='absolute -bottom-40 -right-32 h-96 w-96 rounded-full bg-accent opacity-70 blur-3xl' />
      </div>
      {children}
    </main>
  );
}

function LoginHeader({ appName, description, logo }: ILoginHeaderProps) {
  return (
    <header className='mb-7 text-center'>
      <div className='mx-auto mb-5 flex h-18 w-18 items-center justify-center rounded-xl bg-secondary shadow-sm'>
        <img src={logo || SudoworkIcon} alt={appName} className='h-14 w-14 object-contain' />
      </div>
      <h1 className='text-2xl font-700 tracking-tight text-foreground'>{appName}</h1>
      <p className='mt-2 text-sm leading-6 text-foreground-tertiary'>{description}</p>
    </header>
  );
}

function getTabClass(isActive: boolean): string {
  return `h-9 rounded-md px-3 text-sm font-600 transition-colors ${isActive ? 'bg-card text-foreground shadow-sm' : 'text-foreground-tertiary hover:bg-accent hover:text-accent-foreground'}`;
}

// Validate phone number format (same as server-side)
function isValidPhone(phone: string): boolean {
  if (phone.length === 11) {
    return phone[0] === '1' && /^\d{11}$/.test(phone);
  } else if (phone.length >= 13 && phone[0] === '+') {
    if (!phone.startsWith('+86')) return false;
    const phoneNumber = phone.slice(3);
    return phoneNumber.length === 11 && phoneNumber[0] === '1' && /^\d{11}$/.test(phoneNumber);
  }
  return false;
}

// 从 localStorage 读取缓存的租户配置
function getCachedTenantConfig(): Required<typeof DEFAULT_TENANT_CONFIG> {
  try {
    const cached = localStorage.getItem(TENANT_CONFIG_STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      return resolveCachedTenantConfig(parsed) ?? DEFAULT_TENANT_CONFIG;
    }
  } catch {
    // ignore
  }
  return DEFAULT_TENANT_CONFIG;
}

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { status, enterGuest, login, register, enterpriseLogin, enterpriseLoginWithOAuth2 } = useAuth();
  const { isEnterprise } = useAppMode();
  const { loginMethod, systemConfig } = useSystemLoginMethod();

  // Enterprise login state
  const [loginTab, setLoginTab] = useState<'password' | 'key' | 'oauth2'>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');

  // OAuth2 login state
  // `require_state` defaults to true on the moss side; older moss builds omit
  // the field, so the absence is treated as "verify state" for backwards safety.
  const [oauth2Config, setOauth2Config] = useState<{ enabled: boolean; authorize_url?: string; require_state?: boolean } | null>(null);
  const [oauth2Loading, setOauth2Loading] = useState(false);
  const [oauth2Waiting, setOauth2Waiting] = useState(false);
  const oauth2StateRef = React.useRef<string | null>(null);

  // 从 localStorage 读取缓存的租户配置
  const tenantConfig = getCachedTenantConfig();

  // OAuth2: fetch config from MOSS when the OAuth2 tab is selected
  useEffect(() => {
    if (!isEnterprise || loginTab !== 'oauth2' || oauth2Config) return;
    let cancelled = false;
    setOauth2Loading(true);
    void (async () => {
      try {
        const serverUrl = await ConfigStorage.get('eeclaw.serverUrl');
        if (!serverUrl) {
          if (!cancelled) setOauth2Config({ enabled: false });
          return;
        }
        const res = await ipcBridge.eeclaw.oauth2Config.invoke({ serverUrl });
        if (cancelled) return;
        setOauth2Config(res.success && res.data ? res.data : { enabled: false });
      } finally {
        if (!cancelled) setOauth2Loading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEnterprise, loginTab, oauth2Config]);

  // OAuth2: listen for the sudowork://oauth2-callback deep link and complete login.
  // The provider redirects straight back to the desktop app (no server-side callback page).
  // `sudowork` is the scheme the packaged app registers, so this routes in production.
  useEffect(() => {
    if (!isEnterprise) return;
    return ipcBridge.deepLink.received.on((payload) => {
      if (payload.action !== 'oauth2-callback') return;
      const { state, ...rest } = payload.params || {};
      // When the moss admin has disabled state verification (`require_state: false`),
      // skip the local equality check. Trusted-internal deployments use this to
      // accept logins even when the IdP rewrites or drops `state` on round-trip.
      // We still generate + carry state on the outbound authorize URL for IdP
      // compatibility — only the CSRF check on return is bypassed.
      const verifyState = oauth2Config?.require_state !== false;
      if (verifyState && (!oauth2StateRef.current || state !== oauth2StateRef.current)) {
        setOauth2Waiting(false);
        Message.error('授权回调验证失败,请重试');
        return;
      }
      oauth2StateRef.current = null;
      // Forward ALL non-state params to moss as an opaque dict — supports both
      // standard (code) and non-standard (access_token/refresh_token) providers.
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (typeof v === 'string' && v.length > 0) params[k] = v;
      }
      if (Object.keys(params).length === 0) {
        setOauth2Waiting(false);
        Message.error('OAuth2 登录失败');
        return;
      }
      void (async () => {
        const result = await enterpriseLoginWithOAuth2(params);
        setOauth2Waiting(false);
        if (result.success) {
          setTimeout(() => navigate('/guid', { replace: true }), 300);
        } else {
          Message.error(result.message || 'OAuth2 登录失败');
        }
      })();
    });
  }, [isEnterprise, enterpriseLoginWithOAuth2, navigate, oauth2Config]);

  const handleOAuth2Login = async () => {
    if (!oauth2Config?.enabled || !oauth2Config.authorize_url) return;
    const state = generateOAuth2State();
    oauth2StateRef.current = state;
    // moss returns the authorize URL with {state} placeholder (or none); fill/append it.
    const url = oauth2Config.authorize_url.includes('{state}') ? oauth2Config.authorize_url.replace('{state}', encodeURIComponent(state)) : `${oauth2Config.authorize_url}${oauth2Config.authorize_url.includes('?') ? '&' : '?'}state=${encodeURIComponent(state)}`;
    setOauth2Waiting(true);
    try {
      await ipcBridge.shell.openExternal.invoke(url);
    } catch {
      setOauth2Waiting(false);
      Message.error('无法打开浏览器');
    }
  };

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loginPhone, setLoginPhone] = useState('');
  const [registerPhone, setRegisterPhone] = useState('');
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginCountdown, setLoginCountdown] = useState(0);
  const [registerCountdown, setRegisterCountdown] = useState(0);
  // 保存注册凭证，避免重复验证验证码
  const [savedRegisterToken, setSavedRegisterToken] = useState<string | null>(null);

  // 固定企业码
  const ENTERPRISE_CODE = 'sudo';

  const [statusMsg, setStatusMsg] = useState<{ text: string; sub: string; type?: string } | null>(null);

  // 允许页面滚动（覆盖 index.html 的 overflow: hidden）
  useEffect(() => {
    const root = document.getElementById('root');
    const originalBodyOverflow = document.body.style.overflow;
    const originalRootOverflow = root?.style.overflow;

    document.body.style.overflow = 'auto';
    if (root) root.style.overflow = 'auto';

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      if (root) root.style.overflow = originalRootOverflow || '';
    };
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      void navigate('/guid', { replace: true });
    }
  }, [navigate, status]);

  // 页面加载时重置倒计时
  useEffect(() => {
    setLoginCountdown(0);
    setRegisterCountdown(0);
  }, []);

  // 手机号变化时清除 register_token（token 绑定特定手机号）
  const handlePhoneChange = (value: string) => {
    if (mode === 'login') {
      setLoginPhone(value);
    } else {
      setRegisterPhone(value);
    }
    if (savedRegisterToken) {
      setSavedRegisterToken(null);
    }
  };

  const currentPhone = mode === 'login' ? loginPhone : registerPhone;

  // 倒计时定时器
  useEffect(() => {
    const timer = setInterval(() => {
      setLoginCountdown((prev) => (prev > 0 ? prev - 1 : 0));
      setRegisterCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSendCode = async () => {
    if (!isValidPhone(currentPhone)) {
      Message.error('请输入正确的 11 位手机号');
      return;
    }

    // 发送新验证码时清除旧的 register_token
    setSavedRegisterToken(null);

    setLoading(true);
    try {
      const res = await fetch(`${await getSudoworkServerBaseUrl()}/api/v1/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: currentPhone }),
      });

      const data = await res.json();

      if (data.success) {
        Message.success('验证码已发送');
        const nextSendIn = data.next_send_in || 60;
        if (mode === 'login') {
          setLoginCountdown(nextSendIn);
        } else {
          setRegisterCountdown(nextSendIn);
        }
      } else {
        Message.error(data.msg || '发送失败');
      }
    } catch (error) {
      console.error('Failed to send code:', error);
      Message.error('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    // Enterprise mode login
    if (isEnterprise) {
      if (loginTab === 'password') {
        if (!username.trim() || !password.trim()) {
          Message.warning('请填写所有必填项');
          return;
        }
        setLoading(true);
        try {
          const result = await enterpriseLogin({ username: username.trim(), password: password.trim() });
          if (result.success) {
            setTimeout(() => navigate('/guid', { replace: true }), 300);
          } else {
            Message.error(result.message || '登录失败');
          }
        } finally {
          setLoading(false);
        }
      } else {
        if (!apiKey.trim()) {
          Message.warning('请输入 API Key');
          return;
        }
        setLoading(true);
        try {
          const result = await enterpriseLogin({ api_key: apiKey.trim() });
          if (result.success) {
            setTimeout(() => navigate('/guid', { replace: true }), 300);
          } else {
            Message.error(result.message || '登录失败');
          }
        } finally {
          setLoading(false);
        }
      }
      return;
    }

    if (!currentPhone || !code) {
      Message.warning('请填写所有必填项');
      return;
    }

    if (mode === 'register') {
      if (!nickname.trim()) {
        Message.warning('请输入昵称');
        return;
      }
      if (!invitationCode.trim()) {
        Message.warning('请输入邀请码');
        return;
      }
    }

    setLoading(true);

    // 注册模式下，如果已有 register_token，直接注册
    if (mode === 'register' && savedRegisterToken) {
      const regResult = await register({
        register_token: savedRegisterToken,
        nickname: nickname.trim(),
        invitation_code: invitationCode.trim(),
      });

      if (regResult.success) {
        setTimeout(() => navigate('/guid', { replace: true }), 300);
      } else {
        Message.error(regResult.message || '注册失败');

        // 区分错误类型：仅 token 过期时清除，邀请码错误保留 token 允许重试
        const errorMsg = regResult.message || '';
        const isTokenExpired = errorMsg.includes('注册凭证') || errorMsg.includes('过期') || errorMsg.includes('无效');

        if (isTokenExpired) {
          setSavedRegisterToken(null);
          Message.warning('注册凭证已过期，请重新获取验证码');
        }
      }
      setLoading(false);
      return;
    }

    // 否则先验证验证码
    const result = await login({ phone: currentPhone, code, enterprise_code: ENTERPRISE_CODE });

    if (result.success) {
      if (mode === 'register') {
        Message.info('该手机号已注册，已直接登录');
      }
      setTimeout(() => navigate('/guid', { replace: true }), 300);
      setLoading(false);
      return;
    } else {
      const statusCode = result.status;
      const needRegister = result.need_register;
      const registerToken = result.register_token;

      if (needRegister && registerToken) {
        // 保存 register_token 供后续使用
        setSavedRegisterToken(registerToken);

        if (mode === 'register') {
          // 注册模式：直接完成注册
          const regResult = await register({
            register_token: registerToken,
            nickname: nickname.trim(),
            invitation_code: invitationCode.trim(),
          });

          if (regResult.success) {
            setTimeout(() => navigate('/guid', { replace: true }), 300);
          } else {
            Message.error(regResult.message || '注册失败');
            // 仅在 token 过期错误时清除，邀请码错误保留 token 允许重试
            const errorMsg = regResult.message || '';
            if (errorMsg.includes('注册凭证') || errorMsg.includes('过期') || errorMsg.includes('无效')) {
              setSavedRegisterToken(null);
            }
          }
        } else {
          // 登录模式：提示用户切换到注册标签
          Message.info('该手机号未注册，请切换到注册标签完成注册');
          setMode('register');
        }
        setLoading(false);
        return;
      }

      // 处理审核中状态
      if (statusCode === 0) {
        setStatusMsg({
          text: '账号申请已提交',
          sub: result.message || '请联系企业管理员审批通过后重新登录',
          type: 'pending',
        });
      }
      // 处理审核被拒绝状态
      else if (statusCode === 2) {
        setStatusMsg({
          text: '账号审核被拒绝',
          sub: '您的加入申请已被管理员拒绝。点击下方按钮重新提交申请。',
          type: 'rejected',
        });
      } else {
        Message.error(result.message || '登录失败');
      }
    }
    setLoading(false);
  };

  const currentCountdown = mode === 'login' ? loginCountdown : registerCountdown;

  if (status === 'checking') {
    return <AppLoader />;
  }

  if (statusMsg) {
    const isRejected = statusMsg.type === 'rejected';
    return (
      <LoginShell>
        <section className='relative z-1 flex w-full max-w-md flex-col items-center gap-6 rounded-xl border border-border bg-card p-8 text-center text-card-foreground shadow-xl [-webkit-app-region:no-drag] max-sm:p-6'>
          <div className={`flex h-16 w-16 items-center justify-center rounded-full bg-secondary ${isRejected ? 'text-destructive' : 'text-warning'}`}>
            <Protect theme='filled' size={32} />
          </div>
          <div>
            <h2 className='text-xl font-700 text-foreground'>{statusMsg.text}</h2>
            <p className='mt-2 px-5 text-sm leading-6 text-foreground-tertiary'>{statusMsg.sub}</p>
          </div>
          {isRejected ? (
            <Button
              type='primary'
              long
              className='mt-1 h-12 rounded-lg!'
              onClick={() => {
                setStatusMsg(null);
                // 自动重新提交申请
                setTimeout(() => {
                  const form = document.querySelector('form');
                  if (form) {
                    const submitEvent = new SubmitEvent('submit', { bubbles: true, cancelable: true });
                    form.dispatchEvent(submitEvent);
                  }
                }, 100);
              }}
            >
              重新申请
            </Button>
          ) : (
            <Button long className='mt-1 h-12 rounded-lg!' onClick={() => setStatusMsg(null)}>
              返回登录
            </Button>
          )}
        </section>
      </LoginShell>
    );
  }

  // Enterprise mode: return mode selection handler
  const handleBackToModeSelect = async () => {
    try {
      // Clear all enterprise-related ConfigStorage keys
      await ConfigStorage.set('eeclaw.authStorage', undefined);
      await ConfigStorage.set('eeclaw.userInfo', undefined);
      await ConfigStorage.set('eeclaw.serverUrl', undefined);
      await ConfigStorage.set('eeclaw.tenantName', undefined);
      await ConfigStorage.set('system.appMode', undefined);
      // Clear enterprise auth from localStorage
      localStorage.removeItem('eeclaw_auth_v1');
      localStorage.removeItem(TENANT_CONFIG_STORAGE_KEY);
      // Clear C-side auth to avoid falling into authenticated state
      localStorage.removeItem('sudowork_auth_v2');
      localStorage.removeItem('sudowork_auth_v1');
      localStorage.removeItem(GUEST_FLAG_KEY);
      // Reload page instead of restarting app
      window.location.reload();
    } catch (error) {
      console.error('[LoginPage] Failed to reset mode:', error);
    }
  };

  // Enterprise login UI
  if (isEnterprise) {
    return (
      <LoginShell>
        <section className='relative z-1 my-auto w-full max-w-md rounded-xl border border-border bg-card p-8 text-card-foreground shadow-xl [-webkit-app-region:no-drag] max-sm:p-6'>
          <LoginHeader appName={tenantConfig.app_name} description={tenantConfig.login_desp} logo={tenantConfig.logo} />

          <div className='grid grid-cols-3 gap-1 rounded-lg bg-secondary p-1' role='tablist'>
            <button type='button' role='tab' className={getTabClass(loginTab === 'password')} aria-selected={loginTab === 'password'} onClick={() => setLoginTab('password')}>
              密码登录
            </button>
            <button type='button' role='tab' className={getTabClass(loginTab === 'key')} aria-selected={loginTab === 'key'} onClick={() => setLoginTab('key')}>
              密钥登录
            </button>
            <button type='button' role='tab' className={getTabClass(loginTab === 'oauth2')} aria-selected={loginTab === 'oauth2'} onClick={() => setLoginTab('oauth2')}>
              OAuth2 登录
            </button>
          </div>

          <div className='mt-6 flex flex-col gap-5'>
            {loginTab === 'password' ? (
              <>
                <div className='flex flex-col gap-2'>
                  <div className='ml-1 text-sm font-600 text-foreground-secondary'>用户名</div>
                  <Input size='large' prefix={<User className='text-muted-foreground' />} placeholder='请输入用户名' value={username} onChange={setUsername} className='h-12 rounded-lg!' />
                </div>
                <div className='flex flex-col gap-2'>
                  <div className='ml-1 text-sm font-600 text-foreground-secondary'>密码</div>
                  <Input.Password size='large' prefix={<Lock className='text-muted-foreground' />} placeholder='请输入密码' value={password} onChange={setPassword} className='h-12 rounded-lg!' />
                </div>
              </>
            ) : loginTab === 'key' ? (
              <div className='flex flex-col gap-2'>
                <div className='ml-1 text-sm font-600 text-foreground-secondary'>API Key</div>
                <Input size='large' prefix={<Key className='text-muted-foreground' />} placeholder='moss_sk_xxx.yyy' value={apiKey} onChange={setApiKey} className='h-12 rounded-lg!' />
              </div>
            ) : (
              <div className='rounded-lg bg-muted px-4 py-5 text-center text-sm leading-6 text-muted-foreground'>{oauth2Loading ? '正在检查 OAuth2 配置…' : oauth2Config?.enabled ? '点击下方按钮，将在浏览器中完成身份认证。' : '管理员未启用 OAuth2 登录'}</div>
            )}

            {loginTab === 'oauth2' ? (
              <Button type='primary' size='large' loading={oauth2Waiting} disabled={oauth2Loading || !oauth2Config?.enabled} onClick={() => handleOAuth2Login()} className='mt-1 h-12 rounded-lg! text-base font-600'>
                {oauth2Waiting ? '等待浏览器授权…' : '通过浏览器登录'}
              </Button>
            ) : (
              <Button type='primary' size='large' loading={loading} onClick={() => handleSubmit()} className='mt-1 h-12 rounded-lg! text-base font-600'>
                登录
              </Button>
            )}

            <Button type='text' size='small' className='mx-auto text-foreground-tertiary! hover:text-foreground-secondary!' onClick={handleBackToModeSelect}>
              ← 返回模式选择
            </Button>
          </div>
        </section>
      </LoginShell>
    );
  }

  // C 端：登录方式探测中（避免手机/密码面板闪烁）
  if (loginMethod === null) {
    return <AppLoader />;
  }

  // C 端：用户名密码登录方式（login_method=1）
  if (loginMethod === 1) {
    return (
      <LoginShell>
        <PasswordAuthPanel appName={tenantConfig.app_name} logo={tenantConfig.logo} defaultLogo={SudoworkIcon} onBackToModeSelect={handleBackToModeSelect} />
      </LoginShell>
    );
  }

  // C 端：三方认证登录方式（login_method=2）
  if (loginMethod === 2) {
    return (
      <LoginShell>
        <ThirdPartyAuthPanel appName={tenantConfig.app_name} logo={tenantConfig.logo} defaultLogo={SudoworkIcon} systemConfig={systemConfig} onBackToModeSelect={handleBackToModeSelect} />
      </LoginShell>
    );
  }

  return (
    <LoginShell>
      <section className='relative z-1 my-auto w-full max-w-md rounded-xl border border-border bg-card p-8 text-card-foreground shadow-xl [-webkit-app-region:no-drag] max-sm:p-6'>
        <LoginHeader appName={tenantConfig.app_name} description={tenantConfig.login_desp} logo={tenantConfig.logo} />

        <div className='grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1' role='tablist'>
          <button type='button' role='tab' className={getTabClass(mode === 'login')} aria-selected={mode === 'login'} onClick={() => setMode('login')}>
            登录
          </button>
          <button type='button' role='tab' className={getTabClass(mode === 'register')} aria-selected={mode === 'register'} onClick={() => setMode('register')}>
            注册
          </button>
        </div>

        <div className='mt-6 flex flex-col gap-5'>
          <div className='flex flex-col gap-2'>
            <div className='ml-1 text-sm font-600 text-foreground-secondary'>手机号码</div>
            <Input size='large' prefix={<Phone className='text-muted-foreground' />} placeholder='11 位手机号' value={currentPhone} onChange={handlePhoneChange} className='h-12 rounded-lg!' />
          </div>

          <div className='flex flex-col gap-2'>
            <div className='ml-1 text-sm font-600 text-foreground-secondary'>身份验证</div>
            <div className='flex gap-2'>
              <Input size='large' prefix={<Key className='text-muted-foreground' />} placeholder='6 位验证码' value={code} onChange={setCode} className='h-12 min-w-0 flex-1 rounded-lg!' />
              <Button size='large' disabled={currentCountdown > 0} onClick={handleSendCode} className='h-12 min-w-28 rounded-lg! font-600'>
                {currentCountdown > 0 ? `${currentCountdown}s` : '发送验证码'}
              </Button>
            </div>
          </div>

          {mode === 'register' && (
            <>
              <div className='flex flex-col gap-2'>
                <div className='ml-1 text-sm font-600 text-foreground-secondary'>昵称</div>
                <Input size='large' prefix={<User className='text-muted-foreground' />} placeholder='请输入您的昵称' value={nickname} onChange={setNickname} className='h-12 rounded-lg!' maxLength={20} />
              </div>

              <div className='flex flex-col gap-2'>
                <div className='ml-1 text-sm font-600 text-foreground-secondary'>邀请码</div>
                <Input size='large' prefix={<Protect className='text-muted-foreground' />} placeholder='请输入 6 位邀请码' value={invitationCode} onChange={setInvitationCode} className='h-12 rounded-lg!' maxLength={6} />
              </div>
            </>
          )}

          <Button type='primary' size='large' loading={loading} onClick={() => handleSubmit()} className='mt-1 h-12 rounded-lg! text-base font-600'>
            {mode === 'login' ? '登录' : '注册'}
          </Button>

          <div className='flex items-center justify-center gap-2'>
            <Button type='text' size='small' className='text-foreground-tertiary! hover:text-foreground-secondary!' onClick={handleBackToModeSelect}>
              ← 返回模式选择
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
        </div>
      </section>
    </LoginShell>
  );
};

interface ILoginShellProps {
  children: React.ReactNode;
}

interface ILoginHeaderProps {
  appName: string;
  description: string;
  logo?: string;
}

export default LoginPage;
