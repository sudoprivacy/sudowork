/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Notification, BrowserWindow } from 'electron';
import { ipcBridge } from '@/common';
import { getSudoClawBridge } from '@/channels/agent/SudoClawBridge';
import type { ISudoClawAskUserRequest } from '@/channels/agent/sudoclaw/types';

/**
 * SudoClawNotificationService — Desktop notification handler for Electron.
 *
 * When the model calls AskUserTool, this service:
 * 1. Shows a native OS notification with action buttons
 * 2. Clicking the notification opens the conversation in the main window
 * 3. For quick responses, the user can approve/deny from the notification
 * 4. Also emits IPC events so the renderer can show an inline reply box
 */
export class SudoClawNotificationService {
  private initialized = false;
  private unsubscribe: (() => void) | null = null;

  /**
   * Initialize the notification service.
   * Registers as a listener for AskUser events via SudoClawBridge.
   */
  initialize(): void {
    if (this.initialized) return;

    const bridge = getSudoClawBridge();
    this.unsubscribe = bridge.registerAskUserListener((request) => {
      this.handleAskUser(request);
    });

    this.initialized = true;
    console.log('[SudoClawNotificationService] Initialized');
  }

  /**
   * Handle an AskUser request by showing a desktop notification.
   */
  private handleAskUser(request: ISudoClawAskUserRequest): void {
    // 1. Show native desktop notification
    this.showDesktopNotification(request);

    // 2. Emit IPC event to renderer for inline reply box
    this.emitToRenderer(request);
  }

  /**
   * Show a native OS notification.
   */
  private showDesktopNotification(request: ISudoClawAskUserRequest): void {
    if (!Notification.isSupported()) {
      console.warn('[SudoClawNotificationService] Notifications not supported on this platform');
      return;
    }

    const urgencyLabel = request.urgency === 'critical' ? '🚨 Critical' : request.urgency === 'action_needed' ? '🔔 Action Needed' : 'ℹ️ Info';

    const notification = new Notification({
      title: `SudoClaw — ${urgencyLabel}`,
      body: request.question.length > 200 ? request.question.slice(0, 200) + '...' : request.question,
      urgency: request.urgency === 'critical' ? 'critical' : request.urgency === 'action_needed' ? 'normal' : 'low',
      actions: [
        { type: 'button', text: 'Approve' },
        { type: 'button', text: 'Deny' },
      ],
    });

    // Clicking the notification body opens the conversation
    notification.on('click', () => {
      this.focusMainWindowAndNavigate(request.conversationId);
    });

    // Handle action button clicks (macOS)
    notification.on('action', (_event, index) => {
      const bridge = getSudoClawBridge();
      if (index === 0) {
        // Approve
        bridge.routeDesktopResponse(request.requestId, request.conversationId, 'approve', 'local-user', 'Local User');
      } else if (index === 1) {
        // Deny
        bridge.routeDesktopResponse(request.requestId, request.conversationId, 'deny', 'local-user', 'Local User');
      }
    });

    notification.show();
  }

  /**
   * Emit an IPC event to the renderer so it can show the inline reply box.
   */
  private emitToRenderer(request: ISudoClawAskUserRequest): void {
    try {
      ipcBridge.sudoclaw.askUserRequest.emit({
        requestId: request.requestId,
        conversationId: request.conversationId,
        question: request.question,
        urgency: request.urgency,
        suggestedActions: request.suggestedActions,
        context: request.context,
        createdAt: request.createdAt,
        timeoutMs: request.timeoutMs,
      });
    } catch {
      // IPC bridge may not have this endpoint yet (depends on #212)
      console.warn('[SudoClawNotificationService] Failed to emit askUserRequest to renderer — IPC endpoint may not be registered yet');
    }
  }

  /**
   * Focus the main window and navigate to the conversation.
   */
  private focusMainWindowAndNavigate(conversationId: string): void {
    const windows = BrowserWindow.getAllWindows();
    const mainWindow = windows[0];
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();

      // Send navigation event to renderer
      try {
        mainWindow.webContents.send('navigate-to-conversation', conversationId);
      } catch {
        // Ignore if renderer is not ready
      }
    }
  }

  /**
   * Shutdown the service.
   */
  shutdown(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.initialized = false;
    console.log('[SudoClawNotificationService] Shutdown');
  }
}

// Singleton
let serviceInstance: SudoClawNotificationService | null = null;

export function getSudoClawNotificationService(): SudoClawNotificationService {
  if (!serviceInstance) {
    serviceInstance = new SudoClawNotificationService();
  }
  return serviceInstance;
}
