import { AlarmClock, Down, Earth, Lightning, ListCheckbox, Logout, Plus, Return, Robot, SettingTwo, Shield } from '@icon-park/react';
import classNames from 'classnames';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Dropdown, Message, Popover, Tabs } from '@arco-design/web-react';
import type { BatchHistoryApi } from '@renderer/pages/conversation/grouped-history/types';
import { cleanupSiderTooltips } from '@renderer/utils/siderTooltip';
import { useAuth } from '@renderer/context/AuthContext';
import { addEventListener, emitter } from '@renderer/utils/emitter';
import { ConfigStorage } from '@common/storage';
import { useAppMode } from '@renderer/hooks/useAppMode';
import { useCronEnabled } from '@renderer/hooks/useCronEnabled';

import WorkspaceGroupedHistory from '@renderer/pages/conversation/WorkspaceGroupedHistory';
import { maskPhone } from '@renderer/utils';
import SettingsSider from '@/renderer/pages/settings/components/SettingsSider';
import SidebarNavItem from '@/renderer/layouts/components/SidebarNavItem';

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
  const { logout, user: currentUser } = useAuth();
  const { isEnterprise } = useAppMode();
  const cronEnabled = useCronEnabled();
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // 账户菜单触发区，用于让弹层宽度与之对齐
  const userTriggerRef = useRef<HTMLDivElement>(null);
  const [userMenuWidth, setUserMenuWidth] = useState<number>();
  // Batch-action API published up from the history list; drives the popover content.
  const [batchApi, setBatchApi] = useState<BatchHistoryApi | null>(null);

  // Sidebar tab state: 'timeline' or 'scheduled'
  const SIDER_TAB_STORAGE_KEY = 'sudowork_sider_tab';
  const [activeTab, setActiveTab] = useState<'timeline' | 'scheduled'>(() => {
    try {
      const stored = localStorage.getItem(SIDER_TAB_STORAGE_KEY);
      if (stored === 'scheduled') return 'scheduled';
    } catch {
      // ignore
    }
    return 'timeline';
  });

  // 功能菜单项定义 / Function menu items definition
  const Menus = [
    { id: 'agent', label: t('common.siderMenu.agent'), icon: Robot, path: '/settings/agent' },
    { id: 'skill-store', label: t('common.siderMenu.skillStore'), icon: Lightning, path: '/settings/skill' },
    { id: 'security', label: t('common.siderMenu.security'), icon: Shield, path: '/app/security' },
    ...(!isEnterprise ? [{ id: 'webui' as const, label: t('common.siderMenu.webui'), icon: Earth, path: '/settings/webui' }] : []),
    ...(cronEnabled ? [{ id: 'cron' as const, label: t('common.siderMenu.cron'), icon: AlarmClock, path: '/app/cron' }] : []),
  ];

  const isSettings = pathname.startsWith('/settings');
  const lastNonSettingsPathRef = useRef('/guid');

  // 从 AuthContext 获取实际用户信息（手机号脱敏展示）
  const userInfo = {
    email: maskPhone(currentUser?.phone || ''),
    name: currentUser?.nickname || 'Sudowork 用户',
    avatar: null as string | null,
  };

  // With client cron disabled the scheduled tab is hidden, so fall back to the
  // timeline even if 'scheduled' was previously persisted.
  const effectiveTab: 'timeline' | 'scheduled' = cronEnabled ? activeTab : 'timeline';

  // Batch management only applies to conversations (timeline tab); leaving the
  // timeline tab exits batch mode so the popover can't be opened under 定时任务.
  // Dismiss the batch popover when clicking truly blank space, but keep it open
  // when interacting with the trigger, the popover itself, or a conversation row
  // (so ticking row checkboxes doesn't exit batch mode).

  const workspaceHistoryProps = {
    collapsed: false,
    tooltipEnabled: false,
    onSessionClick,
    batchMode: isBatchMode,
    onBatchModeChange: setIsBatchMode,
    activeTab: effectiveTab,
    onBatchApiChange: setBatchApi,
  };

  // Listen for command palette tab switch events
  useEffect(() => {
    const removeListener = addEventListener('sider.tab.switch', (tab) => {
      setActiveTab(tab);
      try {
        localStorage.setItem(SIDER_TAB_STORAGE_KEY, tab);
      } catch {
        // ignore
      }
    });
    return removeListener;
  }, []);

  useEffect(() => {
    if (!pathname.startsWith('/settings')) {
      lastNonSettingsPathRef.current = `${pathname}${search}${hash}`;
    }
  }, [pathname, search, hash]);

  useEffect(() => {
    if (!isBatchMode) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.batch-mode-trigger, .batch-actions-popover, .conversation-item')) {
        return;
      }
      setIsBatchMode(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isBatchMode]);

  // 处理功能菜单点击 — path 以 /app/ 开头的跳转独立路由，其余在 GuidPage 内联显示
  const onMenuClick = (menuId: string) => {
    try {
      const nextTab: 'timeline' | 'scheduled' = menuId === 'cron' ? 'scheduled' : 'timeline';
      setActiveTab(nextTab);
      localStorage.setItem(SIDER_TAB_STORAGE_KEY, nextTab);
      const menu = Menus.find((m) => m.id === menuId);
      if (menu?.path.startsWith('/app/')) {
        void navigate(menu.path);
      } else {
        void navigate(`/guid?menu=${menuId}`);
      }
    } catch {
      // ignore
    }
  };

  const handleSettingsClick = () => {
    cleanupSiderTooltips();
    if (isSettings) {
      const target = lastNonSettingsPathRef.current || '/guid';
      void navigate(target);
    } else {
      void navigate('/settings/profile');
    }
    onSessionClick();
  };

  return (
    <div className='size-full flex flex-col'>
      {/* Main content area */}
      <div className='flex-1 min-h-0 overflow-y-auto scrollbar-hide'>
        {isSettings ? (
          <Suspense fallback={<div className='size-full' />}>
            <SettingsSider></SettingsSider>
          </Suspense>
        ) : (
          <div className='size-full flex flex-col py-2 overflow-hidden box-border'>
            {/* 新会话按钮 - 带边框的按钮风格 / New Chat button with border style */}
            <div
              className='h-10.5 flex-shrink-0 f-center gap-2 px-3.5 mb-3 rd-12px cursor-pointer transition-all border bg-1 hover:bg-hover active:bg-fill-2'
              onClick={() => {
                cleanupSiderTooltips();
                setIsBatchMode(false);
                // 清除持久化的 agent 选择，确保新会话时不恢复之前的助手
                void ConfigStorage.set('guid.lastSelectedAgent', '');
                // 触发 Guide 页面重置所有用户输入状态
                emitter.emit('guid.reset');
                void navigate('/guid');
                onSessionClick();
              }}
            >
              <Plus theme='outline' size='20' fill='currentColor' className='text-foreground shrink-0 block leading-none' />
              <span className='text-15px font-medium text-foreground truncate'>{t('conversation.welcome.newConversation')}</span>
            </div>

            {/* 功能菜单区域 / Function menu area */}
            <div className='mb-4 flex flex-col gap-0.5'>
              {Menus.map((menu) => {
                const isSelected = pathname === menu.path || (pathname.startsWith('/guid') && new URLSearchParams(search).get('menu') === menu.id);
                return (
                  <SidebarNavItem
                    key={menu.id}
                    icon={<menu.icon theme='outline' size='20' className='block leading-none' />}
                    label={menu.label}
                    selected={isSelected}
                    onClick={() => {
                      cleanupSiderTooltips();
                      onMenuClick(menu.id);
                      onSessionClick();
                    }}
                  />
                );
              })}
            </div>

            {/* Session history tabs + batch mode button */}
            <div className={classNames('mb-2 px-2 flex items-center justify-between')}>
              {cronEnabled && (
                <Tabs
                  className='sidebar-tabs flex-1 shrink-0'
                  type='line'
                  activeTab={effectiveTab}
                  headerPadding={false}
                  onChange={(tab) => {
                    const next = tab as 'timeline' | 'scheduled';
                    setActiveTab(next);
                    try {
                      localStorage.setItem(SIDER_TAB_STORAGE_KEY, next);
                    } catch {
                      // ignore
                    }
                  }}
                >
                  <Tabs.TabPane key='timeline' title={t('conversation.history.timeline', { defaultValue: '对话' })} />
                  <Tabs.TabPane key='scheduled' title={t('conversation.history.scheduledTab', { defaultValue: '定时任务' })} />
                </Tabs>
              )}
              <Popover
                trigger={[]}
                popupVisible={isBatchMode}
                position='rt'
                className='batch-actions-popover'
                getPopupContainer={() => document.body}
                content={
                  <div className='flex flex-col gap-1.5 w-45'>
                    <div className='px-0.5 pb-0.5 text-12px leading-18px text-secondary'>{t('conversation.history.selectedCount', { count: batchApi?.selectedCount ?? 0 })}</div>
                    <Button long type='secondary' className='rd-2' onClick={() => batchApi?.onToggleSelectAll()}>
                      {batchApi?.allSelected ? t('common.cancel') : t('conversation.history.selectAll')}
                    </Button>
                    <Button long type='secondary' className='rd-2' disabled={!batchApi?.selectedCount} onClick={() => batchApi?.onBatchExport()}>
                      {t('conversation.history.batchExport')}
                    </Button>
                    <Button long type='secondary' status='danger' className='rd-2' disabled={!batchApi?.selectedCount} onClick={() => batchApi?.onBatchDelete()}>
                      {t('conversation.history.batchDelete')}
                    </Button>
                  </div>
                }
              >
                <div
                  className={classNames('batch-mode-trigger size-8 f-center rd-8px cursor-pointer transition-all shrink-0', isBatchMode ? 'bg-[rgba(var(--ui-accent-orange-rgb),0.12)] text-[var(--ui-accent-orange)]' : 'hover:bg-hover active:bg-fill-2 text-secondary')}
                  onClick={() => setIsBatchMode((prev) => !prev)}
                >
                  <ListCheckbox theme='outline' size='18' className='block leading-none' />
                </div>
              </Popover>
            </div>

            <Suspense fallback={<div className='flex-1 min-h-0' />}>
              <WorkspaceGroupedHistory {...workspaceHistoryProps} collapsed={false} />
            </Suspense>
          </div>
        )}
      </div>
      {/* Footer - User info area */}
      <div className={classNames('shrink-0 sider-footer mt-auto pt-2 px-0', isSettings ? '' : 'pr-4')}>
        {!isSettings ? (
          /* 用户信息下拉菜单 */
          <Dropdown
            droplist={
              <div className='flex flex-col gap-0.5 p-1.5 rd-12px border bg-popup' style={{ width: userMenuWidth ? userMenuWidth - 12 : undefined, minWidth: 200, boxShadow: '0 8px 28px rgba(0, 0, 0, 0.12)' }}>
                <div
                  className='flex items-center gap-2.5 px-2.5 h-9.5 rd-8px cursor-pointer text-14px text-foreground transition-colors hover:bg-hover active:bg-active'
                  onClick={() => {
                    handleSettingsClick();
                    setUserMenuOpen(false);
                  }}
                >
                  <SettingTwo theme='outline' size='17' fill={'var(--text-secondary)'} />
                  <span>{t('common.settings')}</span>
                </div>
                <div className='mx-1 border-b-0.5px border-light' />
                <div
                  className='flex items-center gap-2.5 px-2.5 h-9.5 rd-8px cursor-pointer text-14px text-danger transition-colors hover:bg-hover active:bg-active'
                  onClick={async () => {
                    setUserMenuOpen(false);
                    await logout();
                    Message.success(t('login.logoutSuccess'));
                    void navigate('/login', { replace: true });
                  }}
                >
                  <Logout theme='outline' size='17' fill='var(--danger)' />
                  <span>{t('login.logout', { defaultValue: '退出登录' })}</span>
                </div>
              </div>
            }
            trigger='click'
            position='tr'
            popupVisible={userMenuOpen}
            onVisibleChange={(visible) => {
              if (visible) setUserMenuWidth(userTriggerRef.current?.offsetWidth);
              setUserMenuOpen(visible);
            }}
          >
            <div ref={userTriggerRef} className='flex items-center gap-2.5 px-2 py-2.5 cursor-pointer transition-colors rd-12px w-full border hover:bg-hover active:bg-fill-2'>
              <div className='size-8 rd-50% bg-fill-3 f-center text-foreground text-14px font-bold shrink-0'>{userInfo.avatar ? <img src={userInfo.avatar} alt={userInfo.name} className='w-full h-full rd-50% object-cover' /> : <span>{userInfo.name.charAt(0).toUpperCase()}</span>}</div>
              <div className='flex-1 min-w-0'>
                <div className='text-14px font-medium text-foreground truncate'>{userInfo.name}</div>
                <div className='text-12px text-secondary truncate'>{userInfo.email}</div>
              </div>
              <Down theme='outline' size='16' fill={'var(--text-secondary)'} className='shrink-0' />
            </div>
          </Dropdown>
        ) : (
          /* 设置页面 - 主题切换 + 返回按钮 */
          <div className='flex flex-col gap-0.5'>
            {/* 返回按钮 */}
            <div className='flex items-center gap-2.5 px-1 py-2.5 rd-8px cursor-pointer transition-colors hover:bg-hover active:bg-fill-2 ml-0.5' onClick={handleSettingsClick}>
              <div className='size-8 rd-50% bg-fill-3 f-center text-foreground text-14px font-bold shrink-0'>
                <Return theme='outline' size='16' fill={'var(--foreground)'} />
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
