/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Message } from '@arco-design/web-react';
import { Lock, Ticket, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { validatePassword } from '@/renderer/utils/passwordValidation';
import { useAuth } from '../../context/AuthContext';

/**
 * 用户名密码 登录/注册面板（system login_method=1 时由 LoginPage 渲染）。
 * 自包含，不与手机验证码逻辑交织；登录/注册成功复用 AuthContext 的 handleLoginSuccess。
 */
export default function PasswordAuthPanel({ appName, logo, defaultLogo, onBackToModeSelect }: IPasswordAuthPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { enterGuest, loginByPassword, registerByPassword } = useAuth();

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
    <section className='relative z-1 my-auto w-full max-w-md rounded-xl border border-border bg-card p-8 text-card-foreground shadow-xl [-webkit-app-region:no-drag] max-sm:p-6'>
      <header className='mb-7 text-center'>
        <div className='mx-auto mb-5 flex h-18 w-18 items-center justify-center rounded-xl bg-secondary shadow-sm'>
          <img src={logo || defaultLogo} alt={appName} className='h-14 w-14 object-contain' />
        </div>
        <h1 className='text-2xl font-700 tracking-tight text-foreground'>{appName}</h1>
        <p className='mt-2 text-sm leading-6 text-foreground-tertiary'>{t('login.pwdSubtitle')}</p>
      </header>

      <div className='grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1' role='tablist'>
        <button type='button' role='tab' className={getTabClass(mode === 'login')} aria-selected={mode === 'login'} onClick={() => setMode('login')}>
          {t('login.pwdLoginTab')}
        </button>
        <button type='button' role='tab' className={getTabClass(mode === 'register')} aria-selected={mode === 'register'} onClick={() => setMode('register')}>
          {t('login.pwdRegisterTab')}
        </button>
      </div>

      <div className='mt-6 flex flex-col gap-5'>
        <div className='flex flex-col gap-2'>
          <div className='ml-1 text-sm font-600 text-foreground-secondary'>{t('login.pwdAccountLabel')}</div>
          <Input size='large' prefix={<User size={18} />} placeholder={t('login.pwdAccountPlaceholder')} value={account} onChange={setAccount} maxLength={50} className='h-12 rounded-lg!' />
        </div>

        <div className='flex flex-col gap-2'>
          <div className='ml-1 text-sm font-600 text-foreground-secondary'>{t('login.pwdPasswordLabel')}</div>
          <Input.Password size='large' prefix={<Lock size={18} />} placeholder={mode === 'login' ? t('login.pwdPasswordPlaceholder') : t('login.pwdRegisterPasswordPlaceholder')} value={password} onChange={setPassword} maxLength={20} className='h-12 rounded-lg!' />
          {mode === 'register' && <div className='ml-1 text-xs leading-5 text-muted-foreground'>{t('login.pwdRuleHint')}</div>}
        </div>

        {mode === 'register' && (
          <>
            <div className='flex flex-col gap-2'>
              <div className='ml-1 text-sm font-600 text-foreground-secondary'>
                {t('login.pwdNicknameLabel')} <span className='text-xs font-500 text-muted-foreground'>{t('login.pwdNicknameOptional')}</span>
              </div>
              <Input size='large' prefix={<User size={18} />} placeholder={t('login.pwdNicknamePlaceholder')} value={nickname} onChange={setNickname} maxLength={50} className='h-12 rounded-lg!' />
            </div>
            <div className='flex flex-col gap-2'>
              <div className='ml-1 text-sm font-600 text-foreground-secondary'>{t('login.pwdInvitationCodeLabel')}</div>
              <Input size='large' prefix={<Ticket size={18} />} placeholder={t('login.pwdInvitationCodePlaceholder')} value={invitationCode} onChange={setInvitationCode} maxLength={50} className='h-12 rounded-lg!' />
            </div>
          </>
        )}

        <Button type='primary' size='large' loading={loading} onClick={handleSubmit} className='mt-1 h-12 rounded-lg! text-base font-600'>
          {mode === 'login' ? t('login.pwdLoginBtn') : t('login.pwdRegisterBtn')}
        </Button>

        {mode === 'login' && <div className='text-center text-xs leading-5 text-muted-foreground'>{t('login.pwdFootNote')}</div>}

        {onBackToModeSelect && (
          <div className='flex items-center justify-center gap-2'>
            <Button type='text' size='small' className='text-foreground-tertiary! hover:text-foreground-secondary!' onClick={onBackToModeSelect}>
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
        )}
      </div>
    </section>
  );
}

function getTabClass(isActive: boolean): string {
  return `h-9 rounded-md px-3 text-sm font-600 transition-colors ${isActive ? 'bg-card text-foreground shadow-sm' : 'text-foreground-tertiary hover:bg-accent hover:text-accent-foreground'}`;
}

interface IPasswordAuthPanelProps {
  appName: string;
  logo?: string;
  defaultLogo: string;
  onBackToModeSelect?: () => void;
}
