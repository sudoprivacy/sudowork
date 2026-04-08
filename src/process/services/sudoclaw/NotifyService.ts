/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Notification } from 'electron';
import { ipcBridge } from '@/common';
import { channelEventBus, type ISudoClawNotificationEvent, type SudoClawUrgency } from '@/channels/agent/ChannelEventBus';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';

const LOG_TAG = 'SudoClawNotify';

/**
 * SudoClawNotifyService — Routes SudoClaw notifications to all channels.
 *
 * Listens to `channelEventBus.on('sudoclaw-notification')` and fans out to:
 *   1. **Desktop** — Electron `Notification` API
 *   2. **WebUI** — WebSocket broadcast via the registered bridge broadcaster
 *   3. **Channels** — All running channel plugins (Telegram / Lark / DingTalk / WeChat / WeCom)
 *
 * Urgency-based routing:
 *   - `info`          → silent desktop notification, WebSocket update only
 *   - `action_needed` → persistent desktop notification + channel broadcast
 *   - `completed`     → summary desktop notification + channel broadcast
 */
export class SudoClawNotifyService {
  private eventCleanup: (() => void) | null = null;
  private initialized = false;

  /**
   * Start listening for SudoClaw notification events.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    this.eventCleanup = channelEventBus.onSudoClawNotification((event) => {
      this.handleNotification(event);
    });

    this.initialized = true;
    mainLog(LOG_TAG, 'Initialized — listening for sudoclaw-notification events');
  }

  /**
   * Central handler — routes a notification to Desktop, WebUI, and Channels
   * based on the event's urgency level.
   */
  private handleNotification(event: ISudoClawNotificationEvent): void {
    const { urgency } = event;

    mainLog(LOG_TAG, `Notification received: urgency=${urgency}, title="${event.title}"`);

    // 1. Desktop (Electron) notification — all urgency levels, but silent for `info`
    this.sendDesktopNotification(event);

    // 2. WebUI (WebSocket) broadcast — all urgency levels
    this.sendWebUINotification(event);

    // 3. Channel broadcast — only for `action_needed` and `completed`
    if (urgency === 'action_needed' || urgency === 'completed') {
      this.sendChannelNotification(event);
    }
  }

  // ---------------------------------------------------------------------------
  //  Desktop (Electron Notification)
  // ---------------------------------------------------------------------------

  private sendDesktopNotification(event: ISudoClawNotificationEvent): void {
    try {
      const isSilent = event.urgency === 'info';

      const notification = new Notification({
        title: `SudoClaw — ${this.urgencyLabel(event.urgency)}`,
        body: event.body,
        silent: isSilent,
      });

      notification.show();
      mainLog(LOG_TAG, `Desktop notification sent (silent=${isSilent})`);
    } catch (error) {
      // Notification API may be unavailable in non-GUI environments
      mainWarn(LOG_TAG, 'Failed to show desktop notification', error);
    }
  }

  // ---------------------------------------------------------------------------
  //  WebUI (WebSocket broadcast via bridge adapter)
  // ---------------------------------------------------------------------------

  private sendWebUINotification(event: ISudoClawNotificationEvent): void {
    try {
      // Use the typed ipcBridge emitter which fans out to both
      // Electron BrowserWindows and registered WebSocket broadcasters
      // through the bridge adapter system.
      ipcBridge.sudoclaw.notification.emit({
        title: event.title,
        body: event.body,
        urgency: event.urgency,
        conversationId: event.conversationId,
        metadata: event.metadata,
        timestamp: Date.now(),
      });

      mainLog(LOG_TAG, 'WebUI notification broadcast sent');
    } catch (error) {
      mainWarn(LOG_TAG, 'Failed to broadcast WebUI notification', error);
    }
  }

  // ---------------------------------------------------------------------------
  //  Channels (Telegram / Lark / DingTalk / WeChat / WeCom)
  // ---------------------------------------------------------------------------

  private sendChannelNotification(event: ISudoClawNotificationEvent): void {
    // Lazy-import to avoid circular dependency at module load time
    // and to tolerate ChannelManager not being initialised yet.
    void (async () => {
      try {
        const { ChannelManager } = await import('@/channels/core/ChannelManager');
        const channelManager = ChannelManager.getInstance();

        if (!channelManager.isInitialized()) {
          mainWarn(LOG_TAG, 'ChannelManager not initialized — skipping channel broadcast');
          return;
        }

        const pluginManager = channelManager.getPluginManager();
        if (!pluginManager) {
          mainWarn(LOG_TAG, 'PluginManager not available — skipping channel broadcast');
          return;
        }

        const plugins = pluginManager.getAllPlugins();
        const runningPlugins = plugins.filter((p) => p.status === 'running');

        if (runningPlugins.length === 0) {
          mainLog(LOG_TAG, 'No running channel plugins — skipping channel broadcast');
          return;
        }

        const message = this.buildChannelMessage(event);
        let sentCount = 0;

        // Broadcast to all active users across all running channel plugins
        const sessionManager = channelManager.getSessionManager();
        if (!sessionManager) {
          mainWarn(LOG_TAG, 'SessionManager not available — skipping channel broadcast');
          return;
        }

        const activeSessions = sessionManager.getAllSessions();

        for (const session of activeSessions) {
          if (!session.chatId) continue;

          // Determine which plugin owns this session by looking up the user's platform
          for (const plugin of runningPlugins) {
            try {
              await plugin.sendMessage(session.chatId, message);
              sentCount++;
              break; // Only send once per session
            } catch {
              // Plugin doesn't own this chatId — try next plugin
            }
          }
        }

        mainLog(LOG_TAG, `Channel notification sent to ${sentCount} active session(s) via ${runningPlugins.length} plugin(s)`);
      } catch (error) {
        mainError(LOG_TAG, 'Failed to broadcast channel notification', error);
      }
    })();
  }

  // ---------------------------------------------------------------------------
  //  Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a unified outgoing message for channel plugins.
   */
  private buildChannelMessage(event: ISudoClawNotificationEvent): import('@/channels/types').IUnifiedOutgoingMessage {
    const prefix = this.urgencyEmoji(event.urgency);
    const label = this.urgencyLabel(event.urgency);

    return {
      type: 'text',
      text: `${prefix} **[SudoClaw ${label}]**\n${event.body}`,
    };
  }

  /**
   * Human-readable label for an urgency level.
   */
  private urgencyLabel(urgency: SudoClawUrgency): string {
    switch (urgency) {
      case 'info':
        return 'Info';
      case 'action_needed':
        return 'Action Needed';
      case 'completed':
        return 'Completed';
      default:
        return 'Notification';
    }
  }

  /**
   * Emoji prefix for an urgency level (used in channel messages).
   */
  private urgencyEmoji(urgency: SudoClawUrgency): string {
    switch (urgency) {
      case 'info':
        return 'ℹ️';
      case 'action_needed':
        return '⚠️';
      case 'completed':
        return '✅';
      default:
        return '🔔';
    }
  }

  /**
   * Shutdown the service, removing event listeners.
   */
  async shutdown(): Promise<void> {
    if (this.eventCleanup) {
      this.eventCleanup();
      this.eventCleanup = null;
    }
    this.initialized = false;
    mainLog(LOG_TAG, 'Shutdown complete');
  }
}

// ---------------------------------------------------------------------------
//  Singleton
// ---------------------------------------------------------------------------

let instance: SudoClawNotifyService | null = null;

/**
 * Get (or create) the singleton SudoClawNotifyService.
 */
export function getSudoClawNotifyService(): SudoClawNotifyService {
  if (!instance) {
    instance = new SudoClawNotifyService();
  }
  return instance;
}
