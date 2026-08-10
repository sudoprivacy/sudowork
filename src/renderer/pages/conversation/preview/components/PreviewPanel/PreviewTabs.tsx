/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { IconShrink } from '@arco-design/web-react/icon';
import { Maximize2, Minimize2, X as Close } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { isElectronDesktop, isMacOS } from '@/renderer/utils/platform';
import type { TabFadeState } from '../../hooks/useTabOverflow';

/**
 * Tab 信息
 * Tab information
 */
export interface PreviewTab {
  /**
   * Tab ID
   */
  id: string;

  /**
   * Tab 标题
   * Tab title
   */
  title: string;

  /**
   * 是否有未保存的修改
   * Whether there are unsaved changes
   */
  isDirty?: boolean;
}

/**
 * PreviewTabs 组件属性
 * PreviewTabs component props
 */
interface PreviewTabsProps {
  /**
   * Tabs 列表
   * Tabs list
   */
  tabs: PreviewTab[];

  /**
   * 当前活动的 Tab ID
   * Current active tab ID
   */
  activeTabId: string | null;

  /**
   * Tab 渐变状态（左右溢出指示器）
   * Tab fade state (left/right overflow indicators)
   */
  tabFadeState: TabFadeState;

  /**
   * Tabs 容器引用
   * Tabs container ref
   */
  tabsContainerRef: React.RefObject<HTMLDivElement>;

  /**
   * 切换 Tab 回调
   * Switch tab callback
   */
  onSwitchTab: (tabId: string) => void;

  /**
   * 关闭 Tab 回调
   * Close tab callback
   */
  onCloseTab: (tabId: string) => void;

  /**
   * Tab 右键菜单回调
   * Tab context menu callback
   */
  onContextMenu: (e: React.MouseEvent, tabId: string) => void;

  /**
   * 是否全屏显示预览面板
   * Whether the preview panel is fullscreen
   */
  isFullscreen?: boolean;

  /**
   * 切换全屏显示回调
   * Toggle fullscreen callback
   */
  onFullscreenToggle?: () => void;

  /**
   * 关闭预览面板回调
   * Close preview panel callback
   */
  onClosePanel?: () => void;
}

/**
 * 预览面板 Tabs 栏组件
 * Preview panel tabs bar component
 *
 * 显示多个 Tab，支持切换、关闭和右键菜单
 * Displays multiple tabs, supports switching, closing, and context menu
 *
 * 包含左右渐变指示器，提示用户可以滚动查看更多 Tab
 * Includes left/right gradient indicators to prompt users that more tabs can be scrolled
 */
const PreviewTabs: React.FC<PreviewTabsProps> = ({ tabs, activeTabId, tabFadeState, tabsContainerRef, onSwitchTab, onCloseTab, onContextMenu, isFullscreen = false, onFullscreenToggle, onClosePanel }) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const { left: showLeftFade, right: showRightFade } = tabFadeState;
  const hasTrafficLightInset = isFullscreen && layout?.siderCollapsed === true && isElectronDesktop() && isMacOS();

  return (
    <div className={`relative shrink-0${hasTrafficLightInset ? ' pointer-events-none' : ''}`} style={{ minHeight: '36px', borderBottom: '1px solid var(--border-default)' }}>
      <div className='flex items-center h-36px w-full'>
        {/* Tabs 滚动区域 / Tabs scroll area */}
        <div ref={tabsContainerRef} className={`flex items-center h-full flex-1 overflow-x-auto${hasTrafficLightInset ? ' pointer-events-auto' : ''}`} style={{ marginLeft: hasTrafficLightInset ? 160 : undefined }}>
          {tabs.length > 0 ? (
            tabs.map((tab) => (
              <div key={tab.id} className={`flex items-center gap-6px px-10px h-full cursor-pointer transition-colors shrink-0 ${tab.id === activeTabId ? 'text-foreground font-medium' : 'text-secondary'}`} onClick={() => onSwitchTab(tab.id)} onContextMenu={(e) => onContextMenu(e, tab.id)}>
                <span className='text-13px whitespace-nowrap flex items-center gap-4px font-medium'>
                  {tab.title}
                  {/* 未保存指示器 / Unsaved indicator */}
                  {tab.isDirty && <span className='w-6px h-6px rd-full bg-primary' title={t('preview.unsavedChangesTitle')} />}
                </span>
                <Close
                  size={14}
                  className='text-foreground-secondary hover:text-primary'
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                />
              </div>
            ))
          ) : (
            <div className='text-12px text-tertiary px-10px'>{t('preview.noTabs')}</div>
          )}
        </div>

        {(onFullscreenToggle || onClosePanel) && (
          <div className='pointer-events-auto flex h-full shrink-0 items-center gap-1 px-2.5 rounded-tr-[16px]'>
            {onFullscreenToggle && (
              <Button
                type='text'
                size='mini'
                iconOnly
                className='size-5! text-foreground-secondary!'
                icon={isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                onClick={onFullscreenToggle}
                title={t(isFullscreen ? 'preview.exitFullscreen' : 'preview.fullscreen')}
                aria-label={t(isFullscreen ? 'preview.exitFullscreen' : 'preview.fullscreen')}
              />
            )}
            {onClosePanel && <Button type='text' size='mini' iconOnly className='size-5!' icon={<IconShrink style={{ fontSize: 14, color: 'var(--text-secondary)' }} />} onClick={onClosePanel} title={t('preview.collapsePanel')} aria-label={t('preview.collapsePanel')} />}
          </div>
        )}
      </div>

      {/* 左侧渐变指示器 / Left gradient indicator */}
      {showLeftFade && (
        <div
          className='pointer-events-none absolute left-0 top-0 bottom-0 w-32px rounded-tl-[16px]'
          style={{
            background: 'linear-gradient(90deg, var(--bg-2) 0%, transparent 100%)',
          }}
        />
      )}

      {/* 右侧渐变指示器 / Right gradient indicator */}
      {showRightFade && (
        <div
          className='pointer-events-none absolute right-0 top-0 bottom-0 w-32px rounded-tr-[16px]'
          style={{
            background: 'linear-gradient(270deg, var(--bg-2) 0%, transparent 100%)',
          }}
        />
      )}
    </div>
  );
};

export default PreviewTabs;
