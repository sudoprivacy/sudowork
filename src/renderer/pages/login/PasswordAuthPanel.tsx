import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Message } from '@arco-design/web-react';
import { User, Lock, Ticket } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { validatePassword } from '@/renderer/utils/passwordValidation';
import { useAuth } from '../../context/AuthContext';
import './LoginPage.css';

interface PasswordAuthPanelProps {
  appName: string;
  logo?: string;
  defaultLogo: string;
}

/**
 * 用户名密码 登录/注册面板（system login_method=1 时由 LoginPage 渲染）。
 * 自包含，不与手机验证码逻辑交织；登录/注册成功复用 AuthContext 的 handleLoginSuccess。
 */
const PasswordAuthPanel: React.FC<PasswordAuthPanelProps> = ({ appName, logo, defaultLogo }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { loginByPassword, registerByPassword } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!account.trim()) {
      Message.warning(t('login.pwdAccountRequired'));
      return;
    }
    if (!password) {
      Message.warning(t('login.pwdPasswordRequired'));
      return;
    }
    setLoading(true);
    try {
      const result = await loginByPassword({ phone: account.trim(), password });
      if (result.success) {
        setTimeout(() => navigate('/guid', { replace: true }), 300);
      } else {
        Message.error(result.message || t('login.pwdLoginFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!account.trim()) {
      Message.warning(t('login.pwdAccountRequired'));
      return;
    }
    if (!password) {
      Message.warning(t('login.pwdPasswordRequired'));
      return;
    }
    const pwdError = validatePassword(password);
    if (pwdError) {
      Message.error(t(pwdError));
      return;
    }
    if (!invitationCode.trim()) {
      Message.warning(t('login.pwdInvitationCodeRequired'));
      return;
    }
    // 昵称为空时用账号兜底（后端 nickname 必填）
    const finalNickname = nickname.trim() || account.trim();
    setLoading(true);
    try {
      const result = await registerByPassword({
        phone: account.trim(),
        password,
        nickname: finalNickname,
        invitation_code: invitationCode.trim(),
      });
      if (result.success) {
        setTimeout(() => navigate('/guid', { replace: true }), 300);
      } else {
        Message.error(result.message || t('login.pwdRegisterFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    if (mode === 'login') void handleLogin();
    else void handleRegister();
  };

  return (
    <div className='login-page__card'>
      <div className='login-page__header'>
        <div className='login-page__logo'>
          <img src={logo || defaultLogo} alt={appName} className='w-64px h-64px object-contain' />
        </div>
        <h1 className='text-28px font-800 tracking-tighter bg-gradient-to-br from-primary to-purple-600 bg-clip-text text-transparent mb-8px'>{appName}</h1>
        <p className='text-13px text-secondary'>{t('login.pwdSubtitle')}</p>
      </div>

      <div className='login-tabs'>
        <button type='button' className={`login-tab ${mode === 'login' ? 'login-tab--active' : ''}`} onClick={() => setMode('login')}>
          {t('login.pwdLoginTab')}
        </button>
        <button type='button' className={`login-tab ${mode === 'register' ? 'login-tab--active' : ''}`} onClick={() => setMode('register')}>
          {t('login.pwdRegisterTab')}
        </button>
      </div>

      <div className='flex flex-col gap-20px mt-24px'>
        <div className='flex flex-col gap-8px'>
          <div className='text-12px font-600 text-secondary ml-4px'>{t('login.pwdAccountLabel')}</div>
          <Input size='large' prefix={<User className='text-tertiary' />} placeholder={t('login.pwdAccountPlaceholder')} value={account} onChange={setAccount} maxLength={50} className='login-input !rd-12px h-48px' />
        </div>

        <div className='flex flex-col gap-8px'>
          <div className='text-12px font-600 text-secondary ml-4px'>{t('login.pwdPasswordLabel')}</div>
          <Input.Password size='large' prefix={<Lock className='text-tertiary' />} placeholder={mode === 'login' ? t('login.pwdPasswordPlaceholder') : t('login.pwdRegisterPasswordPlaceholder')} value={password} onChange={setPassword} maxLength={20} className='login-input !rd-12px h-48px' />
          {mode === 'register' && <div className='text-12px text-tertiary ml-4px'>{t('login.pwdRuleHint')}</div>}
        </div>

        {mode === 'register' && (
          <>
            <div className='flex flex-col gap-8px'>
              <div className='text-12px font-600 text-secondary ml-4px'>
                {t('login.pwdNicknameLabel')} <span className='text-tertiary text-11px font-500'>{t('login.pwdNicknameOptional')}</span>
              </div>
              <Input size='large' prefix={<User className='text-tertiary' />} placeholder={t('login.pwdNicknamePlaceholder')} value={nickname} onChange={setNickname} maxLength={50} className='login-input !rd-12px h-48px' />
            </div>
            <div className='flex flex-col gap-8px'>
              <div className='text-12px font-600 text-secondary ml-4px'>{t('login.pwdInvitationCodeLabel')}</div>
              <Input size='large' prefix={<Ticket className='text-tertiary' />} placeholder={t('login.pwdInvitationCodePlaceholder')} value={invitationCode} onChange={setInvitationCode} maxLength={50} className='login-input !rd-12px h-48px' />
            </div>
          </>
        )}

        <Button type='primary' size='large' loading={loading} onClick={handleSubmit} className='login-btn-primary !rd-12px h-52px mt-12px font-700 text-16px'>
          {mode === 'login' ? t('login.pwdLoginBtn') : t('login.pwdRegisterBtn')}
        </Button>

        {mode === 'login' && <div className='text-center text-12px text-tertiary mt-12px'>{t('login.pwdFootNote')}</div>}
      </div>
    </div>
  );
};

export default PasswordAuthPanel;
