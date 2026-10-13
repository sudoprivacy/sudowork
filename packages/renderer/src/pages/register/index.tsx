/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Input, Message } from '@arco-design/web-react';
import { User, Protect } from '@icon-park/react';
import SudoworkIcon from '@renderer/assets/sudowork-icon-dark.svg';
import { invokePark } from '@renderer/hooks/usePark';
import '../login/LoginPage.css';

const AionLogoMark: React.FC = () => <img src={SudoworkIcon} alt='Sudowork' className='w-64px h-64px object-contain' />;

const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  // Legacy route retained for bookmarked links; registration now requires the
  // phone verification code directly and normally lives on the login page.
  const codeFromUrl = searchParams.get('code') || '';
  const phoneFromUrl = searchParams.get('phone') || '';

  const [nickname, setNickname] = useState('');
  const [enterpriseName, setEnterpriseName] = useState('');
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

    if (!enterpriseName.trim()) {
      Message.warning(t('park.register.enterpriseNamePlaceholder', '请输入企业名称'));
      return;
    }

    if (!nickname.trim()) {
      Message.warning('请输入昵称');
      return;
    }

    if (!phoneFromUrl || !codeFromUrl) {
      Message.error('注册信息无效，请重新获取验证码');
      void navigate('/login', { replace: true });
      return;
    }

    setLoading(true);
    try {
      // 园区企业注册（P0）：创建 prospect enterprise org 并绑定园区
      // （邀请码可选；无邀请码时绑定部署默认园区）。注册成功后走登录。
      await invokePark('registerEnterprise', {
        phone: phoneFromUrl,
        sms_code: codeFromUrl,
        enterprise_name: enterpriseName.trim(),
        contact_name: nickname.trim(),
        ...(invitationCode.trim() ? { invite_token: invitationCode.trim() } : {}),
      });
      Message.success(t('park.register.success', '注册成功，即将进入登录'));
      setTimeout(() => navigate('/login', { replace: true }), 600);
    } catch (err) {
      Message.error(err instanceof Error ? err.message : '注册失败');
    }
    setLoading(false);
  };

  // 如果没有手机号和验证码，跳转到统一登录页。
  if (!phoneFromUrl || !codeFromUrl) {
    return (
      <div className='login-page'>
        <div className='login-page__card text-center flex flex-col items-center gap-24px py-48px'>
          <div className='w-64px h-64px rd-full f-center bg-danger/10 text-danger'>
            <Protect theme='filled' size={32} />
          </div>
          <div>
            <h2 className='text-20px font-700 text-foreground'>注册链接无效</h2>
            <p className='text-14px text-secondary mt-8px px-20px'>请重新获取验证码登录</p>
          </div>
          <Button type='primary' long className='!rd-12px h-48px mt-12px' onClick={() => navigate('/login', { replace: true })}>
            返回登录
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='login-page'>
      {/* 装饰性背景 */}
      <div className='login-page__background'>
        <div className='login-page__background-circle login-page__background-circle--lg' />
        <div className='login-page__background-circle login-page__background-circle--md' />
        <div className='login-page__background-circle login-page__background-circle--sm' />
      </div>

      <div className='login-page__card'>
        <div className='login-page__header'>
          <div className='login-page__logo'>
            <AionLogoMark />
          </div>
          <h1 className='text-28px font-800 tracking-tighter bg-gradient-to-br from-primary to-purple-600 bg-clip-text text-transparent mb-8px'>SudoWork</h1>
          <p className='text-13px text-secondary'>完成注册，开始使用</p>
        </div>

        <div className='flex flex-col gap-20px mt-32px'>
          {/* 显示手机号（只读） */}
          <div className='flex flex-col gap-8px'>
            <div className='text-12px font-600 text-secondary ml-4px'>手机号码</div>
            <Input size='large' prefix={<User className='text-tertiary' />} value={phoneFromUrl} disabled className='login-input !rd-12px h-48px' />
          </div>

          {/* 企业名称（园区 P0：prospect enterprise 注册） */}
          <div className='flex flex-col gap-8px'>
            <div className='text-12px font-600 text-secondary ml-4px'>{t('park.register.enterpriseName', '企业名称')}</div>
            <Input size='large' prefix={<User className='text-tertiary' />} placeholder={t('park.register.enterpriseNamePlaceholder', '请输入企业名称')} value={enterpriseName} onChange={setEnterpriseName} className='login-input !rd-12px h-48px' maxLength={60} />
          </div>

          {/* 昵称输入 */}
          <div className='flex flex-col gap-8px'>
            <div className='text-12px font-600 text-secondary ml-4px'>昵称</div>
            <Input size='large' prefix={<User className='text-tertiary' />} placeholder='请输入您的昵称' value={nickname} onChange={setNickname} className='login-input !rd-12px h-48px' maxLength={20} />
          </div>

          {/* 邀请码输入（园区邀请，可选） */}
          <div className='flex flex-col gap-8px'>
            <div className='text-12px font-600 text-secondary ml-4px'>{t('park.register.inviteCode', '园区邀请码（可选）')}</div>
            <Input size='large' prefix={<Protect className='text-tertiary' />} placeholder={t('park.register.inviteCodePlaceholder', '如有邀请码请填写')} value={invitationCode} onChange={setInvitationCode} className='login-input !rd-12px h-48px' maxLength={64} />
          </div>

          <Button type='primary' size='large' loading={loading} onClick={() => handleSubmit()} className='login-btn-primary !rd-12px h-52px mt-12px font-700 text-16px'>
            {t('park.register.submit', '注册企业账号')}
          </Button>

          <Button size='large' onClick={() => navigate('/login', { replace: true })} className='login-btn-secondary !rd-12px h-48px'>
            返回登录
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
