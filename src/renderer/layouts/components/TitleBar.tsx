/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { WORKSPACE_STATE_EVENT, dispatchWorkspaceToggleEvent } from '@renderer/utils/workspaceEvents';
import type { WorkspaceStateDetail } from '@renderer/utils/workspaceEvents';
import WindowControls from '@renderer/components/WindowControls';
import { useLayoutContext } from '@renderer/context/LayoutContext';
import { isElectronDesktop, isMacOS } from '@renderer/utils/platform';

interface TitlebarProps {
  workspaceAvailable: boolean;
}

const Titlebar: React.FC<TitlebarProps> = ({ workspaceAvailable }) => {
  const { t } = useTranslation();
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(true);
  const layout = useLayoutContext();

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

  const workspaceTooltip = workspaceCollapsed ? t('common.expandMore', { defaultValue: '展开更多' }) : t('common.collapse', { defaultValue: '收起' });
  const iconSize = 18;
  const showSiderToggle = Boolean(layout?.setSiderCollapsed);
  const siderTooltip = layout?.siderCollapsed ? t('common.expandMore', { defaultValue: '展开更多' }) : t('common.collapse', { defaultValue: '收起' });

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

  const siderToggleStyle: React.CSSProperties = useMemo(() => {
    if (layout?.siderCollapsed) {
      if (!isMacRuntime) {
        return {};
      }
      return { marginLeft: '80px' };
    }
    return {
      width: 'calc(var(--layout-sider-width, 260px) - 8px)',
      justifyContent: 'flex-end',
    };
  }, [isMacRuntime, layout?.siderCollapsed]);

  const toolbarStyle: React.CSSProperties = useMemo(() => {
    if (!isMacRuntime) return {};
    return { marginLeft: '80px' };
  }, [isMacRuntime]);

  return (
    <div className={classNames('app-titlebar relative z-10 flex items-center justify-between gap-2 pl-2 select-none bg-background h-9 min-h-9 leading-9', isMacRuntime ? 'pr-3' : 'pr-2', isDesktopRuntime && '[-webkit-app-region:drag]')}>
      <div className='relative z-1 flex items-center [-webkit-app-region:no-drag]' style={siderToggleStyle}>
        {showSiderToggle && (
          <button
            type='button'
            className={classNames('[-webkit-app-region:no-drag] size-9 border-none rd-6px bg-transparent text-foreground inline-flex items-center justify-center cursor-pointer transition-colors duration-200 hover:bg-transparent! active:bg-transparent!', isMacRuntime && 'translate-y-3px')}
            onClick={handleSiderToggle}
            aria-label={siderTooltip}
          >
            {layout?.siderCollapsed ? <PanelLeftOpen size={iconSize} /> : <PanelLeftClose size={iconSize} />}
          </button>
        )}
      </div>
      <div className='relative z-1 flex items-center gap-1 ml-auto [-webkit-app-region:no-drag] min-h-9' style={toolbarStyle}>
        {showWorkspaceButton && (
          <button
            type='button'
            className='[-webkit-app-region:no-drag] size-9 border-none rd-6px bg-transparent text-foreground inline-flex items-center justify-center cursor-pointer transition-colors duration-200 hover:bg-accent active:bg-fill-deep'
            onClick={handleWorkspaceToggle}
            aria-label={workspaceTooltip}
          >
            {workspaceCollapsed ? <PanelRightOpen size={iconSize} /> : <PanelRightClose size={iconSize} />}
          </button>
        )}
        {showWindowControls && <WindowControls />}
      </div>
    </div>
  );
};

export default Titlebar;
