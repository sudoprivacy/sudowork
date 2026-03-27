import loginLogo from '@renderer/assets/logos/app.png';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import AppLoader from '../../components/AppLoader';
import { useAuth } from '../../context/AuthContext';
import { Button, Input, Message, Space } from '@arco-design/web-react';
import { Phone, Protect, Key } from '@icon-park/react';
import { ipcBridge } from '@/common';
import SudoworkIcon from '@/renderer/assets/sudowork-icon-dark.svg';
import './LoginPage.css';

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

const AionLogoMark: React.FC = () => <img src={SudoworkIcon} alt='Sudowork' className='w-64px h-64px object-contain' />;

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status, login } = useAuth();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // 固定企业码
  const ENTERPRISE_CODE = 'sudo';

  const [statusMsg, setStatusMsg] = useState<{ text: string; sub: string } | null>(null);

  useEffect(() => {
    if (status === 'authenticated') {
      void navigate('/guid', { replace: true });
    }
  }, [navigate, status]);

  // 页面加载时重置倒计时
  useEffect(() => {
    setCountdown(0);
  }, []);

  // 倒计时定时器
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [countdown]);

  const handleSendCode = async () => {
    if (!isValidPhone(phone)) {
      Message.error('请输入正确的 11 位手机号');
      return;
    }

    setLoading(true);
    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const res = await fetch(`${serverConfig.baseUrl}/api/v1/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });

      const data = await res.json();

      if (data.success) {
        Message.success('验证码已发送');
        setCountdown(data.next_send_in || 60);
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
    if (!phone || !code || !invitationCode) {
      Message.warning('请填写所有必填项');
      return;
    }

    setLoading(true);
    const result = await login({ phone, code, enterprise_code: ENTERPRISE_CODE, invitation_code: invitationCode });

    if (result.success) {
      Message.success('登录成功');
      setTimeout(() => navigate('/guid', { replace: true }), 600);
    } else {
      const statusCode = (result as any).status;
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

  if (status === 'checking') return <AppLoader />;

  if (statusMsg) {
    return (
      <div className='login-page'>
        <div className='login-page__card text-center flex flex-col items-center gap-24px py-48px'>
          <div className={`w-64px h-64px rd-full flex items-center justify-center ${statusMsg.type === 'rejected' ? 'bg-red-100 text-red-500' : 'bg-orange-100 text-orange-500'}`}>
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

  return (
    <div className='login-page'>
      {/* 装饰性背景 */}
      <div className='login-page__background'>
        <div className='login-page__background-circle login-page__background-circle--lg' />
        <div className='login-page__background-circle login-page__background-circle--md' />
        <div className='login-page__background-circle login-page__background-circle--sm' />
      </div>

      <div className='login-page__card !bg-white/90 !backdrop-blur-xl border border-white/20 shadow-2xl'>
        <div className='login-page__header'>
          <div className='login-page__logo'>
            <AionLogoMark />
          </div>
          <h1 className='text-28px font-800 tracking-tighter bg-gradient-to-br from-primary to-purple-600 bg-clip-text text-transparent mb-8px'>SudoClaw</h1>
          <p className='text-13px text-t-dim'>企业级 Agent 协同指挥中心</p>
        </div>

        <div className='flex flex-col gap-20px mt-32px'>
          <div className='flex flex-col gap-8px'>
            <div className='text-12px font-600 text-t-secondary ml-4px'>手机号码</div>
            <Input size='large' prefix={<Phone className='text-t-dim' />} placeholder='11 位手机号' value={phone} onChange={setPhone} className='!rd-12px !bg-fill-2/50 border-none h-48px' />
          </div>

          <div className='flex flex-col gap-8px'>
            <div className='text-12px font-600 text-t-secondary ml-4px'>邀请码</div>
            <Input size='large' prefix={<Protect className='text-t-dim' />} placeholder='请输入 6 位邀请码' value={invitationCode} onChange={setInvitationCode} className='!rd-12px !bg-fill-2/50 border-none h-48px' maxLength={6} />
          </div>

          <div className='flex flex-col gap-8px'>
            <div className='text-12px font-600 text-t-secondary ml-4px'>身份验证</div>
            <Space size='small' className='w-full'>
              <Input size='large' prefix={<Key className='text-t-dim' />} placeholder='6 位验证码' value={code} onChange={setCode} className='!rd-12px !bg-fill-2/50 border-none h-48px flex-1' />
              <Button size='large' disabled={countdown > 0} onClick={handleSendCode} className='!rd-8px h-48px font-600 min-w-120px'>
                {countdown > 0 ? `${countdown}s` : '发送验证码'}
              </Button>
            </Space>
          </div>

          <Button type='primary' size='large' loading={loading} onClick={() => handleSubmit()} className='!rd-12px h-52px mt-12px font-800 text-16px tracking-wide shadow-lg shadow-primary/30'>
            登录
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
