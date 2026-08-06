/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Layout as ArcoLayout } from '@arco-design/web-react';
import { ChevronLeft as ExpandLeft, ChevronRight as ExpandRight } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Group, Panel, type Layout, type LayoutChangedMeta, type PanelImperativeHandle, type PanelSize } from 'react-resizable-panels';

import { STORAGE_KEYS } from '@/common/storageKeys';
import ResizableSeparator from '@/renderer/components/ResizableSeparator';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { useStoredPanelLayout } from '@/renderer/hooks/useStoredPanelLayout';
import { PreviewPanel, usePreviewContext } from '@/renderer/pages/conversation/preview';
import { WORKSPACE_TOGGLE_EVENT, dispatchWorkspaceStateEvent, dispatchWorkspaceToggleEvent } from '@/renderer/utils/workspaceEvents';

const MIN_WORKSPACE_RATIO = 12;
const MAX_WORKSPACE_RATIO = 50;
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

const isLinuxEnvironment = () => {
  if (typeof navigator === 'undefined') return false;
  return /linux/i.test(navigator.userAgent);
};

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
  const isLinuxRuntime = isLinuxEnvironment();

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
      dispatchWorkspaceStateEvent(true, isPreviewOpen);
      return;
    }
    dispatchWorkspaceStateEvent(rightSiderCollapsed, isPreviewOpen);
  }, [rightSiderCollapsed, workspaceEnabled, isPreviewOpen]);

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

  const workspaceWidthRef = useRef<number | null>(null);
  const previewPanelRef = useRef<PanelImperativeHandle | null>(null);
  const previewRatioRef = useRef(50);
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

  useEffect(() => {
    if (!isPreviewOpen) return;
    const frame = requestAnimationFrame(() => previewPanelRef.current?.resize(`${previewRatioRef.current}%`));
    return () => cancelAnimationFrame(frame);
  }, [isPreviewOpen]);

  const onPreviewLayoutChanged = useCallback((panelLayout: Layout, meta: LayoutChangedMeta) => {
    if (meta.isUserInteraction && Number.isFinite(panelLayout.preview)) {
      previewRatioRef.current = panelLayout.preview;
    }
  }, []);

  const headerBlock = (
    <ArcoLayout.Header
      className={`h-10.5 flex items-center justify-between px-4 gap-4 bg-background! chat-layout-header overflow-hidden${isLinuxRuntime ? ' mt-3' : ''}`}
      style={{
        paddingLeft: isMacRuntime && layout?.siderCollapsed ? 200 : isLinuxRuntime && layout?.siderCollapsed ? 120 : undefined,
        paddingRight: isWindowsRuntime ? 140 : undefined,
        transition: 'padding-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <div className='shrink-0'>{props.headerLeft}</div>
      <span className='min-w-0 flex-1 truncate text-16px font-bold text-foreground'>{props.title}</span>
      <div className='flex items-center gap-3 shrink-0'>
        {props.headerExtra}
        {isWindowsRuntime && workspaceEnabled && (
          <button type='button' className={`${WORKSPACE_TOGGLE_CLASS_NAME} border-none bg-transparent`} aria-label='Toggle workspace' onClick={() => dispatchWorkspaceToggleEvent()}>
            {rightSiderCollapsed ? <ExpandRight size={16} /> : <ExpandLeft size={16} />}
          </button>
        )}
      </div>
    </ArcoLayout.Header>
  );

  const chatPanel = (
    <ArcoLayout.Content className='flex flex-col h-full'>
      {headerBlock}
      <ArcoLayout.Content className='flex flex-col flex-1 bg-background overflow-hidden'>{props.children}</ArcoLayout.Content>
    </ArcoLayout.Content>
  );

  const mainPanel = chatPanel;

  return (
    <ArcoLayout className='size-full'>
      <div ref={containerRef} className='flex flex-1 relative w-full overflow-hidden'>
        <Group className='flex-1 min-w-0' defaultLayout={!isPreviewOpen && rightSiderCollapsed ? { main: 100 } : isPreviewOpen ? { main: 50, preview: 50 } : restoredWorkspaceLayout} onLayoutChanged={isPreviewOpen ? onPreviewLayoutChanged : onWorkspaceLayoutChanged}>
          <Panel id='main' minSize={`${MIN_CHAT_PANEL_PX}px`} className='min-w-0'>
            {mainPanel}
          </Panel>
          {(isPreviewOpen || (workspaceEnabled && !rightSiderCollapsed)) && (
            <>
              <ResizableSeparator isDisabled={isRightSiderWidthOverridden} />
              {isPreviewOpen ? (
                <Panel key='preview' id='preview' panelRef={previewPanelRef} defaultSize='50%' minSize={`${MIN_PREVIEW_PANEL_PX}px`} maxSize={`${workspaceMaxSizePx}px`} groupResizeBehavior='preserve-pixel-size' className='h-full'>
                  <div className='bg-background! h-full overflow-hidden border-l border-border'>
                    <div className='preview-panel flex flex-col h-full py-1.5 pr-3 pl-2 relative z-11 [-webkit-app-region:no-drag]'>
                      <div className='h-full w-full overflow-hidden rounded-xl border border-border'>
                        <PreviewPanel />
                      </div>
                    </div>
                  </div>
                </Panel>
              ) : (
                <Panel key='workspace' id='workspace' defaultSize={`${restoredWorkspaceRatio}%`} minSize={`${workspaceMinSizePx}px`} maxSize={`${workspaceMaxSizePx}px`} groupResizeBehavior='preserve-pixel-size' onResize={onWorkspaceResize} className='h-full'>
                  <div className='bg-background! h-full overflow-hidden border-l border-border'>
                    <ArcoLayout.Content className='h-full'>{props.sider}</ArcoLayout.Content>
                  </div>
                </Panel>
              )}
            </>
          )}
        </Group>
      </div>
    </ArcoLayout>
  );
};

export default ChatLayout;
