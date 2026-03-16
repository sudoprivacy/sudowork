import React, { useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { ArrowCircleLeft, ExpandLeft, ExpandRight, MenuFold, MenuUnfold, Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { ipcBridge } from '@/common';
import WindowControls from '../WindowControls';
import { WORKSPACE_STATE_EVENT, dispatchWorkspaceToggleEvent } from '@renderer/utils/workspaceEvents';
import type { WorkspaceStateDetail } from '@renderer/utils/workspaceEvents';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { isElectronDesktop, isMacOS } from '@/renderer/utils/platform';

interface TitlebarProps {
  workspaceAvailable: boolean;
}

const AionLogoMark: React.FC = () => (
  <svg className='app-titlebar__brand-logo' viewBox='0 0 80 80' fill='none' aria-hidden='true' focusable='false'>
    <path
      d='M78.7034,21.9581 C78.5522,21.6152 78.4472,21.3188 78.3117,21.1156 L58.7503,10.7582 L58.7382,10.747 L58.7261,10.747 L38.873,0.3896 C38.3184,0.0809 37.6506,0 37.1135,0.2905 L0.8647,21.1119 C0.3391,21.4024 0.0234,22.0059 0.0234,22.6552 L0.0234,43.2112 C0.0234,43.2112 0.0234,43.2227 0.0234,43.2341 C0.0234,43.2456 0.0234,43.2456 0.0234,43.2456 L0.0234,63.8016 C0.0234,63.8016 0.0234,63.8131 0.0234,63.8131 C0.0234,63.9814 0.3391,64.5849 0.8647,64.8754 L37.1135,85.6968 C37.6499,85.9873 38.3184,85.9873 38.8548,85.6968 C38.8886,85.6763 38.9342,85.6558 38.968,85.6433 L58.6985,75.3513 L58.7094,75.3401 L58.7202,75.3289 L78.5733,65.0798 L78.5842,65.0686 C79.11,64.7781 79.4257,64.1746 79.4257,63.8131 L79.4257,22.6664 C79.4257,22.4383 79.3801,22.2214 78.7034,21.9581 Z M60.144,52.9255 L60.144,33.8351 L75.1888,25.435 L75.1888,60.9985 L60.144,52.9255 Z M56.6792,15.1383 L56.6792,32.5851 L38.9092,41.3644 L24.1504,32.5851 L56.6792,15.1383 Z M16.8562,32.5851 L3.8832,40.4709 L3.8832,25.435 L16.8562,32.5851 Z M20.2354,34.8183 L37.0192,44.4757 L37.0192,60.9985 L20.2354,43.5517 L20.2354,34.8183 Z M37.0306,64.8883 L37.0306,80.5657 L3.9948,63.8131 L20.2466,54.8857 L37.0306,64.8883 Z M40.4098,44.4757 L54.801,36.6857 L54.801,71.8957 L40.4098,63.6933 L40.4098,44.4757 Z M58.7261,29.8976 L58.7261,15.1383 L71.6879,22.6552 L58.7261,29.8976 Z M40.4098,19.6164 L40.4098,4.7239 L53.3541,12.2407 L40.4098,19.6164 Z M37.0306,21.6239 L21.0034,30.8407 L7.5234,22.6476 L37.0306,4.7351 L37.0306,21.6239 Z M3.8944,46.3992 L16.8562,53.8807 L3.8944,61.3622 L3.8944,46.3992 Z M40.4098,67.2492 L53.3653,74.7307 L40.4098,82.2122 L40.4098,67.2492 Z M58.7149,56.8792 L71.6879,64.8883 L58.7149,72.8974 L58.7149,56.8792 Z'
      fill='currentColor'
    ></path>
  </svg>
);

const Titlebar: React.FC<TitlebarProps> = ({ workspaceAvailable }) => {
  const { t } = useTranslation();
  const appTitle = useMemo(() => 'Sudowork', []);
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(true);
  const [mobileCenterTitle, setMobileCenterTitle] = useState(appTitle);
  const [mobileCenterOffset, setMobileCenterOffset] = useState(0);
  const layout = useLayoutContext();
  const location = useLocation();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
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
  // 统一在标题栏左侧展示主侧栏开关 / Always expose sidebar toggle on titlebar left side
  const showSiderToggle = Boolean(layout?.setSiderCollapsed) && !(layout?.isMobile && isSettingsRoute);
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

  useEffect(() => {
    if (!layout?.isMobile) {
      setMobileCenterTitle(appTitle);
      return;
    }

    const match = location.pathname.match(/^\/conversation\/([^/]+)/);
    const conversationId = match?.[1];
    if (!conversationId) {
      setMobileCenterTitle(appTitle);
      return;
    }

    let cancelled = false;
    void ipcBridge.conversation.get
      .invoke({ id: conversationId })
      .then((conversation) => {
        if (cancelled) return;
        setMobileCenterTitle(conversation?.name || appTitle);
      })
      .catch(() => {
        if (cancelled) return;
        setMobileCenterTitle(appTitle);
      });

    return () => {
      cancelled = true;
    };
  }, [appTitle, layout?.isMobile, location.pathname]);

  useEffect(() => {
    if (!layout?.isMobile) {
      setMobileCenterOffset(0);
      return;
    }

    const updateOffset = () => {
      const leftWidth = menuRef.current?.offsetWidth || 0;
      const rightWidth = toolbarRef.current?.offsetWidth || 0;
      setMobileCenterOffset((leftWidth - rightWidth) / 2);
    };

    updateOffset();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateOffset);
      return () => window.removeEventListener('resize', updateOffset);
    }

    const observer = new ResizeObserver(() => updateOffset());
    if (containerRef.current) observer.observe(containerRef.current);
    if (menuRef.current) observer.observe(menuRef.current);
    if (toolbarRef.current) observer.observe(toolbarRef.current);

    return () => observer.disconnect();
  }, [layout?.isMobile, showBackToChatButton, showNewConversationButton, showWorkspaceButton, mobileCenterTitle]);

  const mobileCenterStyle = layout?.isMobile
    ? ({
        '--app-titlebar-mobile-center-offset': `${workspaceAvailable ? mobileCenterOffset : 0}px`,
      } as React.CSSProperties)
    : undefined;

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
      ref={containerRef}
      style={mobileCenterStyle}
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
      <div className='app-titlebar__brand' aria-label={layout?.isMobile ? mobileCenterTitle : appTitle} title={layout?.isMobile ? mobileCenterTitle : appTitle}>
        {layout?.isMobile ? (
          <span className='app-titlebar__brand-mobile'>
            <AionLogoMark />
            <span className='app-titlebar__brand-text'>{mobileCenterTitle}</span>
          </span>
        ) : (
          appTitle
        )}
      </div>
      <div ref={toolbarRef} className='app-titlebar__toolbar'>
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
