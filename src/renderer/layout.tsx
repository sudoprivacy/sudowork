/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/storage';
import PwaPullToRefresh from '@/renderer/components/PwaPullToRefresh';
import CommandPalette from '@/renderer/components/CommandPalette';
import { useCommandPalette } from '@/renderer/hooks/useCommandPalette';
import Titlebar from '@/renderer/components/Titlebar';
import { Layout as ArcoLayout } from '@arco-design/web-react';
import { ExpandLeft, ExpandRight } from '@icon-park/react';
import classNames from 'classnames';
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutContext } from './context/LayoutContext';
import { useTenantConfig } from './context/TenantConfigContext';
import { useDeepLink } from './hooks/useDeepLink';
import { useDirectorySelection } from './hooks/useDirectorySelection';
import { useMultiAgentDetection } from './hooks/useMultiAgentDetection';
import { cleanupSiderTooltips } from './utils/siderTooltip';
import { emitter } from './utils/emitter';
import { isElectronDesktop } from './utils/platform';
import SudoworkIcon from './assets/sudowork-icon-dark.svg';
const useDebug = () => {
  const [count, setCount] = useState(0);
  const timer = useRef<any>(null);
  const onClick = () => {
    const open = () => {
      ipcBridge.application.openDevTools.invoke().catch((error) => {
        console.error('Failed to open dev tools:', error);
      });
      setCount(0);
    };
    if (count >= 3) {
      return open();
    }
    setCount((prev) => {
      if (prev >= 2) {
        open();
        return 0;
      }
      return prev + 1;
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      clearTimeout(timer.current);
      setCount(0);
    }, 1000);
  };

  return { onClick };
};

const UpdateModal = React.lazy(() => import('@/renderer/components/UpdateModal'));

const DEFAULT_SIDER_WIDTH = 260;
const MOBILE_SIDER_WIDTH_RATIO = 0.67;
const MOBILE_SIDER_MIN_WIDTH = 260;
const MOBILE_SIDER_MAX_WIDTH = 420;

const detectMobileViewportOrTouch = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (isElectronDesktop()) {
    return window.innerWidth < 768;
  }
  const width = window.innerWidth;
  const byWidth = width < 768;
  // 仅在小屏时才将 coarse/touch 视为移动端，避免触控笔记本被误判
  // Treat touch/coarse pointer as mobile only on smaller viewports
  const smallScreen = width < 1024;
  const byMedia = window.matchMedia('(hover: none)').matches || window.matchMedia('(pointer: coarse)').matches;
  const byTouchPoints = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  return byWidth || (smallScreen && (byMedia || byTouchPoints));
};

const Layout: React.FC<{
  sider: React.ReactNode;
  onSessionClick?: () => void;
}> = ({ sider, onSessionClick: _onSessionClick }) => {
  const { config } = useTenantConfig(); // 获取租户配置
  const { visible: commandPaletteVisible, close: closeCommandPalette } = useCommandPalette();
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number>(() => (typeof window === 'undefined' ? 390 : window.innerWidth));
  const { onClick } = useDebug();
  const navigate = useNavigate();
  // 点击侧栏顶部 logo / 应用名时回到新会话页，行为与「新会话」按钮一致
  // Clicking the sidebar-top logo / app name returns to the new conversation page, matching the "New Chat" button
  const goToNewConversation = useCallback(() => {
    cleanupSiderTooltips();
    // 清除持久化的 agent 选择，确保新会话时不恢复之前的助手
    void ConfigStorage.set('guid.lastSelectedAgent', '');
    // 触发 Guide 页面重置所有用户输入状态
    emitter.emit('guid.reset');
    void navigate('/guid');
    if (isMobile) setCollapsed(true);
  }, [navigate, isMobile]);
  const { contextHolder: multiAgentContextHolder } = useMultiAgentDetection();
  const { contextHolder: directorySelectionContextHolder } = useDirectorySelection();
  useDeepLink();
  const location = useLocation();
  const workspaceAvailable = location.pathname.startsWith('/conversation/');
  const collapsedRef = useRef(collapsed);

  // 检测移动端并响应窗口大小变化
  useEffect(() => {
    const checkMobile = () => {
      const mobile = detectMobileViewportOrTouch();
      setIsMobile(mobile);
      setViewportWidth(window.innerWidth);
    };

    // 初始检测
    checkMobile();

    // 监听窗口大小变化
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 进入移动端后立即折叠 / Collapse immediately when switching to mobile
  useEffect(() => {
    if (!isMobile || collapsedRef.current) {
      return;
    }
    setCollapsed(true);
  }, [isMobile]);

  // 清理侧栏 Tooltip 残留节点，避免移动端路由切换后浮层卡在左上角
  useEffect(() => {
    cleanupSiderTooltips();
  }, [isMobile, collapsed, location.pathname, location.search, location.hash]);

  // Bridge Main Process logs to F12 Console
  useEffect(() => {
    const unsubscribe = ipcBridge.application.logStream.on((entry) => {
      const prefix = `%c[Main:${entry.tag}]%c ${entry.message}`;
      const style = 'color:#7c3aed;font-weight:bold';
      if (entry.level === 'error') {
        console.error(prefix, style, 'color:inherit', ...(entry.data !== undefined ? [entry.data] : []));
      } else if (entry.level === 'warn') {
        console.warn(prefix, style, 'color:inherit', ...(entry.data !== undefined ? [entry.data] : []));
      } else {
        console.log(prefix, style, 'color:inherit', ...(entry.data !== undefined ? [entry.data] : []));
      }
    });
    return () => unsubscribe();
  }, []);

  const siderWidth = isMobile ? Math.max(MOBILE_SIDER_MIN_WIDTH, Math.min(MOBILE_SIDER_MAX_WIDTH, Math.round(viewportWidth * MOBILE_SIDER_WIDTH_RATIO))) : DEFAULT_SIDER_WIDTH;
  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);

  // Memoize the context value to prevent unnecessary re-renders of all
  // LayoutContext consumers when unrelated state (e.g. viewportWidth) changes.
  // Without this, every resize event creates a new object reference, causing
  // all consumers (including ChatWorkspace) to re-render.
  const layoutContextValue = useMemo(() => ({ isMobile, siderCollapsed: collapsed, setSiderCollapsed: setCollapsed }), [isMobile, collapsed, setCollapsed]);

  return (
    <LayoutContext.Provider value={layoutContextValue}>
      <div className='app-shell relative flex flex-col size-full min-h-0'>
        <Titlebar workspaceAvailable={workspaceAvailable} />
        {/* 移动端左侧边栏蒙板 / Mobile left sider backdrop */}
        {isMobile && !collapsed && <div className='fixed inset-0 bg-black/30 z-90' onClick={() => setCollapsed(true)} aria-hidden='true' />}

        <ArcoLayout className={'size-full layout flex-1 min-h-0'}>
          <ArcoLayout.Sider
            collapsedWidth={isMobile ? 0 : 64}
            collapsed={collapsed}
            width={siderWidth}
            className={classNames('layout-sider', {
              collapsed: collapsed,
            })}
            style={
              isMobile
                ? {
                    position: 'fixed',
                    left: 0,
                    zIndex: 100,
                    background: 'var(--bg-2)',
                    transform: collapsed ? 'translateX(-100%)' : 'translateX(0)',
                    pointerEvents: collapsed ? 'none' : 'auto',
                  }
                : undefined
            }
          >
            <ArcoLayout.Header className={classNames('flex items-center justify-start py-8px px-16px pl-18px gap-10px layout-sider-header', isMobile && 'layout-sider-header--mobile')}>
              <div
                className={classNames('shrink-0 size-34px relative rd-0.5rem flex items-center justify-center', {
                  // hover 区域限定在 logo 盒子本身，避免收起动画时侧栏边缘扫过指针误触发 hover
                  // Scope the hover group to the logo box so the collapsing edge sweeping under the cursor won't trigger it
                  '!size-24px group cursor-pointer': collapsed,
                })}
                // 收起态（桌面端）点击 logo 区域即展开侧栏；展开态/移动端点击回到新会话页（保留调试三连击入口）
                // Collapsed (desktop): clicking the logo expands the sidebar; expanded/mobile: go to the new conversation page (debug triple-tap preserved)
                onClick={
                  collapsed && !isMobile
                    ? () => setCollapsed(false)
                    : () => {
                        onClick();
                        goToNewConversation();
                      }
                }
                aria-label={collapsed && !isMobile ? 'Expand sidebar' : 'New conversation'}
              >
                <img
                  src={config.logo || SudoworkIcon}
                  alt={config.app_name}
                  className={classNames('absolute inset-0 m-auto transition-opacity', {
                    'w-5 h-5 p-0.5 scale-130': !collapsed,
                    'w-4 h-4 p-0.5': collapsed,
                    // 收起态 hover 时淡出 logo，露出展开图标 / Fade logo out on hover to reveal expand icon
                    'group-hover:opacity-0': collapsed && !isMobile,
                  })}
                  style={{ objectFit: 'contain' }}
                />
                {collapsed && !isMobile && (
                  <span className='absolute inset-0 flex items-center justify-center text-1 opacity-0 transition-opacity group-hover:opacity-100'>
                    <ExpandLeft theme='outline' size='18' fill='currentColor' />
                  </span>
                )}
              </div>
              <div className='flex-1 text-20px text-1 collapsed-hidden font-800 cursor-pointer' onClick={goToNewConversation}>
                {config.app_name}
              </div>
              {/* 桌面端展开态：logo 右侧收起按钮 / Desktop expanded: collapse button to the right of the logo */}
              {!isMobile && !collapsed && (
                <button type='button' className='shrink-0 size-28px flex items-center justify-center rd-6px text-1 border-none bg-transparent cursor-pointer transition-colors hover:bg-[var(--bg-hover)]' onClick={() => setCollapsed(true)} aria-label='Collapse sidebar'>
                  <ExpandRight theme='outline' size='18' fill='currentColor' />
                </button>
              )}
              {isMobile && !collapsed && (
                <button type='button' className='app-titlebar__button' onClick={() => setCollapsed(true)} aria-label='Collapse sidebar'>
                  <ExpandRight theme='outline' size='18' fill='currentColor' />
                </button>
              )}
            </ArcoLayout.Header>
            <ArcoLayout.Content className={classNames('p-10px layout-sider-content', !isMobile && 'h-[calc(100%-58px-16px)]')}>
              {React.isValidElement(sider)
                ? React.cloneElement(sider, {
                    onSessionClick: () => {
                      cleanupSiderTooltips();
                      if (isMobile) setCollapsed(true);
                    },
                    collapsed,
                  } as any)
                : sider}
            </ArcoLayout.Content>
          </ArcoLayout.Sider>

          <ArcoLayout.Content
            className={'bg-1 layout-content flex flex-col min-h-0'}
            onClick={() => {
              if (isMobile && !collapsed) setCollapsed(true);
            }}
            style={
              isMobile
                ? {
                    width: '100%',
                  }
                : undefined
            }
          >
            <Outlet />
            {multiAgentContextHolder}
            {directorySelectionContextHolder}
            <PwaPullToRefresh />
            <Suspense fallback={null}>
              <UpdateModal />
            </Suspense>
            {/* Safety warning modal is hidden while the safety hook feature is disabled. */}
            <CommandPalette visible={commandPaletteVisible} onClose={closeCommandPalette} />
          </ArcoLayout.Content>
        </ArcoLayout>
      </div>
    </LayoutContext.Provider>
  );
};

export default Layout;
