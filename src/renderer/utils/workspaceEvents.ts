/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

export const WORKSPACE_TOGGLE_EVENT = 'sudowork-workspace-toggle';
export const WORKSPACE_STATE_EVENT = 'sudowork-workspace-state';
export const WORKSPACE_HAS_FILES_EVENT = 'sudowork-workspace-has-files';

export interface WorkspaceStateDetail {
  collapsed: boolean;
  previewActive?: boolean;
}

export interface WorkspaceHasFilesDetail {
  hasFiles: boolean;
  conversationId?: string;
}

export function dispatchWorkspaceToggleEvent() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WORKSPACE_TOGGLE_EVENT));
}

export function dispatchWorkspaceStateEvent(collapsed: boolean, previewActive?: boolean) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<WorkspaceStateDetail>(WORKSPACE_STATE_EVENT, { detail: { collapsed, previewActive } }));
}

/**
 * 当工作空间文件状态变化时触发
 * Dispatch when workspace files status changes
 */
export function dispatchWorkspaceHasFilesEvent(hasFiles: boolean, conversationId?: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<WorkspaceHasFilesDetail>(WORKSPACE_HAS_FILES_EVENT, { detail: { hasFiles, conversationId } }));
}
