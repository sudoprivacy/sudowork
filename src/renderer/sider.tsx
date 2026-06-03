import { AlarmClock, ArrowCircleLeft, Down, Earth, Lightning, ListCheckbox, Logout, Plus, Robot, SettingTwo, Shield, Toolkit } from '@icon-park/react';
import { IconHome } from '@arco-design/web-react/icon';
import classNames from 'classnames';
import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { iconColors } from './theme/colors';
import { Dropdown, Menu, Message, Tooltip } from '@arco-design/web-react';
import { cleanupSiderTooltips, getSiderTooltipProps } from './utils/siderTooltip';
import { useLayoutContext } from './context/LayoutContext';
import { blurActiveElement } from './utils/focus';
import { isElectronDesktop } from './utils/platform';
import { useAuth } from './context/AuthContext';
import { addEventListener, emitter } from './utils/emitter';
import { ConfigStorage } from '@/common/storage';
import { useAppMode } from './hooks/useAppMode';
import SidebarNavItem from './components/ui/SidebarNavItem';
import SidebarSegmentedControl from './components/ui/SidebarSegmentedControl';

const WorkspaceGroupedHistory = React.lazy(() => import('./pages/conversation/WorkspaceGroupedHistory'));
const SettingsSider = React.lazy(() => import('./pages/settings/SettingsSider'));

/**
 * 手机号脱敏：保留前 3 位和后 4 位，中间用 **** 替代。
 * 例：13812345678 → 138****5678
 */
function maskPhone(phone: string): string {
  if (!phone) return '';
  // 仅对 11 位纯数字手机号做脱敏，其他格式原样返回
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}****${digits.slice(7)}`;
  }
  return phone;
}

interface SiderProps {
  onSessionClick?: () => void;
  collapsed?: boolean;
}

const Sider: React.FC<SiderProps> = ({ onSessionClick, collapsed = false }) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const { pathname, search, hash } = useLocation();

  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout, user: currentUser } = useAuth();
  const { isEnterprise } = useAppMode();
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Sidebar tab state: 'timeline' or 'scheduled'
  const SIDER_TAB_STORAGE_KEY = 'aionui_sider_tab';
  const [activeTab, setActiveTab] = useState<'timeline' | 'scheduled'>(() => {
    try {
      const stored = localStorage.getItem(SIDER_TAB_STORAGE_KEY);
      if (stored === 'scheduled') return 'scheduled';
    } catch {
      // ignore
    }
    return 'timeline';
  });

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
  const isSettings = pathname.startsWith('/settings');
  const lastNonSettingsPathRef = useRef('/guid');

  // 从 AuthContext 获取实际用户信息（手机号脱敏展示）
  const userInfo = {
    email: maskPhone(currentUser?.phone || ''),
    name: currentUser?.nickname || 'Sudowork 用户',
    avatar: null as string | null,
  };

  // 功能菜单项定义 / Function menu items definition
  const functionMenus = [{ id: 'agent', label: t('common.siderMenu.agent'), icon: Robot, path: '/settings/agent' }, { id: 'skill-store', label: t('common.siderMenu.skillStore'), icon: Lightning, path: '/settings/skill' }, { id: 'security', label: t('common.siderMenu.security'), icon: Shield, path: '/settings/security' }, ...(!isEnterprise ? [{ id: 'webui' as const, label: t('common.siderMenu.webui'), icon: Earth, path: '/settings/webui' }] : []), { id: 'cron', label: t('common.siderMenu.cron'), icon: AlarmClock, path: '/settings/cron' }];

  // 处理功能菜单点击 — 在 GuidPage 内联显示，通过 query param 传递 menuId
  const handleFunctionMenuClick = (menuId: string) => {
    const nextTab: 'timeline' | 'scheduled' = menuId === 'cron' ? 'scheduled' : 'timeline';
    setActiveTab(nextTab);
    try {
      localStorage.setItem(SIDER_TAB_STORAGE_KEY, nextTab);
    } catch {
      // ignore
    }
    void navigate(`/guid?menu=${menuId}`);
  };

  useEffect(() => {
    if (!pathname.startsWith('/settings')) {
      lastNonSettingsPathRef.current = `${pathname}${search}${hash}`;
    }
  }, [pathname, search, hash]);

  const handleSettingsClick = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    if (isSettings) {
      const target = lastNonSettingsPathRef.current || '/guid';
      Promise.resolve(navigate(target)).catch((error) => {
        console.error('Navigation failed:', error);
      });
    } else {
      Promise.resolve(navigate('/settings/agent')).catch((error) => {
        console.error('Navigation failed:', error);
      });
    }
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleToggleBatchMode = () => {
    setIsBatchMode((prev) => !prev);
  };

  const workspaceHistoryProps = {
    collapsed,
    tooltipEnabled: collapsed && !isMobile,
    onSessionClick: () => {
      if (onSessionClick) {
        onSessionClick();
      }
    },
    batchMode: isBatchMode,
    onBatchModeChange: setIsBatchMode,
    activeTab,
  };
  const tooltipEnabled = collapsed && !isMobile;
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);
  const isDesktop = isElectronDesktop();

  return (
    <div className='size-full flex flex-col'>
      {/* Main content area */}
      <div className='flex-1 min-h-0 overflow-y-auto scrollbar-hide'>
        {isSettings ? (
          <Suspense fallback={<div className='size-full' />}>
            <SettingsSider collapsed={collapsed} tooltipEnabled={tooltipEnabled}></SettingsSider>
          </Suspense>
        ) : (
          <div className='size-full flex flex-col py-8px overflow-hidden'>
            {/* 新会话按钮 - 带边框的按钮风格 / New Chat button with border style */}
            <Tooltip {...siderTooltipProps} content={t('conversation.welcome.newConversation')} position='right'>
              {collapsed ? (
                <div
                  className='w-full h-40px flex items-center justify-center mb-12px rd-10px cursor-pointer transition-colors hover:bg-hover active:bg-fill-2'
                  onClick={() => {
                    cleanupSiderTooltips();
                    blurActiveElement();
                    setIsBatchMode(false);
                    // 清除持久化的 agent 选择，确保新会话时不恢复之前的助手
                    void ConfigStorage.set('guid.lastSelectedAgent', '');
                    // 触发 Guide 页面重置所有用户输入状态
                    emitter.emit('guid.reset');
                    void navigate('/guid');
                    if (onSessionClick) {
                      onSessionClick();
                    }
                  }}
                >
                  <div className='w-32px h-32px flex items-center justify-center rd-50% bg-[var(--color-fill-3)] text-t-secondary shrink-0'>
                    <Plus theme='outline' size='18' fill='currentColor' className='block leading-none' />
                  </div>
                </div>
              ) : (
                <div
                  className={classNames('h-40px flex items-center gap-10px px-16px mb-12px rd-10px cursor-pointer transition-all border border-solid', 'border-[var(--ui-border-strong)] bg-1 hover:bg-hover active:bg-fill-2')}
                  onClick={() => {
                    cleanupSiderTooltips();
                    blurActiveElement();
                    setIsBatchMode(false);
                    // 清除持久化的 agent 选择，确保新会话时不恢复之前的助手
                    void ConfigStorage.set('guid.lastSelectedAgent', '');
                    // 触发 Guide 页面重置所有用户输入状态
                    emitter.emit('guid.reset');
                    void navigate('/guid');
                    if (onSessionClick) {
                      onSessionClick();
                    }
                  }}
                >
                  <div className='w-32px h-32px flex items-center justify-center rd-50% bg-[var(--color-fill-3)] text-t-secondary shrink-0'>
                    <Plus theme='outline' size='18' fill='currentColor' className='block leading-none' />
                  </div>
                  <span className='flex-1 text-15px font-medium text-t-primary text-center truncate'>{t('conversation.welcome.newConversation')}</span>
                </div>
              )}
            </Tooltip>

            {/* 功能菜单区域 / Function menu area */}
            <div className='mb-16px flex flex-col gap-2px'>
              {functionMenus.map((menu) => {
                const isSelected = pathname.startsWith('/guid') && new URLSearchParams(search).get('menu') === menu.id;
                return (
                  <Tooltip key={menu.id} {...siderTooltipProps} content={collapsed ? menu.label : undefined} position='right'>
                    <SidebarNavItem
                      icon={<menu.icon theme='outline' size='20' className='block leading-none' />}
                      label={menu.label}
                      selected={isSelected}
                      collapsed={collapsed}
                      onClick={() => {
                        cleanupSiderTooltips();
                        blurActiveElement();
                        handleFunctionMenuClick(menu.id);
                        if (onSessionClick) {
                          onSessionClick();
                        }
                      }}
                    />
                  </Tooltip>
                );
              })}
            </div>

            {/* Session history tabs + batch mode button */}
            <div className={classNames('mb-8px px-8px flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
              {!collapsed && (
                <SidebarSegmentedControl
                  className='flex-1'
                  value={activeTab}
                  options={[
                    { value: 'timeline', label: t('conversation.history.timeline', { defaultValue: '对话' }) },
                    { value: 'scheduled', label: t('conversation.history.scheduledTab', { defaultValue: '定时任务' }) },
                  ]}
                  onChange={(tab) => {
                    setActiveTab(tab);
                    try {
                      localStorage.setItem(SIDER_TAB_STORAGE_KEY, tab);
                    } catch {
                      // ignore
                    }
                  }}
                />
              )}
              <Tooltip {...siderTooltipProps} content={isBatchMode ? t('conversation.history.batchModeExit') : t('conversation.history.batchManage')} position='right'>
                <div className={classNames('w-32px h-32px flex items-center justify-center rd-8px cursor-pointer transition-all shrink-0', isBatchMode ? 'bg-[rgba(var(--ui-accent-orange-rgb),0.12)] text-[var(--ui-accent-orange)]' : 'hover:bg-hover active:bg-fill-2 text-t-secondary')} onClick={handleToggleBatchMode}>
                  <ListCheckbox theme='outline' size='18' className='block leading-none' />
                </div>
              </Tooltip>
            </div>

            <Suspense fallback={<div className='flex-1 min-h-0' />}>
              <WorkspaceGroupedHistory {...workspaceHistoryProps}></WorkspaceGroupedHistory>
            </Suspense>
          </div>
        )}
      </div>
      {/* Footer - User info area */}
      <div className={classNames('shrink-0 sider-footer mt-auto pt-8px px-0px', isSettings ? '' : 'pr-16px')}>
        {!isSettings ? (
          /* 用户信息下拉菜单 */
          <Dropdown
            droplist={
              <Menu
                style={{ width: '250px' }}
                onClickMenuItem={(key) => {
                  if (key === 'settings') {
                    handleSettingsClick();
                  } else if (key === 'logout') {
                    console.log('Logout clicked');
                  }
                  setUserMenuOpen(false);
                }}
              >
                <Menu.Item key='settings'>
                  <div className='flex items-center gap-8px'>
                    <SettingTwo theme='outline' size='18' />
                    <span>{t('common.settings')}</span>
                  </div>
                </Menu.Item>
                <Menu.Item key='logout'>
                  <div
                    className='flex items-center gap-8px text-[rgb(var(--danger-6))]'
                    onClick={async () => {
                      await logout();
                      Message.success(t('login.logoutSuccess'));
                      void navigate('/login', { replace: true });
                    }}
                  >
                    <Logout theme='outline' size='18' />
                    <span>{t('login.logout', { defaultValue: '退出登录' })}</span>
                  </div>
                </Menu.Item>
              </Menu>
            }
            trigger='click'
            position='tr'
            popupVisible={userMenuOpen}
            onVisibleChange={setUserMenuOpen}
          >
            <div className={classNames('flex items-center gap-10px px-8px py-10px rd-8px cursor-pointer transition-colors', collapsed ? 'justify-center px-2px w-40px h-40px hover:bg-hover active:bg-fill-2' : 'w-full border border-solid border-[var(--ui-border-strong)] hover:bg-hover active:bg-fill-2')}>
              <div className='w-32px h-32px rd-50% bg-[var(--color-fill-3)] flex items-center justify-center text-t-primary text-14px font-bold shrink-0'>{userInfo.avatar ? <img src={userInfo.avatar} alt={userInfo.name} className='w-full h-full rd-50% object-cover' /> : <span>{userInfo.name.charAt(0).toUpperCase()}</span>}</div>
              {!collapsed && (
                <>
                  <div className='flex-1 min-w-0'>
                    <div className='text-14px font-medium text-t-primary truncate'>{userInfo.name}</div>
                    <div className='text-12px text-t-secondary truncate'>{userInfo.email}</div>
                  </div>
                  <Down theme='outline' size='16' fill={iconColors.secondary} className='shrink-0' />
                </>
              )}
            </div>
          </Dropdown>
        ) : (
          /* 设置页面 - 主题切换 + 返回按钮 */
          <div className='flex flex-col gap-2px'>
            {/* 返回按钮 */}
            <div className={classNames('flex items-center gap-10px px-4px py-10px rd-8px cursor-pointer transition-colors hover:bg-hover active:bg-fill-2', collapsed ? 'justify-center mr-2px' : 'ml-2px')} onClick={handleSettingsClick}>
              <div className='w-32px h-32px rd-50% bg-[var(--color-fill-3)] flex items-center justify-center text-t-primary text-14px font-bold shrink-0'>
                <IconHome style={{ fontSize: 16 }} />
              </div>
              {!collapsed && (
                <div className='flex-1 min-w-0'>
                  <div className='text-14px font-medium text-t-primary truncate'>{t('common.back')}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sider;
