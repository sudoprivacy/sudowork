/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * NotifyTool — Non-blocking proactive notification
 *
 * The model calls this tool to send a notification to the user without
 * waiting for a reply.  Notifications are emitted through the
 * ChannelEventBus so every connected channel (IDE panel, WebUI, tray
 * popup, etc.) can pick them up.
 *
 * Schema: { message: string (markdown), urgency: 'info' | 'action_needed' | 'completed' }
 * Returns immediately: { status: 'notified', timestamp: ISO }
 */

import { mainLog } from '@process/utils/mainLogger';
import { channelEventBus } from '@/channels/agent/ChannelEventBus';
import type { SudoClawTool, NotifyToolInput, NotifyToolResult, SudoClawNotificationPayload } from './types';

const TAG = 'NotifyTool';

/** Event name used on the ChannelEventBus for SudoClaw notifications. */
export const SUDOCLAW_NOTIFICATION_EVENT = 'sudoclaw-notification';

/**
 * Create a NotifyTool instance.
 *
 * Pure factory — no side-effects until `execute` is called.
 */
export function createNotifyTool(): SudoClawTool<NotifyToolInput, NotifyToolResult> {
  return {
    name: 'sudoclaw_notify',
    description: 'Send a non-blocking notification to the user. ' + 'Use this for proactive updates: "task done", "found something", "FYI". ' + 'The message supports markdown. Does NOT wait for a reply — use sudoclaw_ask_user if you need an answer.',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Markdown-formatted notification message.',
        },
        urgency: {
          type: 'string',
          enum: ['info', 'action_needed', 'completed'],
          description: 'Urgency level. "info" for FYI, "action_needed" if the user should act soon, "completed" when a task finishes.',
        },
      },
      required: ['message', 'urgency'],
    },

    async execute(input, manager) {
      const { message, urgency } = input;
      const timestamp = new Date().toISOString();

      mainLog(TAG, `Emitting notification (${urgency})`, {
        conversationId: manager.conversationId,
        messagePreview: message.slice(0, 120),
      });

      const payload: SudoClawNotificationPayload = {
        conversationId: manager.conversationId,
        message,
        urgency,
        timestamp,
      };

      // Fire-and-forget — does not block the model
      channelEventBus.emit(SUDOCLAW_NOTIFICATION_EVENT, payload);

      return {
        status: 'notified' as const,
        timestamp,
      };
    },
  };
}
