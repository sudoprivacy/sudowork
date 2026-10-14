/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Message } from '@arco-design/web-react';
import { Phone, Protect, User, Key } from '@icon-park/react';
import { Building2 } from 'lucide-react';
import { invokePark } from '@renderer/hooks/usePark';

/**
 * 园区企业注册面板（登录页「企业注册」tab 内容区，仅 WebUI 渲染）。验证码发送
 * 逻辑自含：不带 mossBaseUrl、固定走当前 WebUI 后端，与 login 页的 onSendCode
 * 行为不同，不可混用。
 */

function isValidPhone(phone: string): boolean {
  if (phone.length === 11) return phone[0] === '1' && /^\d{11}$/.test(phone);
  if (phone.length >= 13 && phone.startsWith('+86')) {
    const number = phone.slice(3);
    return number.length === 11 && number[0] === '1' && /^\d{11}$/.test(number);
  }
  return false;
}

export default function EnterpriseRegisterPanel({ onRegistered }: IEnterpriseRegisterPanelProps) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [contactName, setContactName] = useState('');
  const [enterpriseName, setEnterpriseName] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  async function onSendCode() {
    if (!isValidPhone(phone)) {
      Message.warning(t('login.phoneInvalid'));
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/send-code', {
        signal: AbortSignal.timeout(15_000),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ phone }),
      });
      const body = (await response.json()) as {
        success?: boolean;
        ok?: boolean;
        next_send_in?: number;
        nextSendIn?: number;
        msg?: string;
        message?: string;
        error?: string;
      };
      const nextSendIn = body.next_send_in ?? body.nextSendIn;
      if (typeof nextSendIn === 'number') setCountdown(nextSendIn);
      if (response.ok && (body.success ?? body.ok)) Message.success(t('login.sendCodeSuccess'));
      else Message.error(body.message || body.msg || body.error || t('login.errors.serverError'));
    } catch {
      Message.error(t('login.errors.networkError'));
    } finally {
      setIsLoading(false);
    }
  }

  async function onRegisterSubmit() {
    if (!isValidPhone(phone) || !code.trim() || !contactName.trim() || !enterpriseName.trim()) {
      Message.warning(t('login.requiredFields'));
      return;
    }
    setIsLoading(true);
    try {
      await invokePark('registerEnterprise', {
        phone,
        sms_code: code.trim(),
        enterprise_name: enterpriseName.trim(),
        contact_name: contactName.trim(),
        ...(inviteToken.trim() ? { invite_token: inviteToken.trim() } : {}),
      });
      Message.success(t('park.register.success', '注册成功，可使用手机号登录'));
      setPhone('');
      setCode('');
      setContactName('');
      setEnterpriseName('');
      setInviteToken('');
      onRegistered();
    } catch (error) {
      Message.error(error instanceof Error ? error.message : t('login.pwdRegisterFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <p className='text-13px text-secondary'>{t('park.register.pageSubtitle', '注册后由园区服务团队与您对接')}</p>
      <Input size='large' prefix={<Phone className='text-tertiary' />} placeholder={t('login.phonePlaceholder')} value={phone} onChange={setPhone} className='login-input !rd-12px h-48px' />
      <div className='flex w-full'>
        <Input size='large' prefix={<Protect className='text-tertiary' />} placeholder={t('login.codePlaceholder')} value={code} onChange={setCode} maxLength={8} className='login-input !rd-l-12px h-48px flex-1' />
        <Button size='large' disabled={countdown > 0 || isLoading} onClick={() => void onSendCode()} className='h-48px !rd-r-12px'>
          {countdown > 0 ? t('login.countingDown', { count: countdown }) : t('login.sendCode')}
        </Button>
      </div>
      <Input size='large' prefix={<User className='text-tertiary' />} placeholder={t('park.register.contactNamePlaceholder', '联系人姓名')} value={contactName} onChange={setContactName} className='login-input !rd-12px h-48px' />
      <Input size='large' prefix={<Building2 className='text-tertiary' />} placeholder={t('park.register.enterpriseNamePlaceholder', '企业名称')} value={enterpriseName} onChange={setEnterpriseName} className='login-input !rd-12px h-48px' />
      <Input size='large' prefix={<Key className='text-tertiary' />} placeholder={t('park.register.inviteCodePlaceholder', '如有邀请码请填写')} value={inviteToken} onChange={setInviteToken} className='login-input !rd-12px h-48px' />
      <Button type='primary' size='large' loading={isLoading} onClick={() => void onRegisterSubmit()} className='login-btn-primary !rd-12px h-52px font-700 text-16px'>
        {t('park.register.submit', '注册')}
      </Button>
    </>
  );
}

interface IEnterpriseRegisterPanelProps {
  onRegistered: () => void;
}
