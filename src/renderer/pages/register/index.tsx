import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Button, Input, Message } from '@arco-design/web-react';
import { User, Protect } from '@icon-park/react';
import SudoworkIcon from '@/renderer/assets/sudowork-icon-dark.svg';
import '../login/LoginPage.css';

const AionLogoMark: React.FC = () => <img src={SudoworkIcon} alt='Sudowork' className='w-64px h-64px object-contain' />;

const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { register } = useAuth();

  // 从 URL 参数获取 register_token 和 phone
  const registerToken = searchParams.get('token') || '';
  const phoneFromUrl = searchParams.get('phone') || '';

  const [nickname, setNickname] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [loading, setLoading] = useState(false);

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
      navigate('/login', { replace: true });
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
      <div className='login-page'>
        <div className='login-page__card text-center flex flex-col items-center gap-24px py-48px'>
          <div className='w-64px h-64px rd-full flex items-center justify-center bg-red-100 text-red-500'>
            <Protect theme='filled' size={32} />
          </div>
          <div>
            <h2 className='text-20px font-700 text-t-primary'>注册链接无效</h2>
            <p className='text-14px text-t-secondary mt-8px px-20px'>请重新获取验证码登录</p>
          </div>
          <Button
            type='primary'
            long
            className='!rd-12px h-48px mt-12px'
            onClick={() => navigate('/login', { replace: true })}
          >
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

      <div className='login-page__card !bg-white/90 !backdrop-blur-xl border border-white/20 shadow-2xl'>
        <div className='login-page__header'>
          <div className='login-page__logo'>
            <AionLogoMark />
          </div>
          <h1 className='text-28px font-800 tracking-tighter bg-gradient-to-br from-primary to-purple-600 bg-clip-text text-transparent mb-8px'>SudoClaw</h1>
          <p className='text-13px text-t-dim'>完成注册，开始使用</p>
        </div>

        <div className='flex flex-col gap-20px mt-32px'>
          {/* 显示手机号（只读） */}
          <div className='flex flex-col gap-8px'>
            <div className='text-12px font-600 text-t-secondary ml-4px'>手机号码</div>
            <Input
              size='large'
              prefix={<User className='text-t-dim' />}
              value={phoneFromUrl}
              disabled
              className='!rd-12px !bg-fill-2/50 border-none h-48px'
            />
          </div>

          {/* 昵称输入 */}
          <div className='flex flex-col gap-8px'>
            <div className='text-12px font-600 text-t-secondary ml-4px'>昵称</div>
            <Input
              size='large'
              prefix={<User className='text-t-dim' />}
              placeholder='请输入您的昵称'
              value={nickname}
              onChange={setNickname}
              className='!rd-12px !bg-fill-2/50 border-none h-48px'
              maxLength={20}
            />
          </div>

          {/* 邀请码输入 */}
          <div className='flex flex-col gap-8px'>
            <div className='text-12px font-600 text-t-secondary ml-4px'>邀请码</div>
            <Input
              size='large'
              prefix={<Protect className='text-t-dim' />}
              placeholder='请输入 6 位邀请码'
              value={invitationCode}
              onChange={setInvitationCode}
              className='!rd-12px !bg-fill-2/50 border-none h-48px'
              maxLength={6}
            />
          </div>

          <Button
            type='primary'
            size='large'
            loading={loading}
            onClick={() => handleSubmit()}
            className='!rd-12px h-52px mt-12px font-800 text-16px tracking-wide shadow-lg shadow-primary/30'
          >
            完成注册
          </Button>

          <Button
            size='large'
            onClick={() => navigate('/login', { replace: true })}
            className='!rd-12px h-48px'
          >
            返回登录
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;