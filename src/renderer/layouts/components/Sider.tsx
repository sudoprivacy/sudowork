/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowLeft, ChevronDown, LogIn, LogOut, Plus, Settings } from 'lucide-react';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Dropdown, Menu, Message } from '@arco-design/web-react';
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

  const handleSettingsClick = () => {
    cleanupSiderTooltips();
    if (isSettings) {
      const target = lastNonSettingsPathRef.current || '/guid';
      void navigate(target);
    } else {
      void navigate(isGuest ? '/settings/model' : '/settings/profile');
    }
    onSessionClick();
  };

  const onUserMenuClick = async (key: string) => {
    if (key === 'settings') {
      handleSettingsClick();
      setUserMenuOpen(false);
      return;
    } else if (key === 'login') {
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
          <div className='h-full min-h-0 flex flex-col overflow-hidden py-2 box-border'>
            <div className='min-h-0 shrink overflow-y-auto scrollbar-hide'>
              {/* 新会话按钮 - 带边框的按钮风格 / New Chat button with border style */}
              <div
                className='h-10.5 flex-shrink-0 f-center gap-2 px-3.5 mb-3 rd-3 cursor-pointer transition-all border bg-subtle hover:bg-hover active:bg-fill-2'
                onClick={() => {
                  cleanupSiderTooltips();
                  // 清除持久化的 agent 选择，确保新会话时不恢复之前的助手
                  void ConfigStorage.set('guid.lastSelectedAgent', '');
                  // 触发 Guide 页面重置所有用户输入状态
                  emitter.emit('guid.reset');
                  void navigate('/guid');
                  onSessionClick();
                }}
              >
                <Plus size={18} strokeWidth={1.8} className='text-foreground shrink-0' />
                <span className='text-15px font-medium text-foreground truncate'>{t('conversation.welcome.newConversation')}</span>
              </div>
            </div>

            <div className='flex min-h-24 flex-1 flex-col'>
              <Suspense fallback={<div className='size-full' />}>
                <WorkspaceGroupedHistory {...workspaceHistoryProps} collapsed={false} />
              </Suspense>
            </div>
          </div>
        )}
      </div>
      {/* Footer - User info area */}
      <div className='shrink-0 mt-auto pt-2 px-0'>
        {!isSettings ? (
          /* 用户信息下拉菜单 */
          <Dropdown
            droplist={
              <Menu style={{ width: userMenuWidth, minWidth: 200 }} onClickMenuItem={onUserMenuClick}>
                <Menu.Item key='settings'>
                  <div className='flex items-center gap-2.5 '>
                    <Settings size={17} strokeWidth={1.8} className='text-secondary' />
                    <span>{t('common.settings')}</span>
                  </div>
                </Menu.Item>
                {isGuest ? (
                  <Menu.Item key='login'>
                    <div className='flex items-center gap-2.5'>
                      <LogIn size={17} strokeWidth={1.8} className='text-secondary' />
                      <span>{t('login.submit')}</span>
                    </div>
                  </Menu.Item>
                ) : (
                  <Menu.Item key='logout'>
                    <div className='flex items-center gap-2.5 text-danger'>
                      <LogOut size={17} strokeWidth={1.8} className='text-danger' />
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
            <div className='flex flex-col gap-0.5'>
              <div ref={userTriggerRef} className='flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors rd-3 border hover:bg-hover active:bg-fill-2 ml-0.5'>
                <div className='size-8 rd-50% bg-fill-3 f-center text-foreground text-14px font-bold shrink-0'>
                  {isGuest ? <LogIn size={16} strokeWidth={1.8} /> : userInfo.avatar ? <img src={userInfo.avatar} alt={userInfo.name} className='w-full h-full rd-50% object-cover' /> : <span>{userInfo.name.charAt(0).toUpperCase()}</span>}
                </div>
                <div className='flex-1 min-w-0'>
                  <div className='text-14px font-medium text-foreground truncate'>{isGuest ? t('login.submit') : userInfo.name}</div>
                  {!isGuest && <div className='text-12px text-secondary truncate'>{userInfo.email}</div>}
                </div>
                <ChevronDown size={16} strokeWidth={1.8} className='shrink-0 text-secondary' />
              </div>
            </div>
          </Dropdown>
        ) : (
          /* 设置页面 - 主题切换 + 返回按钮 */
          <div className='flex flex-col gap-0.5'>
            {/* 返回按钮 */}
            <div className='border rd-3 flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors hover:bg-hover active:bg-fill-2 ml-0.5' onClick={handleSettingsClick}>
              <div className='size-8 rd-50% bg-fill-3 f-center text-foreground text-14px font-bold shrink-0'>
                <ArrowLeft size={16} strokeWidth={1.8} />
              </div>
              <div className='flex-1 min-w-0'>
                <div className='text-14px font-medium text-foreground truncate'>{t('common.back')}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sider;
