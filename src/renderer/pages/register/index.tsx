/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input, Message } from '@arco-design/web-react';
import { ShieldCheck, User } from 'lucide-react';
import { useTenantLogo } from '@/renderer/hooks/useTenantLogo';
import { useTenantStore } from '@/renderer/stores/useTenantStore';
import { useAuth } from '../../context/AuthContext';

function AionLogoMark() {
  const logo = useTenantLogo();
  return <img src={logo} alt='' className='h-14 w-14 object-contain' />;
}

const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { register } = useAuth();
  const appName = useTenantStore((state) => state.appName);

  // 从 URL 参数获取 register_token 和 phone
  const registerToken = searchParams.get('token') || '';
  const phoneFromUrl = searchParams.get('phone') || '';

  const [nickname, setNickname] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [loading, setLoading] = useState(false);

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

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!nickname.trim()) {
      Message.warning('请输入昵称');
      return;
    }

    if (!invitationCode.trim()) {
      Message.warning('请输入邀请码');
      return;
    }

    if (!registerToken) {
      Message.error('注册凭证无效，请重新登录');
      void navigate('/login', { replace: true });
      return;
    }

    setLoading(true);
    const result = await register({
      register_token: registerToken,
      nickname: nickname.trim(),
      invitation_code: invitationCode.trim(),
    });

    if (result.success) {
      setTimeout(() => navigate('/guid', { replace: true }), 300);
    } else {
      Message.error(result.message || '注册失败');
    }
    setLoading(false);
  };

  // 如果没有 register_token，跳转到登录页
  if (!registerToken) {
    return (
      <main className='relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground'>
        <section className='relative z-1 flex w-full max-w-md flex-col items-center gap-6 rounded-xl border border-border bg-card p-8 text-center text-card-foreground shadow-xl max-sm:p-6'>
          <div className='flex h-16 w-16 items-center justify-center rounded-full bg-secondary text-destructive'>
            <ShieldCheck size={32} />
          </div>
          <div>
            <h2 className='text-xl font-700 text-foreground'>注册链接无效</h2>
            <p className='mt-2 px-5 text-sm text-foreground-tertiary'>请重新获取验证码登录</p>
          </div>
          <Button type='primary' long className='mt-1 h-12 rounded-lg!' onClick={() => navigate('/login', { replace: true })}>
            返回登录
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className='relative flex min-h-screen items-center justify-center overflow-x-hidden overflow-y-auto bg-background px-4 py-12 text-foreground'>
      <div aria-hidden='true' className='pointer-events-none absolute inset-0 overflow-hidden'>
        <div className='absolute -left-32 -top-40 h-96 w-96 rounded-full bg-secondary opacity-80 blur-3xl' />
        <div className='absolute -bottom-40 -right-32 h-96 w-96 rounded-full bg-accent opacity-70 blur-3xl' />
      </div>

      <section className='relative z-1 my-auto w-full max-w-md rounded-xl border border-border bg-card p-8 text-card-foreground shadow-xl max-sm:p-6'>
        <header className='mb-7 text-center'>
          <div className='mx-auto mb-5 flex h-18 w-18 items-center justify-center rounded-xl bg-secondary shadow-sm'>
            <AionLogoMark />
          </div>
          <h1 className='text-2xl font-700 tracking-tight text-foreground'>{appName}</h1>
          <p className='mt-2 text-sm text-foreground-tertiary'>完成注册，开始使用</p>
        </header>

        <div className='flex flex-col gap-5'>
          <div className='flex flex-col gap-2'>
            <div className='ml-1 text-sm font-600 text-foreground-secondary'>手机号码</div>
            <Input size='large' prefix={<User size={18} />} value={phoneFromUrl} disabled className='h-12 rounded-lg!' />
          </div>

          <div className='flex flex-col gap-2'>
            <div className='ml-1 text-sm font-600 text-foreground-secondary'>昵称</div>
            <Input size='large' prefix={<User size={18} />} placeholder='请输入您的昵称' value={nickname} onChange={setNickname} className='h-12 rounded-lg!' maxLength={20} />
          </div>

          <div className='flex flex-col gap-2'>
            <div className='ml-1 text-sm font-600 text-foreground-secondary'>邀请码</div>
            <Input size='large' prefix={<ShieldCheck size={18} />} placeholder='请输入 6 位邀请码' value={invitationCode} onChange={setInvitationCode} className='h-12 rounded-lg!' maxLength={6} />
          </div>

          <Button type='primary' size='large' loading={loading} onClick={() => handleSubmit()} className='mt-1 h-12 rounded-lg! text-base font-600'>
            完成注册
          </Button>

          <Button size='large' onClick={() => navigate('/login', { replace: true })} className='h-12 rounded-lg!'>
            返回登录
          </Button>
        </div>
      </section>
    </main>
  );
};

export default RegisterPage;
