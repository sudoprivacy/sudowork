/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';

/**
 * 预览面板快捷键配置
 * Preview panel keyboard shortcuts configuration
 */
interface UsePreviewKeyboardShortcutsOptions {
  /**
   * 当前是否有未保存的修改
   * Whether there are unsaved changes
   */
  isDirty?: boolean;

  /**
   * 保存回调函数
   * Save callback function
   */
  onSave: () => void;

  /**
   * 预览面板是否打开
   * Whether preview panel is open
   */
  isOpen?: boolean;

  /**
   * 关闭预览回调函数
   * Close preview callback function
   */
  onClose?: () => void;
}

/**
 * 处理预览面板快捷键
 * Handle preview panel keyboard shortcuts
 * - Cmd/Ctrl + S: 保存
 * - Escape: 关闭预览面板
 *
 * @param options - 快捷键配置 / Keyboard shortcuts configuration
 */
export const usePreviewKeyboardShortcuts = ({ isDirty, onSave, isOpen, onClose }: UsePreviewKeyboardShortcutsOptions): void => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape - 关闭预览面板
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        onClose?.();
        return;
      }

      // Cmd/Ctrl + S - 保存
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault(); // 阻止浏览器默认保存行为 / Prevent default browser save
        if (isDirty) {
          onSave();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDirty, onSave, isOpen, onClose]);
};
