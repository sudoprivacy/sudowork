/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Layout as ArcoLayout } from '@arco-design/web-react';
import { ChevronLeft as ExpandLeft, ChevronRight as ExpandRight } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Group, Panel, usePanelRef, type PanelSize } from 'react-resizable-panels';

import { STORAGE_KEYS } from '@/common/storageKeys';
import FlexFullContainer from '@/renderer/components/FlexFullContainer';
import ResizableSeparator from '@/renderer/components/ResizableSeparator';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { useStoredPanelLayout } from '@/renderer/hooks/useStoredPanelLayout';
import ConversationTabs from '@/renderer/pages/conversation/ConversationTabs';
import { PreviewPanel, usePreviewContext } from '@/renderer/pages/conversation/preview';
import { WORKSPACE_HAS_FILES_EVENT, WORKSPACE_TOGGLE_EVENT, dispatchWorkspaceStateEvent, dispatchWorkspaceToggleEvent, type WorkspaceHasFilesDetail } from '@/renderer/utils/workspaceEvents';

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
  <div className='workspace-panel-header flex items-center justify-start px-3 py-1 gap-3 border-b border-border' style={{ height: WORKSPACE_HEADER_HEIGHT, minHeight: WORKSPACE_HEADER_HEIGHT }}>
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

interface IRightSiderWidthOverride {
  widthPx?: number;
  maxWidthPx?: number;
  ratio?: number;
}

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
}> = (props) => {
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
  const currentConversationIdRef = useRef<string | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));
  const { workspaceEnabled = true, rightSiderWidthOverride } = props;
  const layout = useLayoutContext();
  const isMacRuntime = isMacEnvironment();
  const isWindowsRuntime = isWindowsEnvironment();
  const rightCollapsedRef = useRef(rightSiderCollapsed);
  const previousWorkspaceCollapsedRef = useRef<boolean | null>(null);
  const previousSiderCollapsedRef = useRef<boolean | null>(null);
  const previousPreviewOpenRef = useRef(false);

  const { isOpen: isPreviewOpen } = usePreviewContext();

  // Fetch custom agents config as fallback when agentName is not provided
  // const { data: customAgents } = useSWR(backend === 'custom' && !agentName ? 'assistantHub.installed' : null, fetchAssistantsAsConfigs);

  // Compute display name with fallback chain (use first custom agent as fallback for backward compatibility)
  // const displayName = agentName || (backend === 'custom' && customAgents?.[0]?.name) || ACP_BACKENDS_ALL[backend as keyof typeof ACP_BACKENDS_ALL]?.name || backend;

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
    if (!workspaceEnabled) {
      setRightSiderCollapsed(true);
    }
  }, [workspaceEnabled]);

  const workspacePanelRef = usePanelRef();
  const isRightSiderWidthOverridden = Boolean(rightSiderWidthOverride);
  const { defaultLayout: workspaceDefaultLayout, onLayoutChanged: onWorkspaceLayoutChanged } = useStoredPanelLayout({
    storageKey: 'chat-workspace-split-ratio',
    primaryPanelId: 'workspace',
    secondaryPanelId: 'main',
    defaultRatio: 20,
    minRatio: MIN_WORKSPACE_RATIO,
    maxRatio: 40,
  });
  const { defaultLayout: chatDefaultLayout, onLayoutChanged: onChatLayoutChanged } = useStoredPanelLayout({
    storageKey: 'chat-preview-split-ratio',
    primaryPanelId: 'chat',
    secondaryPanelId: 'preview',
    defaultRatio: 60,
    minRatio: MIN_CHAT_RATIO,
    maxRatio: 100 - MIN_PREVIEW_RATIO,
  });
  const [initialWorkspaceLayout] = useState(() => (rightSiderCollapsed ? { main: 100, workspace: 0 } : workspaceDefaultLayout));
  const workspaceRatioRef = useRef(workspaceDefaultLayout.workspace);
  const safeContainerWidth = Math.max(containerWidth, 1);
  const workspaceMaxWidthPx = rightSiderWidthOverride?.maxWidthPx ?? 500;
  const workspaceMinSizePx = Math.max(MIN_RIGHT_SIDER_PANEL_PX, safeContainerWidth * (MIN_WORKSPACE_RATIO / 100));
  const onWorkspaceResize = useCallback((size: PanelSize) => {
    const isCollapsed = size.inPixels === 0;
    if (!isCollapsed) {
      workspaceRatioRef.current = size.asPercentage;
    }
    if (rightCollapsedRef.current !== isCollapsed) {
      rightCollapsedRef.current = isCollapsed;
      setRightSiderCollapsed(isCollapsed);
    }
  }, []);

  useEffect(() => {
    if (!workspaceEnabled || rightSiderCollapsed) {
      workspacePanelRef.current?.collapse();
      return;
    }

    if (rightSiderWidthOverride?.widthPx) {
      const width = Math.max(MIN_RIGHT_SIDER_PANEL_PX, Math.min(rightSiderWidthOverride.widthPx, safeContainerWidth - MIN_CHAT_PANEL_PX));
      workspacePanelRef.current?.resize(`${width}px`);
    } else if (rightSiderWidthOverride?.ratio) {
      workspacePanelRef.current?.resize(`${rightSiderWidthOverride.ratio}%`);
    } else {
      workspacePanelRef.current?.resize(`${workspaceRatioRef.current}%`);
    }
  }, [rightSiderCollapsed, rightSiderWidthOverride, safeContainerWidth, workspaceEnabled, workspacePanelRef]);

  useEffect(() => {
    if (workspaceEnabled && isPreviewOpen && !rightSiderCollapsed && containerWidth < MIN_CHAT_PANEL_PX + MIN_PREVIEW_PANEL_PX + MIN_WORKSPACE_PANEL_PX) {
      setRightSiderCollapsed(true);
    }
  }, [containerWidth, isPreviewOpen, rightSiderCollapsed, workspaceEnabled]);

  // 预览打开时自动收起侧边栏和工作空间 / Auto-collapse sidebar and workspace when preview opens
  useEffect(() => {
    if (!workspaceEnabled) {
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
  }, [isPreviewOpen, layout, rightSiderCollapsed, workspaceEnabled]);

  const workspaceMaxSizePx = Math.max(workspaceMinSizePx, Math.min(workspaceMaxWidthPx, safeContainerWidth * 0.4));
  const showWorkspaceHeader = props.siderTitle != null;
  const headerBlock = (
    <>
      <ConversationTabs />
      <ArcoLayout.Header className='h-9 flex items-center justify-between p-4 gap-4 bg-background! chat-layout-header overflow-hidden'>
        <div className='shrink-0'>{props.headerLeft}</div>
        <FlexFullContainer className='h-full min-w-0' containerClassName='flex items-center gap-4'>
          <span className='max-w-full truncate text-16px font-bold text-foreground'>{props.title}</span>
        </FlexFullContainer>
        <div className='flex items-center gap-3 shrink-0'>
          {props.headerExtra}
          {/* {(backend || agentLogo) && <AgentModeSelector backend={backend} agentName={displayName} agentLogo={agentLogo} agentLogoIsEmoji={agentLogoIsEmoji} compact={false} showLogoInCompact={false} compactLabelType='mode' />} */}
          {isWindowsRuntime && workspaceEnabled && (
            <button type='button' className='workspace-header__toggle' aria-label='Toggle workspace' onClick={() => dispatchWorkspaceToggleEvent()}>
              {rightSiderCollapsed ? <ExpandRight size={16} /> : <ExpandLeft size={16} />}
            </button>
          )}
        </div>
      </ArcoLayout.Header>
    </>
  );

  const chatPanel = (
    <ArcoLayout.Content className='flex flex-col h-full'>
      {!isPreviewOpen && headerBlock}
      <ArcoLayout.Content className='flex flex-col flex-1 bg-1 overflow-hidden'>{props.children}</ArcoLayout.Content>
    </ArcoLayout.Content>
  );

  const mainPanel = isPreviewOpen ? (
    <div className='flex flex-col h-full min-w-0'>
      <div className='flex shrink-0 bg-background!'>{headerBlock}</div>
      <Group className='flex-1 min-h-0' defaultLayout={chatDefaultLayout} onLayoutChanged={onChatLayoutChanged}>
        <Panel id='chat' defaultSize='60%' minSize={`${MIN_CHAT_PANEL_PX}px`} className='flex flex-col min-w-0'>
          {chatPanel}
        </Panel>
        <ResizableSeparator />
        <Panel id='preview' defaultSize='40%' minSize={`${MIN_PREVIEW_PANEL_PX}px`} className='min-w-0'>
          <div className='preview-panel flex flex-col h-full py-1.5 pr-3 pl-2'>
            <div className='h-full w-full overflow-hidden rounded-[15px] border border-[var(--bg-3)]'>
              <PreviewPanel />
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  ) : (
    chatPanel
  );

  return (
    <ArcoLayout className='size-full'>
      <div ref={containerRef} className='flex flex-1 relative w-full overflow-hidden'>
        {workspaceEnabled ? (
          <Group className='flex-1 min-w-0' defaultLayout={initialWorkspaceLayout} onLayoutChanged={onWorkspaceLayoutChanged}>
            <Panel id='main' minSize={`${isPreviewOpen ? MIN_CHAT_PANEL_PX + MIN_PREVIEW_PANEL_PX : MIN_CHAT_PANEL_PX}px`} className='min-w-0'>
              {mainPanel}
            </Panel>
            <ResizableSeparator className={rightSiderCollapsed ? 'invisible' : undefined} isDisabled={isRightSiderWidthOverridden || rightSiderCollapsed} />
            <Panel id='workspace' panelRef={workspacePanelRef} defaultSize='20%' minSize={`${workspaceMinSizePx}px`} maxSize={`${workspaceMaxSizePx}px`} collapsedSize='0%' collapsible groupResizeBehavior='preserve-pixel-size' onResize={onWorkspaceResize} className='h-full'>
              <div className='bg-background! h-full overflow-hidden border-l border-[var(--bg-3)]'>
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
            </Panel>
          </Group>
        ) : (
          <div className='flex-1 min-w-0'>{mainPanel}</div>
        )}

        {!isMacRuntime && !isWindowsRuntime && workspaceEnabled && rightSiderCollapsed && (
          <button type='button' className='bg-2 border border-border workspace-header__toggle absolute top-1/2 right-2 z-10' style={{ transform: 'translateY(-50%)' }} onClick={() => dispatchWorkspaceToggleEvent()} aria-label='Expand workspace'>
            <ExpandLeft size={16} />
          </button>
        )}
      </div>
    </ArcoLayout>
  );
};

export default ChatLayout;
