/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dropdown } from '@arco-design/web-react';
import { Camera, Columns2, Download, ExternalLink, History, MousePointer2, Save, SquarePen } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { PreviewHistoryTarget } from '@/common/types/preview';

/**
 * PreviewToolbar 组件属性
 * PreviewToolbar component props
 */
interface PreviewToolbarProps {
  /**
   * 内容类型
   * Content type
   */
  contentType: string;

  /**
   * 是否为 Markdown 文件
   * Whether it's a Markdown file
   */
  isMarkdown: boolean;

  /**
   * 是否为 HTML 文件
   * Whether it's an HTML file
   */
  isHTML: boolean;

  /**
   * 是否可编辑
   * Whether editable
   */
  isEditable: boolean;

  /**
   * 是否处于编辑模式
   * Whether in edit mode
   */
  isEditMode: boolean;

  /**
   * 当前视图模式
   * Current view mode
   */
  viewMode: 'source' | 'preview';

  /**
   * 是否启用分屏模式
   * Whether split-screen mode is enabled
   */
  isSplitScreenEnabled: boolean;

  /**
   * 文件名
   * Filename
   */
  fileName?: string;

  /**
   * 是否显示"在系统中打开"按钮
   * Whether to show "Open in System" button
   */
  showOpenInSystemButton: boolean;

  /**
   * 历史目标
   * History target
   */
  historyTarget: PreviewHistoryTarget | null;

  /**
   * 是否正在保存快照
   * Whether snapshot is saving
   */
  snapshotSaving: boolean;

  /**
   * 是否显示快照/历史入口
   * Whether to show snapshot/history actions
   */
  showHistoryControls?: boolean;

  /**
   * 是否允许切换到原文/分屏编辑视图
   * Whether source/split editor views are available
   */
  sourceViewEnabled?: boolean;

  /**
   * 设置视图模式
   * Set view mode
   */
  onViewModeChange: (mode: 'source' | 'preview') => void;

  /**
   * 设置分屏模式
   * Set split-screen mode
   */
  onSplitScreenToggle: () => void;

  /**
   * 编辑按钮点击
   * Edit button click
   */
  onEditClick: () => void;

  /**
   * 退出编辑按钮点击
   * Exit edit button click
   */
  onExitEdit: () => void;

  /**
   * 保存快照
   * Save snapshot
   */
  onSaveSnapshot: () => void;

  /**
   * 刷新历史列表
   * Refresh history list
   */
  onRefreshHistory: () => void;

  /**
   * 渲染历史下拉菜单
   * Render history dropdown
   */
  renderHistoryDropdown: () => React.ReactNode;

  /**
   * 在系统中打开文件
   * Open file in system
   */
  onOpenInSystem: () => void;

  /**
   * 下载文件
   * Download file
   */
  onDownload: () => void;

  /**
   * 关闭预览面板
   * Close preview panel
   */
  onClose: () => void;

  /**
   * HTML 审核元素模式（仅HTML类型使用）
   * HTML inspect mode (only for HTML type)
   */
  inspectMode?: boolean;

  /**
   * 切换HTML审核元素模式（仅HTML类型使用）
   * Toggle HTML inspect mode (only for HTML type)
   */
  onInspectModeToggle?: () => void;

  /**
   * 左侧额外渲染内容
   * Extra content rendered on the left section
   */
  leftExtra?: React.ReactNode;

  /**
   * 右侧额外渲染内容
   * Extra content rendered on the right section
   */
  rightExtra?: React.ReactNode;

  /**
   * 是否有未保存的修改
   * Whether there are unsaved changes
   */
  isDirty?: boolean;

  /**
   * 保存按钮点击回调
   * Save button click callback
   */
  onSave?: () => void;

  /**
   * 是否正在保存
   * Whether saving is in progress
   */
  isSaving?: boolean;
}

/**
 * 预览面板工具栏组件
 * Preview panel toolbar component
 *
 * 包含文件名、视图模式切换、编辑按钮、快照/历史按钮、下载按钮、关闭按钮等
 * Contains filename, view mode toggle, edit button, snapshot/history buttons, download button, close button, etc.
 */
// eslint-disable-next-line max-len
const PreviewToolbar: React.FC<PreviewToolbarProps> = ({
  contentType,
  isMarkdown,
  isHTML,
  isEditable,
  isEditMode,
  viewMode,
  isSplitScreenEnabled,
  showOpenInSystemButton,
  historyTarget,
  snapshotSaving,
  showHistoryControls = true,
  sourceViewEnabled = true,
  onViewModeChange,
  onSplitScreenToggle,
  onEditClick,
  onExitEdit,
  onSaveSnapshot,
  onRefreshHistory,
  renderHistoryDropdown,
  onOpenInSystem,
  onDownload,
  inspectMode,
  onInspectModeToggle,
  leftExtra,
  rightExtra,
  isDirty,
  onSave,
  isSaving,
}) => {
  const { t } = useTranslation();
  const isDiff = contentType === 'diff';
  const preferActionButtonsInFront = Boolean(leftExtra);

  const toolbarBtn = 'f-center gap-0.5 px-2 py-1 rounded-sm cursor-pointer transition-colors duration-150 text-xs font-medium text-foreground-secondary hover:bg-accent hover:text-accent-foreground';
  const toolbarBtnActive = 'text-brand-foreground! bg-brand hover:text-brand-foreground! hover:bg-brand hover:brightness-95';
  const toolbarIconSize = 12;

  return (
    <div className='flex h-8 shrink-0 items-center justify-between overflow-x-auto border-b border-border bg-card px-2.5 scrollbar-hide'>
      <div className='flex w-full items-center justify-between gap-2' style={{ minWidth: 'max-content' }}>
        {/* 左侧：Tabs（Markdown/HTML）+ 文件名 / Left: Tabs (Markdown/HTML) + Filename */}
        <div className='flex h-full items-center gap-2'>
          {(isMarkdown || isHTML || isDiff) && sourceViewEnabled && (
            <>
              <div className='flex items-center h-full gap-0'>
                <div
                  className={`flex h-full cursor-pointer items-center border-b-2 border-transparent px-2.5 text-xs font-medium transition-colors duration-150 ${viewMode === 'source' ? 'border-brand bg-brand-surface text-brand' : 'text-foreground-secondary hover:bg-accent hover:text-foreground'}`}
                  onClick={() => {
                    try {
                      onViewModeChange('source');
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {isHTML ? t('preview.code') : t('preview.source')}
                </div>
                <div
                  className={`flex h-full cursor-pointer items-center border-b-2 border-transparent px-2.5 text-xs font-medium transition-colors duration-150 ${viewMode === 'preview' ? 'border-brand bg-brand-surface text-brand' : 'text-foreground-secondary hover:bg-accent hover:text-foreground'}`}
                  onClick={() => {
                    try {
                      onViewModeChange('preview');
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {t('preview.preview')}
                </div>
              </div>
              {!isDiff && (
                <>
                  {/* 保存按钮：Markdown/HTML 在 source 或分屏模式下有变更时显示 / Save button: shown for Markdown/HTML in source or split mode with changes */}
                  {(isMarkdown || isHTML) && (viewMode === 'source' || isSplitScreenEnabled) && isDirty && onSave && (
                    <div className={`${toolbarBtn} text-success-foreground! bg-success hover:text-success-foreground! hover:bg-success hover:brightness-95`} onClick={() => void onSave()} title={t('common.save')}>
                      <Save size={toolbarIconSize} />
                      <span>{isSaving ? t('common.saving') : t('common.save')}</span>
                    </div>
                  )}
                  <div
                    className={`${toolbarBtn} ${isSplitScreenEnabled ? toolbarBtnActive : ''}`}
                    onClick={() => {
                      try {
                        onSplitScreenToggle();
                      } catch {
                        /* ignore */
                      }
                    }}
                    title={isSplitScreenEnabled ? t('preview.closeSplitScreen') : t('preview.openSplitScreen')}
                  >
                    <Columns2 size={toolbarIconSize} />
                  </div>
                </>
              )}
            </>
          )}

          {(isMarkdown || isHTML || isDiff) && !sourceViewEnabled && (
            <div className='flex items-center h-full gap-0'>
              <div className='flex h-full items-center border-b-2 border-brand bg-brand-surface px-2.5 text-xs font-medium text-brand'>{t('preview.preview')}</div>
            </div>
          )}

          {contentType === 'code' && isEditable && sourceViewEnabled && (
            <div className={`${toolbarBtn} ${isEditMode ? toolbarBtnActive : ''}`} onClick={() => (isEditMode ? onExitEdit() : onEditClick())} title={isEditMode ? t('preview.exitEdit') : t('preview.edit')}>
              <SquarePen size={toolbarIconSize} strokeWidth={1.8} />
              <span>{isEditMode ? t('preview.exitEdit') : t('preview.edit')}</span>
            </div>
          )}

          {/* 保存按钮：编辑模式下且有修改时显示 / Save button: shown in edit mode with unsaved changes */}
          {isEditable && isEditMode && isDirty && onSave && (
            <div className={`${toolbarBtn} text-success-foreground! bg-success hover:text-success-foreground! hover:bg-success hover:brightness-95`} onClick={() => void onSave()} title={t('common.save')}>
              <Save size={toolbarIconSize} />
              <span>{isSaving ? t('common.saving') : t('common.save')}</span>
            </div>
          )}

          {isEditable && isEditMode && (
            <div
              className={`${toolbarBtn} ${isSplitScreenEnabled ? toolbarBtnActive : ''}`}
              onClick={() => {
                try {
                  onSplitScreenToggle();
                } catch {
                  /* ignore */
                }
              }}
              title={isSplitScreenEnabled ? t('preview.closeSplitScreen') : t('preview.openSplitScreen')}
            >
              <Columns2 size={toolbarIconSize} />
            </div>
          )}

          {preferActionButtonsInFront && showOpenInSystemButton && (
            <div className={toolbarBtn} onClick={onOpenInSystem} title={t('preview.openInSystemApp')}>
              <ExternalLink size={toolbarIconSize} />
              <span>{t('preview.openInSystemApp')}</span>
            </div>
          )}
          {preferActionButtonsInFront && (
            <div className={toolbarBtn} onClick={() => void onDownload()} title={t('preview.downloadFile')}>
              <Download size={toolbarIconSize} />
              <span>{t('common.download')}</span>
            </div>
          )}
          {leftExtra}
        </div>

        <div className='flex shrink-0 items-center gap-1'>
          {rightExtra}

          {showHistoryControls && ((contentType === 'markdown' && (viewMode === 'source' || isSplitScreenEnabled)) || (contentType === 'html' && (viewMode === 'source' || isSplitScreenEnabled)) || (contentType === 'code' && isEditable && isEditMode)) && (
            <>
              <div className={`${toolbarBtn} ${historyTarget ? '' : 'cursor-not-allowed! opacity-50'} ${snapshotSaving ? 'opacity-60' : ''}`} onClick={historyTarget && !snapshotSaving ? onSaveSnapshot : undefined} title={historyTarget ? t('preview.saveSnapshot') : t('preview.snapshotNotSupported')}>
                <Camera size={toolbarIconSize} strokeWidth={1.8} />
                <span>{t('preview.snapshot')}</span>
              </div>
              {historyTarget ? (
                <Dropdown droplist={renderHistoryDropdown()} trigger={['hover']} position='br' onVisibleChange={(visible) => visible && onRefreshHistory()}>
                  <div className={toolbarBtn} title={t('preview.historyVersions')}>
                    <History size={toolbarIconSize} strokeWidth={1.8} />
                    <span>{t('preview.history')}</span>
                  </div>
                </Dropdown>
              ) : (
                <div className={`${toolbarBtn} cursor-not-allowed! opacity-50`} title={t('preview.historyNotSupported')}>
                  <History size={toolbarIconSize} strokeWidth={1.8} />
                  <span>{t('preview.history')}</span>
                </div>
              )}
            </>
          )}

          {!preferActionButtonsInFront && showOpenInSystemButton && (
            <div className={toolbarBtn} onClick={onOpenInSystem} title={t('preview.openInSystemApp')}>
              <ExternalLink size={toolbarIconSize} />
              <span>{t('preview.openInSystemApp')}</span>
            </div>
          )}

          {!preferActionButtonsInFront && (
            <div className={toolbarBtn} onClick={() => void onDownload()} title={t('preview.downloadFile')}>
              <Download size={toolbarIconSize} />
              <span>{t('common.download')}</span>
            </div>
          )}

          {isHTML && onInspectModeToggle && (
            <div className={`${toolbarBtn} ${inspectMode ? toolbarBtnActive : ''}`} onClick={onInspectModeToggle} title={inspectMode ? t('preview.html.inspectElementDisable') : t('preview.html.inspectElementEnable')}>
              <MousePointer2 size={toolbarIconSize} />
              <span>{inspectMode ? t('preview.html.inspecting') : t('preview.html.inspectElement')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PreviewToolbar;
