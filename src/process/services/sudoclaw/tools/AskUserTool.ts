/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AskUserTool — Blocking question to the user
 *
 * The most complex SudoClaw tool.  When the model needs information
 * from the user it calls this tool, which:
 *
 *  1. Transitions the session state to `requires_action`.
 *  2. Fires an `action_needed` notification to all channels.
 *  3. Pauses the tick loop by returning a Promise that only resolves
 *     when the user responds via `SudoClawManager.handleUserResponse()`.
 *
 * The pending resolve callback is stored on the manager so the
 * manager's `handleUserResponse(text)` can call it later.
 *
 * Schema: { question: string, context?: string }
 * Returns (after user responds): { status: 'answered', response: string }
 */

import { mainLog } from '@process/utils/mainLogger';
import { channelEventBus } from '@/channels/agent/ChannelEventBus';
import { SUDOCLAW_NOTIFICATION_EVENT } from './NotifyTool';
import type { SudoClawTool, AskUserToolInput, AskUserToolResult, SudoClawNotificationPayload } from './types';

const TAG = 'AskUserTool';

/**
 * Create an AskUserTool instance.
 *
 * Pure factory — no side-effects until `execute` is called.
 */
export function createAskUserTool(): SudoClawTool<AskUserToolInput, AskUserToolResult> {
  return {
    name: 'sudoclaw_ask_user',
    description: 'Ask the user a question and wait for their response. ' + 'This blocks execution until the user replies. ' + 'Use when you need clarification, a decision, or additional information to proceed.',
    schema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the user.',
        },
        context: {
          type: 'string',
          description: 'Optional context to help the user understand why this question is being asked.',
        },
      },
      required: ['question'],
    },

    async execute(input, manager) {
      const { question, context } = input;

      mainLog(TAG, 'Asking user — transitioning to requires_action', {
        conversationId: manager.conversationId,
        questionPreview: question.slice(0, 120),
      });

      // 1. Transition session state
      manager.transitionState('requires_action');

      // 2. Emit action_needed notification so all channels can alert the user
      const notificationMessage = context ? `**Question:** ${question}\n\n_Context:_ ${context}` : `**Question:** ${question}`;

      const payload: SudoClawNotificationPayload = {
        conversationId: manager.conversationId,
        message: notificationMessage,
        urgency: 'action_needed',
        timestamp: new Date().toISOString(),
      };

      channelEventBus.emit(SUDOCLAW_NOTIFICATION_EVENT, payload);

      // 3. Block until the user responds
      //    We create a Promise and hand its `resolve` to the manager.
      //    When the user sends a response, the manager calls resolve(text).
      const response = await new Promise<string>((resolve) => {
        manager.setPendingResolve(resolve);
      });

      mainLog(TAG, 'User responded — resuming', {
        conversationId: manager.conversationId,
        responsePreview: response.slice(0, 120),
      });

      return {
        status: 'answered' as const,
        response,
      };
    },
  };
}
