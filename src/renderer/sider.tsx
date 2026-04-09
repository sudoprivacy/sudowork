import { ArrowCircleLeft, Down, Earth, Lightning, ListCheckbox, Logout, Plus, Robot, SettingTwo, Shield, Toolkit } from '@icon-park/react';
import { IconHome } from '@arco-design/web-react/icon';
import classNames from 'classnames';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { iconColors } from './theme/colors';
import { Dropdown, Menu, Message, Tooltip } from '@arco-design/web-react';
import { cleanupSiderTooltips, getSiderTooltipProps } from './utils/siderTooltip';
import { useLayoutContext } from './context/LayoutContext';
import { blurActiveElement } from './utils/focus';
import { isElectronDesktop } from './utils/platform';
import { useAuth } from './context/AuthContext';
import { emitter } from './utils/emitter';
import { ConfigStorage } from '@/common/storage';
import { sudoclaw as sudoclawIpc } from '@/common/ipcBridge';
import type { ISudoClawPersistentStatus, SudoClawSessionState } from '@/common/ipcBridge';

const WorkspaceGroupedHistory = React.lazy(() => import('./pages/conversation/WorkspaceGroupedHistory'));
const SettingsSider = React.lazy(() => import('./pages/settings/SettingsSider'));

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
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const isSettings = pathname.startsWith('/settings');
  const lastNonSettingsPathRef = useRef('/guid');

  // 从 AuthContext 获取实际用户信息
  const userInfo = {
    email: currentUser?.phone || '',
    name: currentUser?.nickname || 'Sudowork 用户',
    avatar: null as string | null,
  };

  // ── SudoClaw persistent mode status ──
  const [sudoClawStatus, setSudoClawStatus] = useState<ISudoClawPersistentStatus | null>(null);

  const refreshSudoClawStatus = useCallback(async () => {
    try {
      const res = await sudoclawIpc.persistentStatus.invoke();
      if (res?.success && res.data) {
        setSudoClawStatus(res.data);
      }
    } catch {
      // Silently ignore
    }
  }, []);

  useEffect(() => {
    void refreshSudoClawStatus();
  }, [refreshSudoClawStatus]);

  useEffect(() => {
    const unsubscribe = sudoclawIpc.persistentStatusChanged.on((newStatus) => {
      setSudoClawStatus(newStatus);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  /** Dot color for SudoClaw persistent mode status */
  const sudoClawDotColor: string | null = (() => {
    if (!sudoClawStatus?.enabled) return null;
    const state = sudoClawStatus.sessionState;
    if (state === 'running' || state === 'sleeping') return '#52c41a'; // green
    if (state === 'requires_action') return '#fa8c16'; // orange
    if (state === 'error') return '#f5222d'; // red
    return null;
  })();

  // 功能菜单项定义 / Function menu items definition
  const functionMenus = [
    { id: 'skill-store', label: '技能商店', icon: Lightning, path: '/settings/skill' },
    { id: 'agent', label: '数字助手', icon: Robot, path: '/settings/agent' },
    { id: 'security', label: '安全防护', icon: Shield, path: '/settings/security' },
    { id: 'webui', label: '远程连接', icon: Earth, path: '/settings/webui' },
  ];

  // 处理功能菜单点击 — 在 GuidPage 内联显示，通过 query param 传递 menuId
  const handleFunctionMenuClick = (menuId: string) => {
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
    showTitle: false, // 我们已经在上面渲染了标题
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
                  className={classNames('h-40px flex items-center gap-10px px-16px mb-12px rd-10px cursor-pointer transition-all border border-solid', 'border-[var(--color-border-2)] bg-1 hover:bg-hover hover:border-[var(--color-border-3)] active:bg-fill-2')}
                  onClick={() => {
                    cleanupSiderTooltips();
                    blurActiveElement();
                    setIsBatchMode(false);
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
            <div className='mb-16px flex flex-col gap-1px'>
              {functionMenus.map((menu) => {
                const isSelected = pathname.startsWith('/guid') && new URLSearchParams(search).get('menu') === menu.id;
                return (
                  <Tooltip key={menu.id} {...siderTooltipProps} content={collapsed ? menu.label : undefined} position='right'>
                    <div
                      className={classNames('flex items-center gap-12px px-8px py-10px rd-8px cursor-pointer transition-colors hover:bg-hover active:bg-fill-2', collapsed && 'justify-center px-0', {
                        '!bg-aou-2': isSelected,
                      })}
                      onClick={() => {
                        cleanupSiderTooltips();
                        blurActiveElement();
                        handleFunctionMenuClick(menu.id);
                        if (onSessionClick) {
                          onSessionClick();
                        }
                      }}
                    >
                      <div className={classNames('w-20px h-20px flex items-center justify-center shrink-0', isSelected ? 'text-aou-6' : 'text-t-secondary')}>
                        <menu.icon theme='outline' size='20' className='block leading-none' />
                      </div>
                      {!collapsed && <span className={classNames('flex-1 text-14px leading-24px whitespace-nowrap overflow-hidden text-ellipsis', isSelected ? 'text-aou-6 font-medium' : 'text-t-primary')}>{menu.label}</span>}
                    </div>
                  </Tooltip>
                );
              })}
            </div>

            {/* SudoClaw persistent mode status indicator */}
            {sudoClawDotColor && (
              <Tooltip
                {...siderTooltipProps}
                content={
                  sudoClawStatus?.sessionState === 'requires_action'
                    ? t('sudoclaw.persistent.state.requiresAction', { defaultValue: 'SudoClaw: Action required' })
                    : t('sudoclaw.persistent.state.running', { defaultValue: 'SudoClaw: Running' })
                }
                position='right'
              >
                <div className={classNames('mb-8px px-8px flex items-center gap-8px rd-8px py-6px transition-colors hover:bg-hover', collapsed && 'justify-center px-0')}>
                  <span
                    className='inline-block rd-50% shrink-0'
                    style={{
                      width: 8,
                      height: 8,
                      backgroundColor: sudoClawDotColor,
                      animation: sudoClawStatus?.sessionState === 'running' ? 'sudoclaw-pulse 2s ease-in-out infinite' : undefined,
                    }}
                  />
                  {!collapsed && (
                    <span className='text-13px text-t-secondary truncate'>
                      {t('sudoclaw.persistent.label', { defaultValue: 'SudoClaw' })}
                      {sudoClawStatus?.pendingQuestion && <span className='text-warning ml-4px'>⚠</span>}
                    </span>
                  )}
                </div>
              </Tooltip>
            )}

            {/* 所有对话标题 + 批量管理按钮 / All records title + Batch mode button */}
            <div className={classNames('mb-8px px-8px flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
              {!collapsed && <span className='text-13px font-medium text-t-secondary'>{t('conversation.history.allRecords', { defaultValue: '所有对话' })}</span>}
              <Tooltip {...siderTooltipProps} content={isBatchMode ? t('conversation.history.batchModeExit') : t('conversation.history.batchManage')} position='right'>
                <div className={classNames('w-32px h-32px flex items-center justify-center rd-8px cursor-pointer transition-all shrink-0', isBatchMode ? 'bg-[rgba(var(--primary-6),0.12)] text-primary-6' : 'hover:bg-hover active:bg-fill-2 text-t-secondary')} onClick={handleToggleBatchMode}>
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
                      Message.success('已退出登录');
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
            <div className={classNames('flex items-center gap-10px px-8px py-10px rd-8px cursor-pointer transition-colors', collapsed ? 'justify-center px-2px w-40px h-40px hover:bg-hover active:bg-fill-2' : 'w-full border border-solid border-[var(--color-border-2)] hover:bg-hover active:bg-fill-2')}>
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
