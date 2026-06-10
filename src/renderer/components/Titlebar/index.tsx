import React, { useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { ArrowCircleLeft, ExpandLeft, ExpandRight, MenuFold, MenuUnfold, Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import WindowControls from '../WindowControls';
import { WORKSPACE_STATE_EVENT, dispatchWorkspaceToggleEvent } from '@renderer/utils/workspaceEvents';
import type { WorkspaceStateDetail } from '@renderer/utils/workspaceEvents';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { isElectronDesktop, isMacOS } from '@/renderer/utils/platform';

interface TitlebarProps {
  workspaceAvailable: boolean;
}

const Titlebar: React.FC<TitlebarProps> = ({ workspaceAvailable }) => {
  const { t } = useTranslation();
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(true);
  const layout = useLayoutContext();
  const location = useLocation();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const lastNonSettingsPathRef = useRef('/guid');

  // 监听工作空间折叠状态，保持按钮图标一致 / Sync workspace collapsed state for toggle button
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<WorkspaceStateDetail>;
      if (typeof customEvent.detail?.collapsed === 'boolean') {
        setWorkspaceCollapsed(customEvent.detail.collapsed);
      }
    };
    window.addEventListener(WORKSPACE_STATE_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(WORKSPACE_STATE_EVENT, handler as EventListener);
    };
  }, []);

  const isDesktopRuntime = isElectronDesktop();
  const isMacRuntime = isDesktopRuntime && isMacOS();
  // Windows/Linux 显示自定义窗口按钮；macOS 在标题栏给工作区一个切换入口
  const showWindowControls = isDesktopRuntime && !isMacRuntime;
  // WebUI 和 macOS 桌面都需要在标题栏放工作区开关
  const showWorkspaceButton = workspaceAvailable && (!isDesktopRuntime || isMacRuntime);

  const workspaceTooltip = workspaceCollapsed ? t('common.expandMore', { defaultValue: 'Expand workspace' }) : t('common.collapse', { defaultValue: 'Collapse workspace' });
  const newConversationTooltip = t('conversation.workspace.createNewConversation');
  const backToChatTooltip = t('common.back', { defaultValue: 'Back to Chat' });
  const isSettingsRoute = location.pathname.startsWith('/settings');
  const iconSize = layout?.isMobile ? 24 : 18;
  // 移动端侧栏为抽屉式，收起后移出屏幕，开关只能留在标题栏；桌面端开关已移到 logo 右侧
  // Mobile sidebar is a drawer that slides off-screen when collapsed, so its toggle must stay on the titlebar; desktop toggle now lives beside the logo
  const showSiderToggle = Boolean(layout?.isMobile && layout?.setSiderCollapsed) && !isSettingsRoute;
  const showBackToChatButton = Boolean(layout?.isMobile && isSettingsRoute);
  const showNewConversationButton = Boolean(layout?.isMobile && workspaceAvailable);
  const siderTooltip = layout?.siderCollapsed ? t('common.expandMore', { defaultValue: 'Expand sidebar' }) : t('common.collapse', { defaultValue: 'Collapse sidebar' });

  const handleSiderToggle = () => {
    if (!showSiderToggle || !layout?.setSiderCollapsed) return;
    layout.setSiderCollapsed(!layout.siderCollapsed);
  };

  const handleWorkspaceToggle = () => {
    if (!workspaceAvailable) {
      return;
    }
    dispatchWorkspaceToggleEvent();
  };

  const handleCreateConversation = () => {
    void navigate('/guid');
  };

  const handleBackToChat = () => {
    const target = lastNonSettingsPathRef.current;
    if (target && !target.startsWith('/settings')) {
      void navigate(target);
      return;
    }
    void navigate(-1);
  };

  useEffect(() => {
    if (!isSettingsRoute) {
      const path = `${location.pathname}${location.search}${location.hash}`;
      lastNonSettingsPathRef.current = path;
      try {
        sessionStorage.setItem('aion:last-non-settings-path', path);
      } catch {
        // ignore
      }
      return;
    }
    try {
      const stored = sessionStorage.getItem('aion:last-non-settings-path');
      if (stored) {
        lastNonSettingsPathRef.current = stored;
      }
    } catch {
      // ignore
    }
  }, [isSettingsRoute, location.pathname, location.search, location.hash]);

  const menuStyle: React.CSSProperties = useMemo(() => {
    if (!isMacRuntime || !showSiderToggle) return {};

    const marginLeft = layout?.isMobile ? '0px' : layout?.siderCollapsed ? '60px' : '210px';
    return {
      marginLeft,
      transition: 'margin-left 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
    };
  }, [isMacRuntime, showSiderToggle, layout?.isMobile, layout?.siderCollapsed]);

  return (
    <div
      className={classNames('flex items-center gap-8px app-titlebar bg-2 border-b border-[var(--border-base)]', {
        'app-titlebar--mobile': layout?.isMobile,
        'app-titlebar--mobile-conversation': layout?.isMobile && workspaceAvailable,
        'app-titlebar--desktop': isDesktopRuntime,
        'app-titlebar--mac': isMacRuntime,
      })}
    >
      <div ref={menuRef} className='app-titlebar__menu' style={menuStyle}>
        {showBackToChatButton && (
          <button type='button' className={classNames('app-titlebar__button', layout?.isMobile && 'app-titlebar__button--mobile')} onClick={handleBackToChat} aria-label={backToChatTooltip}>
            <ArrowCircleLeft theme='outline' size={iconSize} fill='currentColor' />
          </button>
        )}
        {showSiderToggle && (
          <button type='button' className={classNames('app-titlebar__button', layout?.isMobile && 'app-titlebar__button--mobile')} onClick={handleSiderToggle} aria-label={siderTooltip}>
            {layout?.siderCollapsed ? <MenuUnfold theme='outline' size={iconSize} fill='currentColor' /> : <MenuFold theme='outline' size={iconSize} fill='currentColor' />}
          </button>
        )}
      </div>
      <div className='app-titlebar__toolbar'>
        {showNewConversationButton && (
          <button type='button' className={classNames('app-titlebar__button', layout?.isMobile && 'app-titlebar__button--mobile')} onClick={handleCreateConversation} aria-label={newConversationTooltip}>
            <Plus theme='outline' size={iconSize} fill='currentColor' />
          </button>
        )}
        {showWorkspaceButton && (
          <button type='button' className={classNames('app-titlebar__button', layout?.isMobile && 'app-titlebar__button--mobile')} onClick={handleWorkspaceToggle} aria-label={workspaceTooltip}>
            {workspaceCollapsed ? <ExpandRight theme='outline' size={iconSize} fill='currentColor' /> : <ExpandLeft theme='outline' size={iconSize} fill='currentColor' />}
          </button>
        )}
        {showWindowControls && <WindowControls />}
      </div>
    </div>
  );
};

export default Titlebar;
