import { ArrowLeft, ChevronDown, LogIn, LogOut, Settings } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Dropdown, Menu, Message } from '@arco-design/web-react';
import { useAuth } from '@renderer/context/AuthContext';
import { cleanupSiderTooltips } from '@renderer/utils/siderTooltip';
import { maskPhone } from '@renderer/utils';

export default function SiderFooter({ isSettings, onBackToMain }: ISiderFooterProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout, user: currentUser, isGuest } = useAuth();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userTriggerRef = useRef<HTMLDivElement>(null);
  const [userMenuWidth, setUserMenuWidth] = useState<number>();
  const userInfo = {
    email: maskPhone(currentUser?.phone || ''),
    name: currentUser?.nickname || t('settings.userProfile.defaultNickname', '{{appName}} 用户'),
    avatar: null as string | null,
  };

  const onMenuClick = async (key: string) => {
    setIsUserMenuOpen(false);
    cleanupSiderTooltips();
    if (key === 'settings') {
      void navigate(isGuest ? '/settings/model' : '/settings/profile');
    } else if (key === 'login') {
      void navigate('/login', { replace: true });
    } else if (key === 'logout') {
      await logout();
      Message.success(t('login.logoutSuccess'));
      void navigate('/login', { replace: true });
    }
  };

  if (isSettings) {
    return (
      <div className='shrink-0 mt-auto pt-2 border-t border-border'>
        <Button type='text' long className='min-h-11 h-auto justify-start! gap-2.5 px-2.5! py-2! rounded-lg! text-foreground! hover:bg-fill-default! active:bg-fill-deep!' onClick={onBackToMain}>
          <span className='size-7 rounded-full bg-fill-shallow f-center shrink-0'>
            <ArrowLeft size={16} strokeWidth={2} />
          </span>
          <span className='truncate text-sm font-500'>{t('common.backToMain')}</span>
        </Button>
      </div>
    );
  }

  return (
    <div className='shrink-0 mt-auto pt-2 border-t border-border'>
      <Dropdown
        droplist={
          <Menu style={{ width: userMenuWidth, minWidth: 200 }} onClickMenuItem={onMenuClick}>
            <Menu.Item key='settings'>
              <div className='flex items-center gap-2.5'>
                <Settings size={17} strokeWidth={1.8} className='text-foreground-secondary' />
                <span>{t('common.settings')}</span>
              </div>
            </Menu.Item>
            {isGuest ? (
              <Menu.Item key='login'>
                <div className='flex items-center gap-2.5'>
                  <LogIn size={17} strokeWidth={1.8} className='text-foreground-secondary' />
                  <span>{t('login.submit')}</span>
                </div>
              </Menu.Item>
            ) : (
              <Menu.Item key='logout'>
                <div className='flex items-center gap-2.5 text-destructive'>
                  <LogOut size={17} strokeWidth={1.8} />
                  <span>{t('login.logout', { defaultValue: '退出登录' })}</span>
                </div>
              </Menu.Item>
            )}
          </Menu>
        }
        trigger='click'
        position='tr'
        popupVisible={isUserMenuOpen}
        onVisibleChange={(isVisible) => {
          if (isVisible) setUserMenuWidth(userTriggerRef.current?.offsetWidth);
          setIsUserMenuOpen(isVisible);
        }}
      >
        <div ref={userTriggerRef}>
          <Button type='text' long aria-label={t('common.ariaLabel.accountMenu')} className='min-h-11 h-auto justify-start! gap-2.5 px-2.5! py-2! rounded-lg! text-foreground! hover:bg-fill-default! active:bg-fill-deep!'>
            <span className='size-7 rounded-full bg-fill-shallow f-center text-sm font-600 shrink-0'>
              {isGuest ? <LogIn size={16} strokeWidth={1.8} /> : userInfo.avatar ? <img src={userInfo.avatar} alt={userInfo.name} className='size-full rounded-full object-cover' /> : userInfo.name.charAt(0).toUpperCase()}
            </span>
            <span className='flex-1 min-w-0 text-left'>
              <span className='block text-sm font-500 truncate'>{isGuest ? t('login.submit') : userInfo.name}</span>
              {!isGuest && userInfo.email && <span className='block text-xs text-foreground-secondary truncate'>{userInfo.email}</span>}
            </span>
            <ChevronDown size={16} strokeWidth={1.8} className='shrink-0 text-foreground-secondary' />
          </Button>
        </div>
      </Dropdown>
    </div>
  );
}

interface ISiderFooterProps {
  isSettings: boolean;
  onBackToMain: () => void;
}
