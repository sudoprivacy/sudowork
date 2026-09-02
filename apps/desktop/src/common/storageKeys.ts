/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Centralized localStorage keys for the application
 * 应用程序的集中式 localStorage 键管理
 *
 * All localStorage keys should be defined here to:
 * - Avoid key conflicts
 * - Make it easy to find and manage all persisted states
 * - Provide a single source of truth for storage key names
 */
export const STORAGE_KEYS = {
  /** Workspace tree collapse state / 工作空间目录树折叠状态 */
  WORKSPACE_TREE_COLLAPSE: 'sudowork_workspace_collapse_state',

  /** Workspace panel collapse state / 工作空间面板折叠状态 */
  WORKSPACE_PANEL_COLLAPSE: 'sudowork_workspace_panel_collapsed',

  /** Active tab on the right-side workspace card: 'files' | 'skills' (issue #293) */
  WORKSPACE_ACTIVE_TAB: 'sudowork_workspace_active_tab',

  /** Active tab in the right-side panel: 'workspace' | 'browser' | 'terminal' */
  RIGHT_PANEL_ACTIVE_TAB: 'sudowork_right_panel_active_tab',

  /** Last browser URL in the right-side browser panel */
  RIGHT_PANEL_BROWSER_URL: 'sudowork_right_panel_browser_url',

  /** Conversation panel collapse state / 会话面板折叠状态 */
  CONVERSATION_PANEL_COLLAPSE: 'sudowork_conversation_panel_collapsed',

  /** Conversation tabs state / 会话 tabs 状态 */
  CONVERSATION_TABS: 'sudowork_conversation_tabs',

  /** Sidebar collapse state / 侧边栏折叠状态 */
  SIDEBAR_COLLAPSE: 'sudowork_sider_collapsed',

  /** Theme preference / 主题偏好 */
  THEME: 'sudowork_theme',

  /** Language preference / 语言偏好 */
  LANGUAGE: 'sudowork_language',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * One-time migration of legacy 'aionui_*' localStorage keys to 'sudowork_*'.
 * Safe to call multiple times — only migrates if old key exists and new key doesn't.
 */
export function migrateLocalStorageKeys(): void {
  const migrations: [string, string][] = [
    ['aionui_workspace_collapse_state', 'sudowork_workspace_collapse_state'],
    ['aionui_workspace_panel_collapsed', 'sudowork_workspace_panel_collapsed'],
    ['aionui_workspace_active_tab', 'sudowork_workspace_active_tab'],
    ['aionui_right_panel_active_tab', 'sudowork_right_panel_active_tab'],
    ['aionui_right_panel_browser_url', 'sudowork_right_panel_browser_url'],
    ['aionui_conversation_panel_collapsed', 'sudowork_conversation_panel_collapsed'],
    ['aionui_conversation_tabs', 'sudowork_conversation_tabs'],
    ['aionui_sider_collapsed', 'sudowork_sider_collapsed'],
    ['aionui_theme', 'sudowork_theme'],
    ['aionui_language', 'sudowork_language'],
    // Additional keys used outside STORAGE_KEYS
    ['aionui_workspace_update_time', 'sudowork_workspace_update_time'],
    ['aionui_sider_tab', 'sudowork_sider_tab'],
    ['aionui_timeline_expansion', 'sudowork_timeline_expansion'],
    ['aionui_scheduled_section_expanded', 'sudowork_scheduled_section_expanded'],
    ['aionui_scheduled_expansion', 'sudowork_scheduled_expansion'],
    ['aionui_workspace_expansion', 'sudowork_workspace_expansion'],
    ['aionui_preview_tabs', 'sudowork_preview_tabs'],
    ['aionui.emoji.recent', 'sudowork.emoji.recent'],
    ['__aionui_theme', '__sudowork_theme'],
  ];
  for (const [oldKey, newKey] of migrations) {
    const val = localStorage.getItem(oldKey);
    if (val !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, val);
      localStorage.removeItem(oldKey);
    }
  }
}
