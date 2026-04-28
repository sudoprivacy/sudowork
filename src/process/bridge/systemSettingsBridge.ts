/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 系统设置桥接模块
 * System Settings Bridge Module
 *
 * 负责���理系统级设置的读写操作（如关闭到托盘）
 * Handles read/write operations for system-level settings (e.g. close to tray)
 */

import { ipcBridge } from '@/common';
import { ProcessConfig } from '@/process/initStorage';
import { changeLanguage } from '@process/i18n';
import { mainError } from '@process/utils/mainLogger';
import { userBreadcrumbs } from '@process/telemetry/BreadcrumbTracker';

type CloseToTrayChangeListener = (enabled: boolean) => void;
let _changeListener: CloseToTrayChangeListener | null = null;

type LanguageChangeListener = () => void;
let _languageChangeListener: LanguageChangeListener | null = null;

type AvatarEnabledChangeListener = (enabled: boolean) => void;
let _avatarEnabledChangeListener: AvatarEnabledChangeListener | null = null;

/**
 * 注册关闭到托盘设置变更监听器（供主进程 index.ts 使用）
 * Register a listener for close-to-tray setting changes (used by main process index.ts)
 */
export function onCloseToTrayChanged(listener: CloseToTrayChangeListener): void {
  _changeListener = listener;
}

/**
 * 注册语言变更监听器（供主进程 index.ts 使用）
 * Register a listener for language changes (used by main process index.ts)
 */
export function onLanguageChanged(listener: LanguageChangeListener): void {
  _languageChangeListener = listener;
}

/**
 * 注册 avatar 浮窗开关变更监听器（供主进程 index.ts 使用，控制 avatar 窗口生命周期）
 * Register a listener for avatar-enabled setting changes (used by main process
 * index.ts to create / destroy the floating avatar BrowserWindow at runtime).
 */
export function onAvatarEnabledChanged(listener: AvatarEnabledChangeListener): void {
  _avatarEnabledChangeListener = listener;
}

export function initSystemSettingsBridge(): void {
  // 获取"关闭到托盘"设置 / Get "close to tray" setting
  ipcBridge.systemSettings.getCloseToTray.provider(async () => {
    const value = await ProcessConfig.get('system.closeToTray');
    return value ?? false;
  });

  // 设置"关闭到托盘"，先持久化再通知主进程
  // Set "close to tray", persist first then notify main process
  ipcBridge.systemSettings.setCloseToTray.provider(async ({ enabled }) => {
    // Breadcrumb: settings changed
    userBreadcrumbs.settingsChange('closeToTray', enabled);

    // 先持久化到配置存储
    await ProcessConfig.set('system.closeToTray', enabled);
    // 然后通知主进程更新托盘状态
    _changeListener?.(enabled);
  });

  // 获取 avatar 浮窗开关 / Get floating avatar window enabled setting
  ipcBridge.systemSettings.getAvatarEnabled.provider(async () => {
    const value = await ProcessConfig.get('avatar.enabled');
    return value ?? false;
  });

  // 设置 avatar 浮窗开关，先持久化再通知主进程切换窗口
  // Set avatar enabled, persist first then notify main process to toggle window
  ipcBridge.systemSettings.setAvatarEnabled.provider(async ({ enabled }) => {
    await ProcessConfig.set('avatar.enabled', enabled);
    _avatarEnabledChangeListener?.(enabled);
  });

  // 语言变更通知，同步主进程 i18n 并通知托盘重建
  // Language change notification, sync main process i18n and notify tray rebuild
  ipcBridge.systemSettings.changeLanguage.provider(async ({ language }) => {
    // Breadcrumb: settings changed
    userBreadcrumbs.settingsChange('language', language);

    // Broadcast to all renderers FIRST (desktop + WebUI) for real-time sync.
    // This must happen before the potentially slow main-process i18n switch.
    ipcBridge.systemSettings.languageChanged.emit({ language });
    _languageChangeListener?.();

    // Update main process i18n (non-blocking – don't let a hang here block the provider)
    changeLanguage(language).catch((error) => {
      mainError('SystemSettings', 'Main process changeLanguage failed:', error);
    });
  });
}
