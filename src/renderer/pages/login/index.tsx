import loginLogo from '@renderer/assets/logos/app.png';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import AppLoader from '../../components/AppLoader';
import { useAuth } from '../../context/AuthContext';
import { Button, Input, Message, Space } from '@arco-design/web-react';
import { Phone, Protect, Key } from '@icon-park/react';
import './LoginPage.css';

const AionLogoMark: React.FC = () => (
  <svg className='w-64px h-64px text-primary' viewBox='0 0 80 80' fill='none' aria-hidden='true' focusable='false'>
    <path
      d='M78.7034,21.9581 C78.5522,21.6152 78.4472,21.3188 78.3117,21.1156 L58.7503,10.7582 L58.7382,10.747 L58.7261,10.747 L38.873,0.3896 C38.3184,0.0809 37.6506,0 37.1135,0.2905 L0.8647,21.1119 C0.3391,21.4024 0.0234,22.0059 0.0234,22.6552 L0.0234,43.2112 C0.0234,43.2112 0.0234,43.2227 0.0234,43.2341 C0.0234,43.2456 0.0234,43.2456 0.0234,43.2456 L0.0234,63.8016 C0.0234,63.8016 0.0234,63.8131 0.0234,63.8131 C0.0234,63.9814 0.3391,64.5849 0.8647,64.8754 L37.1135,85.6968 C37.6499,85.9873 38.3184,85.9873 38.8548,85.6968 C38.8886,85.6763 38.9342,85.6558 38.968,85.6433 L58.6985,75.3513 L58.7094,75.3401 L58.7202,75.3289 L78.5733,65.0798 L78.5842,65.0686 C79.11,64.7781 79.4257,64.1746 79.4257,63.8131 L79.4257,22.6664 C79.4257,22.4383 79.3801,22.2214 78.7034,21.9581 Z M60.144,52.9255 L60.144,33.8351 L75.1888,25.435 L75.1888,60.9985 L60.144,52.9255 Z M56.6792,15.1383 L56.6792,32.5851 L38.9092,41.3644 L24.1504,32.5851 L56.6792,15.1383 Z M16.8562,32.5851 L3.8832,40.4709 L3.8832,25.435 L16.8562,32.5851 Z M20.2354,34.8183 L37.0192,44.4757 L37.0192,60.9985 L20.2354,43.5517 L20.2354,34.8183 Z M37.0306,64.8883 L37.0306,80.5657 L3.9948,63.8131 L20.2466,54.8857 L37.0306,64.8883 Z M40.4098,44.4757 L54.801,36.6857 L54.801,71.8957 L40.4098,63.6933 L40.4098,44.4757 Z M58.7261,29.8976 L58.7261,15.1383 L71.6879,22.6552 L58.7261,29.8976 Z M40.4098,19.6164 L40.4098,4.7239 L53.3541,12.2407 L40.4098,19.6164 Z M37.0306,21.6239 L21.0034,30.8407 L7.5234,22.6476 L37.0306,4.7351 L37.0306,21.6239 Z M3.8944,46.3992 L16.8562,53.8807 L3.8944,61.3622 L3.8944,46.3992 Z M40.4098,67.2492 L53.3653,74.7307 L40.4098,82.2122 L40.4098,67.2492 Z M58.7149,56.8792 L71.6879,64.8883 L58.7149,72.8974 L58.7149,56.8792 Z'
      fill='currentColor'
    ></path>
  </svg>
);

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status, login } = useAuth();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [enterpriseCode, setEnterpriseCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (status === 'authenticated') {
      void navigate('/guid', { replace: true });
    }
  }, [navigate, status]);

  const handleSendCode = () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      Message.error('请输入正确的 11 位手机号');
      return;
    }
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    Message.success('验证码已发送 (Mock: 123456)');
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!phone || !code || !enterpriseCode) {
      Message.warning('请填写所有必填项');
      return;
    }

    setLoading(true);
    const result = await login({ phone, code, enterprise_code: enterpriseCode });

    if (result.success) {
      Message.success('登录成功');
      setTimeout(() => navigate('/guid', { replace: true }), 600);
    } else {
      Message.error(result.message || '登录失败');
    }
    setLoading(false);
  };

  if (status === 'checking') return <AppLoader />;

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
          <h1 className='text-28px font-800 tracking-tighter bg-gradient-to-br from-primary to-purple-600 bg-clip-text text-transparent mb-8px'>Sudowork Enterprise</h1>
          <p className='text-13px text-t-dim'>企业级 Agent 协同指挥中心</p>
        </div>

        <div className='flex flex-col gap-20px mt-32px'>
          <div className='flex flex-col gap-8px'>
            <div className='text-12px font-600 text-t-secondary ml-4px'>企业邀请码</div>
            <Input size='large' prefix={<Protect className='text-t-dim' />} placeholder='请输入企业代码' value={enterpriseCode} onChange={setEnterpriseCode} className='!rd-12px !bg-fill-2/50 border-none h-48px' />
          </div>

          <div className='flex flex-col gap-8px'>
            <div className='text-12px font-600 text-t-secondary ml-4px'>手机号码</div>
            <Input size='large' prefix={<Phone className='text-t-dim' />} placeholder='11 位手机号' value={phone} onChange={setPhone} className='!rd-12px !bg-fill-2/50 border-none h-48px' />
          </div>

          <div className='flex flex-col gap-8px'>
            <div className='text-12px font-600 text-t-secondary ml-4px'>身份验证</div>
            <Space size='small' className='w-full'>
              <Input size='large' prefix={<Key className='text-t-dim' />} placeholder='6 位验证码' value={code} onChange={setCode} className='!rd-12px !bg-fill-2/50 border-none h-48px flex-1' />
              <Button size='large' disabled={countdown > 0} onClick={handleSendCode} className='!rd-12px !bg-fill-2 h-48px border-none font-600 min-w-100px'>
                {countdown > 0 ? `${countdown}s` : '发送'}
              </Button>
            </Space>
          </div>

          <Button type='primary' size='large' loading={loading} onClick={() => handleSubmit()} className='!rd-12px h-52px mt-12px font-800 text-16px tracking-wide shadow-lg shadow-primary/30'>
            登录
          </Button>
        </div>

        <div className='mt-32px pt-20px border-t border-border-1 text-center'>
          <p className='text-11px text-t-dim uppercase tracking-widest mono'>Sudowork Protocol v4.0.2</p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
