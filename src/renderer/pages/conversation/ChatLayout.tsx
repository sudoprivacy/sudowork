/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Layout as ArcoLayout, Tooltip } from '@arco-design/web-react';
import { ChevronLeft as ExpandLeft, ChevronRight as ExpandRight, ChevronRight as Right } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import classNames from 'classnames';
import { fetchAssistantsAsConfigs } from '@/renderer/shared/agents/assistantAdapter';
import { STORAGE_KEYS } from '@/common/storageKeys';
import AgentModeSelector from '@/renderer/components/AgentModeSelector';
import FlexFullContainer from '@/renderer/components/FlexFullContainer';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { useResizableSplit } from '@/renderer/hooks/useResizableSplit';
import ConversationTabs from '@/renderer/pages/conversation/ConversationTabs';
import { PreviewPanel, usePreviewContext } from '@/renderer/pages/conversation/preview';
import ConversationTitleMinimap from '@/renderer/pages/conversation/components/ConversationTitleMinimap';
import { WORKSPACE_HAS_FILES_EVENT, WORKSPACE_TOGGLE_EVENT, dispatchWorkspaceStateEvent, dispatchWorkspaceToggleEvent, type WorkspaceHasFilesDetail } from '@/renderer/utils/workspaceEvents';
import { ACP_BACKENDS_ALL } from '@/types/acpTypes';

const MIN_CHAT_RATIO = 25;
const MIN_WORKSPACE_RATIO = 12;
const MIN_PREVIEW_RATIO = 20;
const WORKSPACE_HEADER_HEIGHT = 32;
const MIN_CHAT_PANEL_PX = 360;
const MIN_PREVIEW_PANEL_PX = 340;
const MIN_WORKSPACE_PANEL_PX = 300;
const MIN_RIGHT_SIDER_PANEL_PX = 300;

const isMacEnvironment = () => {
  if (typeof navigator === 'undefined') return false;
  return /mac/i.test(navigator.userAgent);
};

const isWindowsEnvironment = () => {
  if (typeof navigator === 'undefined') return false;
  return /win/i.test(navigator.userAgent);
};

interface WorkspaceHeaderProps {
  children?: React.ReactNode;
  showToggle?: boolean;
  collapsed: boolean;
  onToggle: () => void;
  togglePlacement?: 'left' | 'right';
}

const WorkspacePanelHeader: React.FC<WorkspaceHeaderProps> = ({ children, showToggle = false, collapsed, onToggle, togglePlacement = 'right' }) => (
  // border-[var(--bg-3)]: bg token 当边框的既有误用（uno.config:38 警示），零改样重构不处理
  <div className='workspace-panel-header flex items-center justify-start px-3 py-1 gap-3 border-b border-[var(--bg-3)]' style={{ height: WORKSPACE_HEADER_HEIGHT, minHeight: WORKSPACE_HEADER_HEIGHT }}>
    {showToggle && togglePlacement === 'left' && (
      <button type='button' className='workspace-header__toggle mr-1' aria-label='Toggle workspace' onClick={onToggle}>
        {collapsed ? <ExpandRight size={16} /> : <ExpandLeft size={16} />}
      </button>
    )}
    <div className='flex-1 truncate'>{children}</div>
    {showToggle && togglePlacement === 'right' && (
      <button type='button' className='workspace-header__toggle' aria-label='Toggle workspace' onClick={onToggle}>
        {collapsed ? <ExpandRight size={16} /> : <ExpandLeft size={16} />}
      </button>
    )}
  </div>
);

interface ConversationHeaderToggleProps {
  collapsed: boolean;
  title: string;
  onToggle: () => void;
  style?: React.CSSProperties;
}

interface IRightSiderWidthOverride {
  widthPx?: number;
  maxWidthPx?: number;
  ratio?: number;
}

const ConversationHeaderToggle: React.FC<ConversationHeaderToggleProps> = ({ collapsed, title, onToggle, style }) => (
  <div className='pointer-events-none' style={{ width: '34px', height: '44px', ...style }}>
    <div className='absolute left-0 top-0 bottom-0 w-0 bg-3 opacity-90' />
    <Tooltip content={title} position='bottom'>
      <button
        type='button'
        className='conversation-toggle-floating absolute left-0 top-1/2 f-center rounded-full pointer-events-auto transition-colors duration-200 -translate-y-1/2'
        style={{
          width: '34px',
          height: '34px',
          marginLeft: '-17px',
        }}
        aria-label={title}
        aria-pressed={collapsed}
        onClick={onToggle}
      >
        <Right size={18} className='transition-transform duration-200' style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)' }} />
      </button>
    </Tooltip>
  </div>
);

// headerExtra 用于在会话头部右侧插入自定义操作（如模型选择）
// headerExtra allows injecting custom actions (e.g., model picker) into the header's right area
const ChatLayout: React.FC<{
  children: React.ReactNode;
  title?: React.ReactNode;
  sider: React.ReactNode;
  siderTitle?: React.ReactNode;
  backend?: string;
  agentName?: string;
  /** 自定义 agent logo（可以是 SVG 路径或 emoji 字符串）/ Custom agent logo (can be SVG path or emoji string) */
  agentLogo?: string;
  /** 是否为 emoji 类型的 logo / Whether the logo is an emoji */
  agentLogoIsEmoji?: boolean;
  headerExtra?: React.ReactNode;
  headerLeft?: React.ReactNode;
  workspaceEnabled?: boolean;
  rightSiderWidthOverride?: IRightSiderWidthOverride | null;
  /** 会话 ID，用于模式切换 / Conversation ID for mode switching */
  conversationId?: string;
}> = (props) => {
  const { conversationId } = props;
  const { t } = useTranslation();
  const [rightSiderCollapsed, setRightSiderCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.WORKSPACE_PANEL_COLLAPSE);
      if (stored !== null) {
        return stored === 'true';
      }
    } catch {
      // 忽略错误
    }
    return true; // 默认折叠
  });
  const [conversationCollapsed, setConversationCollapsed] = useState(() => {
    return false;
  });
  const currentConversationIdRef = useRef<string | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const rightSidebarToggleRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));
  const [conversationTogglePosition, setConversationTogglePosition] = useState<React.CSSProperties | null>(null);
  const { backend, agentName, agentLogo, agentLogoIsEmoji, workspaceEnabled = true, rightSiderWidthOverride } = props;
  const layout = useLayoutContext();
  const isMacRuntime = isMacEnvironment();
  const isWindowsRuntime = isWindowsEnvironment();
  const rightCollapsedRef = useRef(rightSiderCollapsed);
  const previousWorkspaceCollapsedRef = useRef<boolean | null>(null);
  const previousSiderCollapsedRef = useRef<boolean | null>(null);
  const previousPreviewOpenRef = useRef(false);

  const { isOpen: isPreviewOpen } = usePreviewContext();

  // Fetch custom agents config as fallback when agentName is not provided
  const { data: customAgents } = useSWR(backend === 'custom' && !agentName ? 'assistantHub.installed' : null, fetchAssistantsAsConfigs);

  // Compute display name with fallback chain (use first custom agent as fallback for backward compatibility)
  const displayName = agentName || (backend === 'custom' && customAgents?.[0]?.name) || ACP_BACKENDS_ALL[backend as keyof typeof ACP_BACKENDS_ALL]?.name || backend;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const handleWorkspaceToggle = () => {
      if (!workspaceEnabled) {
        return;
      }
      setRightSiderCollapsed((prev) => {
        const newState = !prev;
        const conversationId = currentConversationIdRef.current;
        if (conversationId) {
          try {
            localStorage.setItem(`workspace-preference-${conversationId}`, newState ? 'collapsed' : 'expanded');
          } catch {
            // 忽略错误
          }
        }
        return newState;
      });
    };
    window.addEventListener(WORKSPACE_TOGGLE_EVENT, handleWorkspaceToggle);
    return () => {
      window.removeEventListener(WORKSPACE_TOGGLE_EVENT, handleWorkspaceToggle);
    };
  }, [workspaceEnabled]);

  // 根据文件状态自动展开/折叠工作空间面板（优先使用用户手动偏好）
  // Auto expand/collapse workspace panel based on files state (user preference takes priority)
  useEffect(() => {
    if (typeof window === 'undefined' || !workspaceEnabled) {
      return undefined;
    }
    const handleHasFiles = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceHasFilesDetail>).detail;
      const conversationId = detail.conversationId;

      currentConversationIdRef.current = conversationId;

      // 预览打开时不自动展开工作空间，防止在窄屏（高 DPI + 非全屏）下
      // 工作空间展开/折叠反复切换导致无限闪烁
      // Skip auto-expand when preview is open to prevent infinite collapse/expand
      // oscillation on narrow screens (high DPI + non-fullscreen)
      if (isPreviewOpen) {
        return;
      }

      let userPreference: 'expanded' | 'collapsed' | null = null;
      if (conversationId) {
        try {
          const stored = localStorage.getItem(`workspace-preference-${conversationId}`);
          if (stored === 'expanded' || stored === 'collapsed') {
            userPreference = stored;
          }
        } catch {
          // 忽略错误
        }
      }

      if (userPreference) {
        const shouldCollapse = userPreference === 'collapsed';
        if (shouldCollapse !== rightSiderCollapsed) {
          setRightSiderCollapsed(shouldCollapse);
        }
      } else {
        if (detail.hasFiles && rightSiderCollapsed) {
          setRightSiderCollapsed(false);
        }
      }
    };
    window.addEventListener(WORKSPACE_HAS_FILES_EVENT, handleHasFiles);
    return () => {
      window.removeEventListener(WORKSPACE_HAS_FILES_EVENT, handleHasFiles);
    };
  }, [workspaceEnabled, rightSiderCollapsed, isPreviewOpen]);

  useEffect(() => {
    if (!workspaceEnabled) {
      dispatchWorkspaceStateEvent(true);
      return;
    }
    dispatchWorkspaceStateEvent(rightSiderCollapsed);
  }, [rightSiderCollapsed, workspaceEnabled]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      setContainerWidth(typeof window === 'undefined' ? 0 : Math.round(window.innerWidth));
      return;
    }
    setContainerWidth(Math.round(element.offsetWidth));
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      if (!entries.length) return;
      // Round to integer to prevent sub-pixel oscillation on high-DPI displays (e.g. 150% scaling).
      // Non-integer contentRect.width values at fractional DPI ratios can alternate between frames,
      // causing infinite layout recalculation loops.
      const newWidth = Math.round(entries[0].contentRect.width);
      setContainerWidth((prev) => (prev === newWidth ? prev : newWidth));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    rightCollapsedRef.current = rightSiderCollapsed;
  }, [rightSiderCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.WORKSPACE_PANEL_COLLAPSE, String(rightSiderCollapsed));
    } catch {
      // 忽略错误
    }
  }, [rightSiderCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.CONVERSATION_PANEL_COLLAPSE, String(conversationCollapsed));
    } catch {
      // 忽略错误
    }
  }, [conversationCollapsed]);

  useEffect(() => {
    if (rightSiderCollapsed && conversationCollapsed) {
      setConversationCollapsed(false);
    }
  }, [conversationCollapsed, rightSiderCollapsed]);

  useEffect(() => {
    if (!workspaceEnabled) {
      setRightSiderCollapsed(true);
    }
  }, [workspaceEnabled]);

  const {
    splitRatio: workspaceSplitRatio,
    setSplitRatio: setWorkspaceSplitRatio,
    createDragHandle: createWorkspaceDragHandle,
  } = useResizableSplit({
    defaultWidth: 20,
    minWidth: MIN_WORKSPACE_RATIO,
    maxWidth: 40,
    storageKey: 'chat-workspace-split-ratio',
  });

  const safeContainerWidth = Math.max(containerWidth || 0, 1);
  const isConversationCollapsed = conversationCollapsed;
  const isRightSiderWidthOverridden = Boolean(rightSiderWidthOverride) && !isConversationCollapsed;
  const configuredWorkspaceRatio = rightSiderWidthOverride?.ratio ?? workspaceSplitRatio;
  const activeWorkspaceRatio = workspaceEnabled && !rightSiderCollapsed ? configuredWorkspaceRatio : 0;
  const availableRatioForChatPreview = Math.max(1, 100 - activeWorkspaceRatio);
  const availableWidthForChatPreview = (safeContainerWidth * availableRatioForChatPreview) / 100;
  const minChatRatioByPx = (MIN_CHAT_PANEL_PX / Math.max(availableWidthForChatPreview, 1)) * 100;
  const minPreviewRatioByPx = (MIN_PREVIEW_PANEL_PX / Math.max(availableWidthForChatPreview, 1)) * 100;
  const dynamicChatMinRatio = workspaceEnabled && isPreviewOpen ? Math.max(MIN_CHAT_RATIO, minChatRatioByPx) : MIN_CHAT_RATIO;
  const dynamicChatMaxCandidate = workspaceEnabled && isPreviewOpen ? Math.min(80, 100 - Math.max(MIN_PREVIEW_RATIO, minPreviewRatioByPx)) : 80;
  const dynamicChatMaxRatio = Math.max(dynamicChatMinRatio, dynamicChatMaxCandidate);
  const isDesktop = true;

  const {
    splitRatio: chatSplitRatio,
    setSplitRatio: setChatSplitRatio,
    createDragHandle: createPreviewDragHandle,
  } = useResizableSplit({
    defaultWidth: 60,
    minWidth: dynamicChatMinRatio,
    maxWidth: dynamicChatMaxRatio,
    storageKey: 'chat-preview-split-ratio',
  });

  const effectiveWorkspaceRatio = workspaceEnabled && !rightSiderCollapsed ? configuredWorkspaceRatio : 0;
  const availableChatPreviewRatio = Math.max(0, 100 - effectiveWorkspaceRatio);
  const chatFlex = isConversationCollapsed ? 0 : isPreviewOpen ? (availableChatPreviewRatio * chatSplitRatio) / 100 : 100 - effectiveWorkspaceRatio;
  const workspaceFlex = effectiveWorkspaceRatio;
  const viewportWidth = containerWidth || (typeof window === 'undefined' ? 0 : window.innerWidth);
  const effectiveWorkspaceMaxWidthPx = rightSiderWidthOverride?.maxWidthPx ?? 500;
  const ratioWorkspaceWidthPx = Math.min(effectiveWorkspaceMaxWidthPx, Math.max(200, (configuredWorkspaceRatio / 100) * (viewportWidth || 0)));
  const maxWorkspaceWidthByChatPx = Math.max(MIN_RIGHT_SIDER_PANEL_PX, (viewportWidth || 0) - MIN_CHAT_PANEL_PX);
  const fixedWorkspaceWidthPx = rightSiderWidthOverride?.widthPx ? Math.min(rightSiderWidthOverride.widthPx, maxWorkspaceWidthByChatPx) : null;
  const workspaceWidthPx = workspaceEnabled ? (fixedWorkspaceWidthPx ?? ratioWorkspaceWidthPx) : 0;

  useEffect(() => {
    if (!workspaceEnabled || !isPreviewOpen || !isDesktop || rightSiderCollapsed) {
      return;
    }
    const safeContainerWidth = Math.max(containerWidth || 0, 1);
    const minChatPreviewRatioByPx = ((MIN_CHAT_PANEL_PX + MIN_PREVIEW_PANEL_PX) / safeContainerWidth) * 100;
    const maxWorkspaceByPx = 100 - minChatPreviewRatioByPx;
    const maxWorkspace = Math.max(MIN_WORKSPACE_RATIO, Math.min(40, maxWorkspaceByPx));
    if (!isRightSiderWidthOverridden && workspaceSplitRatio > maxWorkspace) {
      setWorkspaceSplitRatio(maxWorkspace);
    }
    // 宽度非常紧张时，优先保证聊天+预览可见，自动收起工作空间
    if (safeContainerWidth < MIN_CHAT_PANEL_PX + MIN_PREVIEW_PANEL_PX + MIN_WORKSPACE_PANEL_PX) {
      setRightSiderCollapsed(true);
    }
    // 故意不将 workspaceSplitRatio 加入依赖，避免拖动工作空间时触发额外的 effect
  }, [containerWidth, isDesktop, isPreviewOpen, isRightSiderWidthOverridden, rightSiderCollapsed, setWorkspaceSplitRatio, workspaceEnabled, workspaceSplitRatio]);

  useEffect(() => {
    if (!workspaceEnabled || !isPreviewOpen || !isDesktop || isConversationCollapsed) {
      return;
    }
    const clampedChat = Math.max(dynamicChatMinRatio, Math.min(dynamicChatMaxRatio, chatSplitRatio));
    // Use a threshold to prevent oscillation from floating-point precision issues.
    // Without this, sub-pixel container width changes at high DPI can cause the
    // clamped value to differ by infinitesimal amounts, triggering infinite re-renders.
    if (Math.abs(clampedChat - chatSplitRatio) > 0.1) {
      setChatSplitRatio(clampedChat);
    }
  }, [chatSplitRatio, dynamicChatMaxRatio, dynamicChatMinRatio, isConversationCollapsed, isDesktop, isPreviewOpen, setChatSplitRatio, workspaceEnabled]);

  // 预览打开时自动收起侧边栏和工作空间 / Auto-collapse sidebar and workspace when preview opens
  useEffect(() => {
    if (!workspaceEnabled || !isDesktop) {
      previousPreviewOpenRef.current = false;
      return;
    }

    if (isPreviewOpen && !previousPreviewOpenRef.current) {
      if (previousWorkspaceCollapsedRef.current === null) {
        previousWorkspaceCollapsedRef.current = rightSiderCollapsed;
      }
      if (previousSiderCollapsedRef.current === null && typeof layout?.siderCollapsed !== 'undefined') {
        previousSiderCollapsedRef.current = layout.siderCollapsed;
      }
      setRightSiderCollapsed(true);
      layout?.setSiderCollapsed?.(true);
    } else if (!isPreviewOpen && previousPreviewOpenRef.current) {
      if (previousWorkspaceCollapsedRef.current !== null) {
        setRightSiderCollapsed(previousWorkspaceCollapsedRef.current);
        previousWorkspaceCollapsedRef.current = null;
      }
      if (previousSiderCollapsedRef.current !== null && layout?.setSiderCollapsed) {
        layout.setSiderCollapsed(previousSiderCollapsedRef.current);
        previousSiderCollapsedRef.current = null;
      }
    }

    previousPreviewOpenRef.current = isPreviewOpen;
  }, [isPreviewOpen, isDesktop, layout, rightSiderCollapsed, workspaceEnabled]);

  const showDesktopWorkspaceSidebar = workspaceEnabled && !rightSiderCollapsed;
  const desktopWorkspaceSidebarWidth = Math.max(MIN_RIGHT_SIDER_PANEL_PX, Math.round(workspaceWidthPx));
  const showWorkspaceHeader = props.siderTitle != null;
  const showConversationCollapseToggle = workspaceEnabled && !rightSiderCollapsed;
  const toggleConversationCollapsed = () => setConversationCollapsed((prev) => !prev);
  const conversationCollapseTitle = isConversationCollapsed ? t('conversation.layout.expandConversation', { defaultValue: 'Expand conversation' }) : t('conversation.layout.collapseConversation', { defaultValue: 'Collapse conversation' });
  const conversationToggleProps = {
    collapsed: isConversationCollapsed,
    title: conversationCollapseTitle,
    onToggle: toggleConversationCollapsed,
  };
  const conversationToggleNode = showConversationCollapseToggle ? <ConversationHeaderToggle {...conversationToggleProps} style={conversationTogglePosition ?? undefined} /> : null;

  useEffect(() => {
    if (!showConversationCollapseToggle) {
      setConversationTogglePosition(null);
      return undefined;
    }
    const element = rightSidebarToggleRef.current;
    if (!element) {
      return undefined;
    }

    const updatePosition = () => {
      const rect = element.getBoundingClientRect();
      setConversationTogglePosition({
        position: 'fixed',
        top: `${Math.round(rect.top + rect.height / 2)}px`,
        left: `${Math.round(rect.left)}px`,
        transform: 'translateY(-50%)',
        zIndex: 9999,
      });
    };

    updatePosition();

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => updatePosition());
    resizeObserver?.observe(element);

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [showConversationCollapseToggle, rightSiderCollapsed, containerWidth, isPreviewOpen, workspaceSplitRatio, workspaceWidthPx, isConversationCollapsed]);

  const conversationTogglePortal = conversationToggleNode && typeof document !== 'undefined' ? createPortal(conversationToggleNode, document.body) : null;

  const headerBlock = (
    <>
      <ConversationTabs />
      <ArcoLayout.Header className='h-9 flex items-center justify-between p-4 gap-4 !bg-1 chat-layout-header overflow-hidden'>
        <div className='shrink-0'>{props.headerLeft}</div>
        <FlexFullContainer className='h-full min-w-0' containerClassName='flex items-center gap-4'>
          <ConversationTitleMinimap title={props.title} conversationId={conversationId} />
        </FlexFullContainer>
        <div className='flex items-center gap-3 shrink-0'>
          {props.headerExtra}
          {(backend || agentLogo) && <AgentModeSelector backend={backend} agentName={displayName} agentLogo={agentLogo} agentLogoIsEmoji={agentLogoIsEmoji} compact={false} showLogoInCompact={false} compactLabelType='mode' />}
          {isWindowsRuntime && workspaceEnabled && (
            <button type='button' className='workspace-header__toggle' aria-label='Toggle workspace' onClick={() => dispatchWorkspaceToggleEvent()}>
              {rightSiderCollapsed ? <ExpandRight size={16} /> : <ExpandLeft size={16} />}
            </button>
          )}
        </div>
      </ArcoLayout.Header>
    </>
  );

  // 预览打开时使用顶部标题栏布局（聊天+预览位于标题栏下方）
  // When preview is open on desktop, keep chat+preview below the header.
  const useHeaderFullWidth = isPreviewOpen;

  return (
    <ArcoLayout className='size-full'>
      <div ref={containerRef} className={classNames('flex flex-1 relative w-full overflow-hidden', useHeaderFullWidth && 'flex-col')}>
        {useHeaderFullWidth ? (
          <>
            {showDesktopWorkspaceSidebar ? (
              <div className='flex flex-1 min-h-0 relative'>
                <div className='flex flex-col flex-1 min-w-0'>
                  <div className='flex shrink-0 !bg-1'>
                    <div className='flex-1 min-w-0'>{headerBlock}</div>
                  </div>
                  <div className='flex flex-1 min-h-0 relative'>
                    {!isConversationCollapsed && (
                      <div className='flex flex-col relative' style={{ flexGrow: 0, flexShrink: 0, flexBasis: `${chatFlex}%`, minWidth: '240px' }}>
                        <ArcoLayout.Content className='flex flex-col flex-1 bg-1 overflow-hidden'>{props.children}</ArcoLayout.Content>
                      </div>
                    )}
                    {!isConversationCollapsed && (
                      <div className='preview-panel flex flex-col relative overflow-visible mt-1.5 mb-3 mr-3 ml-2 rounded-[15px]' style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, border: '1px solid var(--bg-3)', minWidth: '260px' }}>
                        {createPreviewDragHandle({
                          className: 'absolute top-0 bottom-0 z-30',
                          style: { width: '20px', left: '-20px' },
                          linePlacement: 'end',
                          lineClassName: 'opacity-30 group-hover:opacity-100 group-active:opacity-100',
                          lineStyle: { width: '2px' },
                        })}
                        <div className='h-full w-full overflow-hidden rounded-[15px]'>
                          <PreviewPanel />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div
                  ref={rightSidebarToggleRef}
                  className={classNames('relative chat-layout-right-sider layout-sider')}
                  style={{
                    flexGrow: 0,
                    flexShrink: 0,
                    flexBasis: rightSiderCollapsed ? '0px' : `${desktopWorkspaceSidebarWidth}px`,
                    width: rightSiderCollapsed ? '0px' : `${desktopWorkspaceSidebarWidth}px`,
                    minWidth: rightSiderCollapsed ? '0px' : `${MIN_RIGHT_SIDER_PANEL_PX}px`,
                    overflow: 'visible',
                  }}
                >
                  <div
                    className={classNames('!bg-1 relative chat-layout-right-sider layout-sider')}
                    style={{
                      height: '100%',
                      overflow: 'hidden',
                      borderLeft: rightSiderCollapsed ? 'none' : '1px solid var(--bg-3)',
                    }}
                  >
                    {!rightSiderCollapsed && !isRightSiderWidthOverridden && createWorkspaceDragHandle({ className: 'absolute left-0 top-0 bottom-0', style: {}, reverse: true })}
                    {showWorkspaceHeader ? (
                      <>
                        <WorkspacePanelHeader showToggle={!isMacRuntime && !isWindowsRuntime} collapsed={rightSiderCollapsed} onToggle={() => dispatchWorkspaceToggleEvent()} togglePlacement='right'>
                          {props.siderTitle}
                        </WorkspacePanelHeader>
                        <ArcoLayout.Content style={{ height: `calc(100% - ${WORKSPACE_HEADER_HEIGHT}px)` }}>{props.sider}</ArcoLayout.Content>
                      </>
                    ) : (
                      <ArcoLayout.Content style={{ height: '100%' }}>{props.sider}</ArcoLayout.Content>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className='flex shrink-0 !bg-1'>
                  <div className='flex-1 min-w-0'>{headerBlock}</div>
                </div>
                <div className='flex flex-1 min-h-0 relative'>
                  {!isConversationCollapsed && (
                    <div className='flex flex-col relative' style={{ flexGrow: 0, flexShrink: 0, flexBasis: `${chatFlex}%`, minWidth: '240px' }}>
                      <ArcoLayout.Content className='flex flex-col flex-1 bg-1 overflow-hidden'>{props.children}</ArcoLayout.Content>
                    </div>
                  )}
                  {!isConversationCollapsed && (
                    <div className='preview-panel flex flex-col relative overflow-visible mt-1.5 mb-3 mr-3 ml-2 rounded-[15px]' style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, border: '1px solid var(--bg-3)', minWidth: '260px' }}>
                      {createPreviewDragHandle({
                        className: 'absolute top-0 bottom-0 z-30',
                        style: { width: '20px', left: '-20px' },
                        linePlacement: 'end',
                        lineClassName: 'opacity-30 group-hover:opacity-100 group-active:opacity-100',
                        lineStyle: { width: '2px' },
                      })}
                      <div className='h-full w-full overflow-hidden rounded-[15px]'>
                        <PreviewPanel />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {!isConversationCollapsed && (
              <div className='flex flex-col relative' style={{ flexGrow: isPreviewOpen ? 0 : chatFlex, flexShrink: 0, flexBasis: isPreviewOpen ? `${chatFlex}%` : 0, minWidth: '240px' }}>
                <ArcoLayout.Content className='flex flex-col h-full'>
                  {headerBlock}
                  <ArcoLayout.Content className='flex flex-col flex-1 bg-1 overflow-hidden'>{props.children}</ArcoLayout.Content>
                </ArcoLayout.Content>
              </div>
            )}
            {isPreviewOpen && (
              <div
                className='preview-panel flex flex-col relative overflow-visible my-3 mr-3 ml-2 rounded-[15px]'
                style={{
                  flexGrow: 1,
                  flexShrink: 1,
                  flexBasis: 0,
                  border: '1px solid var(--bg-3)',
                  minWidth: '260px',
                  boxSizing: 'border-box',
                }}
              >
                {!isConversationCollapsed &&
                  createPreviewDragHandle({
                    className: 'absolute top-0 bottom-0 z-30',
                    style: { width: '20px', left: '-20px' },
                    linePlacement: 'end',
                    lineClassName: 'opacity-30 group-hover:opacity-100 group-active:opacity-100',
                    lineStyle: { width: '2px' },
                  })}
                <div className='h-full w-full overflow-hidden rounded-[15px]'>
                  <PreviewPanel />
                </div>
              </div>
            )}
            {workspaceEnabled && (
              <div
                ref={rightSidebarToggleRef}
                className={classNames('relative chat-layout-right-sider layout-sider')}
                style={{
                  flexGrow: isPreviewOpen || isRightSiderWidthOverridden ? 0 : workspaceFlex,
                  flexShrink: 0,
                  flexBasis: rightSiderCollapsed || (!isPreviewOpen && !isRightSiderWidthOverridden) ? (rightSiderCollapsed ? '0px' : 0) : `${Math.round(workspaceWidthPx)}px`,
                  width: rightSiderCollapsed || (!isPreviewOpen && !isRightSiderWidthOverridden) ? (rightSiderCollapsed ? '0px' : undefined) : `${Math.round(workspaceWidthPx)}px`,
                  minWidth: rightSiderCollapsed ? '0px' : `${MIN_RIGHT_SIDER_PANEL_PX}px`,
                  overflow: 'visible',
                }}
              >
                <div
                  className={classNames('!bg-1 relative chat-layout-right-sider layout-sider')}
                  style={{
                    height: '100%',
                    overflow: 'hidden',
                    borderLeft: rightSiderCollapsed ? 'none' : '1px solid var(--bg-3)',
                  }}
                >
                  {!rightSiderCollapsed && !isRightSiderWidthOverridden && createWorkspaceDragHandle({ className: 'absolute left-0 top-0 bottom-0', style: {}, reverse: true })}
                  {showWorkspaceHeader ? (
                    <>
                      <WorkspacePanelHeader showToggle={!isMacRuntime && !isWindowsRuntime} collapsed={rightSiderCollapsed} onToggle={() => dispatchWorkspaceToggleEvent()} togglePlacement='right'>
                        {props.siderTitle}
                      </WorkspacePanelHeader>
                      <ArcoLayout.Content style={{ height: `calc(100% - ${WORKSPACE_HEADER_HEIGHT}px)` }}>{props.sider}</ArcoLayout.Content>
                    </>
                  ) : (
                    <ArcoLayout.Content style={{ height: '100%' }}>{props.sider}</ArcoLayout.Content>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {!isMacRuntime && !isWindowsRuntime && workspaceEnabled && rightSiderCollapsed && (
          // border-[var(--bg-3)]: bg token 当边框的既有误用（uno.config:38 警示），零改样重构不处理
          <button type='button' className='bg-2 border border-[var(--bg-3)] workspace-header__toggle absolute top-1/2 right-2 z-10' style={{ transform: 'translateY(-50%)' }} onClick={() => dispatchWorkspaceToggleEvent()} aria-label='Expand workspace'>
            <ExpandLeft size={16} />
          </button>
        )}
        {conversationTogglePortal}
      </div>
    </ArcoLayout>
  );
};

export default ChatLayout;
