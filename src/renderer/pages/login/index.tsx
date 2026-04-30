import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLoader from '../../components/AppLoader';
import { useAuth } from '../../context/AuthContext';
import { Button, Input, Message, Space } from '@arco-design/web-react';
import { Phone, Protect, Key, User, Lock } from '@icon-park/react';
import { SUDOWORK_SERVER_BASE_URL } from '@/common/sudoworkServer';
import { DEFAULT_TENANT_CONFIG } from '@/common/types/tenantConfig';
import SudoworkIcon from '@/renderer/assets/sudowork-icon-dark.svg';
import WindowControls from '../../components/WindowControls';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { ConfigStorage } from '@/common/storage';
import './LoginPage.css';

// 运行时判断 / Runtime check
const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.electronAPI);

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
    const cached = localStorage.getItem('sudowork_tenant_config');
    if (cached) {
      const parsed = JSON.parse(cached);
      return { ...DEFAULT_TENANT_CONFIG, ...parsed };
    }
  } catch {
    // ignore
  }
  return DEFAULT_TENANT_CONFIG;
}

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { status, login, register, enterpriseLogin, logout } = useAuth();
  const { isEnterprise } = useAppMode();

  // Enterprise login state
  const [loginTab, setLoginTab] = useState<'password' | 'key'>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [tenantName, setTenantName] = useState<string>('');

  // 从 localStorage 读取缓存的租户配置
  const tenantConfig = getCachedTenantConfig();

  // Enterprise: load tenantName on mount
  useEffect(() => {
    if (isEnterprise) {
      ConfigStorage.get('eeclaw.tenantName').then(setTenantName);
    }
  }, [isEnterprise]);

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
      const res = await fetch(`${SUDOWORK_SERVER_BASE_URL}/api/v1/auth/send-code`, {
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
        if (!publicKey.trim()) {
          Message.warning('请输入密钥');
          return;
        }
        setLoading(true);
        try {
          const result = await enterpriseLogin({ public_key: publicKey.trim() });
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
    return (
      <div className='login-page'>
        <div className='login-page__card text-center flex flex-col items-center gap-24px py-48px'>
          <div className={`w-64px h-64px rd-full flex items-center justify-center ${statusMsg.type === 'rejected' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'}`}>
            <Protect theme='filled' size={32} />
          </div>
          <div>
            <h2 className='text-20px font-700 text-t-primary'>{statusMsg.text}</h2>
            <p className='text-14px text-t-secondary mt-8px px-20px'>{statusMsg.sub}</p>
          </div>
          {statusMsg.type === 'rejected' ? (
            <Button
              type='primary'
              long
              className='!rd-12px h-48px mt-12px'
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
            <Button long className='!rd-12px h-48px mt-12px' onClick={() => setStatusMsg(null)}>
              返回登录
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Enterprise mode: return mode selection handler
  const handleBackToModeSelect = async () => {
    try {
      // Clear all enterprise-related ConfigStorage keys
      await ConfigStorage.remove('eeclaw.authStorage' as any);
      await ConfigStorage.remove('eeclaw.userInfo' as any);
      await ConfigStorage.remove('eeclaw.serverUrl' as any);
      await ConfigStorage.remove('eeclaw.tenantName' as any);
      await ConfigStorage.remove('system.appMode' as any);
      // Clear enterprise auth from localStorage
      localStorage.removeItem('eeclaw_auth_v1');
      // Clear C-side auth to avoid falling into authenticated state
      localStorage.removeItem('sudowork_auth_v2');
      localStorage.removeItem('sudowork_auth_v1');
      // Reload page instead of restarting app
      window.location.reload();
    } catch (error) {
      console.error('[LoginPage] Failed to reset mode:', error);
    }
  };

  // Enterprise login UI
  if (isEnterprise) {
    return (
      <div className='login-page'>
        {isDesktopRuntime && <WindowControls />}

        <div className='login-page__background'>
          <div className='login-page__background-circle login-page__background-circle--lg' />
          <div className='login-page__background-circle login-page__background-circle--md' />
          <div className='login-page__background-circle login-page__background-circle--sm' />
        </div>

        <div className='login-page__card'>
          <div className='login-page__header'>
            <div className='login-page__logo'>
              <img
                src={SudoworkIcon}
                alt={tenantName || 'SudoClaw'}
                className='w-64px h-64px object-contain'
              />
            </div>
            <h1 className='text-28px font-800 tracking-tighter bg-gradient-to-br from-primary to-purple-600 bg-clip-text text-transparent mb-8px'>{tenantName || 'SudoClaw'}</h1>
            <p className='text-13px text-t-secondary'>企业版登录</p>
          </div>

          {/* Enterprise login tabs: password / key */}
          <div className='login-tabs'>
            <button type='button' className={`login-tab ${loginTab === 'password' ? 'login-tab--active' : ''}`} onClick={() => setLoginTab('password')}>
              密码登录
            </button>
            <button type='button' className={`login-tab ${loginTab === 'key' ? 'login-tab--active' : ''}`} onClick={() => setLoginTab('key')}>
              密钥登录
            </button>
          </div>

          <div className='flex flex-col gap-20px mt-24px'>
            {loginTab === 'password' ? (
              <>
                <div className='flex flex-col gap-8px'>
                  <div className='text-12px font-600 text-t-secondary ml-4px'>用户名</div>
                  <Input size='large' prefix={<User className='text-t-tertiary' />} placeholder='请输入用户名' value={username} onChange={setUsername} className='login-input !rd-12px h-48px' />
                </div>
                <div className='flex flex-col gap-8px'>
                  <div className='text-12px font-600 text-t-secondary ml-4px'>密码</div>
                  <Input.Password size='large' prefix={<Lock className='text-t-tertiary' />} placeholder='请输入密码' value={password} onChange={setPassword} className='login-input !rd-12px h-48px' />
                </div>
              </>
            ) : (
              <div className='flex flex-col gap-8px'>
                <div className='text-12px font-600 text-t-secondary ml-4px'>公钥</div>
                <Input size='large' prefix={<Key className='text-t-tertiary' />} placeholder='请输入公钥' value={publicKey} onChange={setPublicKey} className='login-input !rd-12px h-48px' />
              </div>
            )}

            <Button type='primary' size='large' loading={loading} onClick={() => handleSubmit()} className='login-btn-primary !rd-12px h-52px mt-12px font-700 text-16px'>
              登录
            </Button>
          </div>

          {/* Back to mode selection */}
          <div className='text-center mt-20px'>
            <button type='button' className='text-13px text-t-tertiary hover:text-t-primary cursor-pointer bg-transparent border-none' onClick={() => void handleBackToModeSelect()}>
              返回模式选择
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='login-page'>
      {/* 桌面端窗口控制按钮 / Window controls for desktop */}
      {isDesktopRuntime && <WindowControls />}

      {/* 装饰性背景 */}
      <div className='login-page__background'>
        <div className='login-page__background-circle login-page__background-circle--lg' />
        <div className='login-page__background-circle login-page__background-circle--md' />
        <div className='login-page__background-circle login-page__background-circle--sm' />
      </div>

      <div className='login-page__card'>
        <div className='login-page__header'>
          <div className='login-page__logo'>
            <img
              src={tenantConfig.logo || SudoworkIcon}
              alt={tenantConfig.app_name}
              className='w-64px h-64px object-contain'
            />
          </div>
          <h1 className='text-28px font-800 tracking-tighter bg-gradient-to-br from-primary to-purple-600 bg-clip-text text-transparent mb-8px'>{tenantConfig.app_name}</h1>
          <p className='text-13px text-t-secondary'>{tenantConfig.login_desp}</p>
        </div>

        {/* Tab switcher */}
        <div className='login-tabs'>
          <button type='button' className={`login-tab ${mode === 'login' ? 'login-tab--active' : ''}`} onClick={() => setMode('login')}>
            登录
          </button>
          <button type='button' className={`login-tab ${mode === 'register' ? 'login-tab--active' : ''}`} onClick={() => setMode('register')}>
            注册
          </button>
        </div>

        <div className='flex flex-col gap-20px mt-24px'>
          <div className='flex flex-col gap-8px'>
            <div className='text-12px font-600 text-t-secondary ml-4px'>手机号码</div>
            <Input size='large' prefix={<Phone className='text-t-tertiary' />} placeholder='11 位手机号' value={currentPhone} onChange={handlePhoneChange} className='login-input !rd-12px h-48px' />
          </div>

          <div className='flex flex-col gap-8px'>
            <div className='text-12px font-600 text-t-secondary ml-4px'>身份验证</div>
            <Space size='small' className='w-full'>
              <Input size='large' prefix={<Key className='text-t-tertiary' />} placeholder='6 位验证码' value={code} onChange={setCode} className='login-input !rd-12px h-48px flex-1' />
              <Button size='large' disabled={currentCountdown > 0} onClick={handleSendCode} className='!rd-8px h-48px font-600 min-w-120px'>
                {currentCountdown > 0 ? `${currentCountdown}s` : '发送验证码'}
              </Button>
            </Space>
          </div>

          {mode === 'register' && (
            <>
              <div className='flex flex-col gap-8px'>
                <div className='text-12px font-600 text-t-secondary ml-4px'>昵称</div>
                <Input size='large' prefix={<User className='text-t-tertiary' />} placeholder='请输入您的昵称' value={nickname} onChange={setNickname} className='login-input !rd-12px h-48px' maxLength={20} />
              </div>

              <div className='flex flex-col gap-8px'>
                <div className='text-12px font-600 text-t-secondary ml-4px'>邀请码</div>
                <Input size='large' prefix={<Protect className='text-t-tertiary' />} placeholder='请输入 6 位邀请码' value={invitationCode} onChange={setInvitationCode} className='login-input !rd-12px h-48px' maxLength={6} />
              </div>
            </>
          )}

          <Button type='primary' size='large' loading={loading} onClick={() => handleSubmit()} className='login-btn-primary !rd-12px h-52px mt-12px font-700 text-16px'>
            {mode === 'login' ? '登录' : '注册'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
