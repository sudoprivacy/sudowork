/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowLeft, ChevronDown, LogIn, LogOut, MessageCirclePlus, Settings } from 'lucide-react';
import classNames from 'classnames';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Dropdown, Menu, Message } from '@arco-design/web-react';
import { cleanupSiderTooltips } from '@renderer/utils/siderTooltip';
import { useAuth } from '@renderer/context/AuthContext';
import { emitter } from '@renderer/utils/emitter';
import { ConfigStorage } from '@common/storage';

import WorkspaceGroupedHistory from '@renderer/pages/conversation/WorkspaceGroupedHistory';
import { maskPhone } from '@renderer/utils';
import SettingsSider from './SettingsSider';

const Sider: React.FC = () => {
  // 侧栏收起由外层 ArcoLayout.Sider 把宽度动画到 0 整体隐藏，内容始终保持展开态，
  // 因此这里不再处理收起态的布局分支。
  const { pathname, search, hash } = useLocation();

  // 选中会话 / 触发导航后清理 tooltip 残留
  // Clean up tooltip remnants after selecting a session / navigating
  const onSessionClick = useCallback(() => {
    cleanupSiderTooltips();
  }, []);

  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout, user: currentUser, isGuest } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // 账户菜单触发区，用于让弹层宽度与之对齐
  const userTriggerRef = useRef<HTMLDivElement>(null);
  const [userMenuWidth, setUserMenuWidth] = useState<number>();
  const isSettings = pathname.startsWith('/settings');
  const isNewConversationSelected = pathname === '/guid';
  const lastNonSettingsPathRef = useRef('/guid');

  // 从 AuthContext 获取实际用户信息（手机号脱敏展示）
  const userInfo = {
    email: maskPhone(currentUser?.phone || ''),
    name: currentUser?.nickname || t('settings.userProfile.defaultNickname', '{{appName}} 用户'),
    avatar: null as string | null,
  };

  const workspaceHistoryProps = {
    collapsed: false,
    tooltipEnabled: false,
    onSessionClick,
    activeTab: 'timeline' as const,
  };

  useEffect(() => {
    if (!pathname.startsWith('/settings')) {
      lastNonSettingsPathRef.current = `${pathname}${search}${hash}`;
    }
  }, [pathname, search, hash]);

  const onSettingsClick = () => {
    cleanupSiderTooltips();
    if (isSettings) {
      void navigate(lastNonSettingsPathRef.current || '/guid');
    } else {
      void navigate(isGuest ? '/settings/model' : '/settings/profile');
    }
    onSessionClick();
  };

  const onUserMenuClick = async (key: string) => {
    if (key === 'login') {
      setUserMenuOpen(false);
      void navigate('/login', { replace: true });
    } else if (key === 'logout') {
      setUserMenuOpen(false);
      await logout();
      Message.success(t('login.logoutSuccess'));
      void navigate('/login', { replace: true });
    }
  };

  return (
    <div className='size-full flex flex-col'>
      {/* Main content area */}
      <div className='flex-1 min-h-0 overflow-y-auto scrollbar-hide'>
        {isSettings ? (
          <Suspense fallback={<div className='size-full' />}>
            <SettingsSider />
          </Suspense>
        ) : (
          <div className='h-full min-h-0 flex flex-col overflow-hidden pt-1 box-border'>
            <Button
              type='text'
              long
              className={classNames('h-9 shrink-0 justify-start! gap-2.5 px-2.5! rounded-lg! text-foreground! hover:bg-fill-default! active:bg-fill-deep!', isNewConversationSelected && 'bg-fill-default!')}
              aria-current={isNewConversationSelected ? 'page' : undefined}
              onClick={() => {
                cleanupSiderTooltips();
                void ConfigStorage.set('guid.lastSelectedAgent', '');
                emitter.emit('guid.reset');
                void navigate('/guid');
                onSessionClick();
              }}
            >
              <MessageCirclePlus size={16} strokeWidth={2} className='shrink-0' />
              <span className='truncate text-sm font-500'>{t('conversation.welcome.newConversation')}</span>
            </Button>

            <div className='flex min-h-24 flex-1 flex-col mt-2'>
              <Suspense fallback={<div className='size-full' />}>
                <WorkspaceGroupedHistory {...workspaceHistoryProps} collapsed={false} />
              </Suspense>
            </div>
          </div>
        )}
      </div>

      <div className='shrink-0 mt-auto pt-2 flex flex-col gap-1'>
        <Button type='text' long className={classNames('h-9 justify-start! gap-2.5 px-2.5! rounded-md! text-foreground-secondary! hover:bg-fill-default! hover:text-foreground! active:bg-fill-deep!', isSettings && 'bg-fill-default! text-foreground!')} onClick={onSettingsClick}>
          {isSettings ? <ArrowLeft size={16} strokeWidth={2} className='shrink-0' /> : <Settings size={16} strokeWidth={2} className='shrink-0' />}
          <span className='truncate text-sm font-500'>{isSettings ? t('common.back') : t('common.settings')}</span>
        </Button>

        <Dropdown
          droplist={
            <Menu style={{ width: userMenuWidth, minWidth: 200 }} onClickMenuItem={onUserMenuClick}>
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
          popupVisible={userMenuOpen}
          onVisibleChange={(visible) => {
            if (visible) setUserMenuWidth(userTriggerRef.current?.offsetWidth);
            setUserMenuOpen(visible);
          }}
        >
          <div ref={userTriggerRef}>
            <Button type='text' long className='min-h-11 h-auto justify-start! gap-2.5 px-2.5! py-2! rounded-md! text-foreground! hover:bg-fill-default! active:bg-fill-deep!'>
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
    </div>
  );
};

export default Sider;
