/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Layout as ArcoLayout } from '@arco-design/web-react';
import classNames from 'classnames';
import { ChevronLeft as ExpandLeft, ChevronRight as ExpandRight } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Group, Panel, type PanelSize } from 'react-resizable-panels';

import { STORAGE_KEYS } from '@/common/storageKeys';
import ResizableSeparator from '@/renderer/components/ResizableSeparator';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { useStoredPanelLayout } from '@/renderer/hooks/useStoredPanelLayout';
import ConversationTabs from '@/renderer/pages/conversation/ConversationTabs';
import { PreviewPanel, usePreviewContext } from '@/renderer/pages/conversation/preview';
import { WORKSPACE_TOGGLE_EVENT, dispatchWorkspaceStateEvent, dispatchWorkspaceToggleEvent } from '@/renderer/utils/workspaceEvents';

const MIN_CHAT_RATIO = 25;
const MIN_WORKSPACE_RATIO = 12;
const MAX_WORKSPACE_RATIO = 50;
const MIN_PREVIEW_RATIO = 20;
const WORKSPACE_HEADER_HEIGHT = 32;
const MIN_CHAT_PANEL_PX = 360;
const MIN_PREVIEW_PANEL_PX = 340;
const MIN_RIGHT_SIDER_PANEL_PX = 300;
const WORKSPACE_TOGGLE_CLASS_NAME = 'f-center size-7 shrink-0 rounded-sm text-foreground cursor-pointer transition-colors duration-200 hover:bg-accent active:bg-fill-deep';

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
  <div className='flex items-center justify-start px-3 py-1 gap-3 border-b border-border' style={{ height: WORKSPACE_HEADER_HEIGHT, minHeight: WORKSPACE_HEADER_HEIGHT }}>
    {showToggle && togglePlacement === 'left' && (
      <button type='button' className={`${WORKSPACE_TOGGLE_CLASS_NAME} mr-1 border-none bg-transparent`} aria-label='Toggle workspace' onClick={onToggle}>
        {collapsed ? <ExpandRight size={16} /> : <ExpandLeft size={16} />}
      </button>
    )}
    <div className='flex-1 truncate'>{children}</div>
    {showToggle && togglePlacement === 'right' && (
      <button type='button' className={`${WORKSPACE_TOGGLE_CLASS_NAME} border-none bg-transparent`} aria-label='Toggle workspace' onClick={onToggle}>
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));
  const { workspaceEnabled = true, rightSiderWidthOverride } = props;
  const layout = useLayoutContext();
  const isMacRuntime = isMacEnvironment();
  const isWindowsRuntime = isWindowsEnvironment();
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
      setRightSiderCollapsed((isCollapsed) => !isCollapsed);
    };
    window.addEventListener(WORKSPACE_TOGGLE_EVENT, handleWorkspaceToggle);
    return () => {
      window.removeEventListener(WORKSPACE_TOGGLE_EVENT, handleWorkspaceToggle);
    };
  }, [workspaceEnabled]);

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

  const isRightSiderWidthOverridden = Boolean(rightSiderWidthOverride);
  const { defaultLayout: workspaceDefaultLayout, onLayoutChanged: onWorkspaceLayoutChanged } = useStoredPanelLayout({
    storageKey: 'chat-workspace-split-ratio',
    primaryPanelId: 'workspace',
    secondaryPanelId: 'main',
    defaultRatio: 20,
    minRatio: MIN_WORKSPACE_RATIO,
    maxRatio: MAX_WORKSPACE_RATIO,
  });
  const { defaultLayout: chatDefaultLayout, onLayoutChanged: onChatLayoutChanged } = useStoredPanelLayout({
    storageKey: 'chat-preview-split-ratio',
    primaryPanelId: 'chat',
    secondaryPanelId: 'preview',
    defaultRatio: 60,
    minRatio: MIN_CHAT_RATIO,
    maxRatio: 100 - MIN_PREVIEW_RATIO,
  });
  const workspaceWidthRef = useRef<number | null>(null);
  const safeContainerWidth = Math.max(containerWidth, 1);
  const workspaceMinSizePx = Math.max(MIN_RIGHT_SIDER_PANEL_PX, safeContainerWidth * (MIN_WORKSPACE_RATIO / 100));
  const workspaceMaxSizePx = Math.max(workspaceMinSizePx, Math.min(rightSiderWidthOverride?.maxWidthPx ?? Number.POSITIVE_INFINITY, safeContainerWidth * (MAX_WORKSPACE_RATIO / 100)));
  const onWorkspaceResize = useCallback((size: PanelSize) => {
    if (size.inPixels > 0) {
      workspaceWidthRef.current = size.inPixels;
    }
  }, []);

  const requestedWorkspaceWidthPx = rightSiderWidthOverride?.widthPx ?? workspaceWidthRef.current;
  const requestedWorkspaceRatio = rightSiderWidthOverride?.ratio ?? (requestedWorkspaceWidthPx === null ? workspaceDefaultLayout.workspace : (requestedWorkspaceWidthPx / safeContainerWidth) * 100);
  const workspaceMinRatio = (workspaceMinSizePx / safeContainerWidth) * 100;
  const workspaceMaxRatio = (workspaceMaxSizePx / safeContainerWidth) * 100;
  const restoredWorkspaceRatio = Math.max(workspaceMinRatio, Math.min(requestedWorkspaceRatio, workspaceMaxRatio));
  const restoredWorkspaceLayout = { main: 100 - restoredWorkspaceRatio, workspace: restoredWorkspaceRatio };

  // Preview mode may collapse the left navigation, but it does not control Workspace visibility.
  useEffect(() => {
    if (isPreviewOpen && !previousPreviewOpenRef.current) {
      if (previousSiderCollapsedRef.current === null && typeof layout?.siderCollapsed !== 'undefined') {
        previousSiderCollapsedRef.current = layout.siderCollapsed;
      }
      layout?.setSiderCollapsed?.(true);
    } else if (!isPreviewOpen && previousPreviewOpenRef.current && previousSiderCollapsedRef.current !== null && layout?.setSiderCollapsed) {
      layout.setSiderCollapsed(previousSiderCollapsedRef.current);
      previousSiderCollapsedRef.current = null;
    }

    previousPreviewOpenRef.current = isPreviewOpen;
  }, [isPreviewOpen, layout]);

  const showWorkspaceHeader = props.siderTitle != null;
  const headerBlock = (
    <>
      <ConversationTabs />
      <ArcoLayout.Header className={classNames('h-10.5 flex items-center justify-between px-4 gap-4 bg-background! chat-layout-header overflow-hidden', isMacRuntime && layout?.siderCollapsed && 'pl-200px!')}>
        <div className='shrink-0'>{props.headerLeft}</div>
        <span className='min-w-0 flex-1 truncate text-16px font-bold text-foreground'>{props.title}</span>
        <div className='flex items-center gap-3 shrink-0'>
          {props.headerExtra}
          {/* {(backend || agentLogo) && <AgentModeSelector backend={backend} agentName={displayName} agentLogo={agentLogo} agentLogoIsEmoji={agentLogoIsEmoji} compact={false} showLogoInCompact={false} compactLabelType='mode' />} */}
          {isWindowsRuntime && workspaceEnabled && (
            <button type='button' className={`${WORKSPACE_TOGGLE_CLASS_NAME} border-none bg-transparent`} aria-label='Toggle workspace' onClick={() => dispatchWorkspaceToggleEvent()}>
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
      <ArcoLayout.Content className='flex flex-col flex-1 bg-background overflow-hidden'>{props.children}</ArcoLayout.Content>
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
        <Panel id='preview' defaultSize='40%' minSize={`${MIN_PREVIEW_PANEL_PX}px`} maxSize={`${100 - MIN_CHAT_RATIO}%`} className='min-w-0'>
          <div className='preview-panel flex flex-col h-full py-1.5 pr-3 pl-2'>
            <div className='h-full w-full overflow-hidden rounded-xl border border-border'>
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
        <Group className='flex-1 min-w-0' defaultLayout={rightSiderCollapsed ? { main: 100 } : restoredWorkspaceLayout} onLayoutChanged={onWorkspaceLayoutChanged}>
          <Panel id='main' minSize={`${isPreviewOpen ? MIN_CHAT_PANEL_PX + MIN_PREVIEW_PANEL_PX : MIN_CHAT_PANEL_PX}px`} className='min-w-0'>
            {mainPanel}
          </Panel>
          {workspaceEnabled && !rightSiderCollapsed && (
            <>
              <ResizableSeparator isDisabled={isRightSiderWidthOverridden} />
              <Panel id='workspace' defaultSize={`${restoredWorkspaceRatio}%`} minSize={`${workspaceMinSizePx}px`} maxSize={`${workspaceMaxSizePx}px`} groupResizeBehavior='preserve-pixel-size' onResize={onWorkspaceResize} className='h-full'>
                <div className='bg-background! h-full overflow-hidden border-l border-border'>
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
            </>
          )}
        </Group>

        {!isMacRuntime && !isWindowsRuntime && workspaceEnabled && rightSiderCollapsed && (
          <button type='button' className={`${WORKSPACE_TOGGLE_CLASS_NAME} absolute top-1/2 right-2 z-10 border border-border bg-card`} style={{ transform: 'translateY(-50%)' }} onClick={() => dispatchWorkspaceToggleEvent()} aria-label='Expand workspace'>
            <ExpandLeft size={16} />
          </button>
        )}
      </div>
    </ArcoLayout>
  );
};

export default ChatLayout;
