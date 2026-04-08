/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRegisteredAction, ActionHandler } from './types';
import { createSuccessResponse, createErrorResponse } from './types';
import { getSudoClawBridge } from '../agent/SudoClawBridge';
import { getSudoClawManager } from '../agent/sudoclaw/SudoClawManager';
import type { SudoClawResponseType } from '../agent/sudoclaw/types';

/**
 * SudoClawActions — Handlers for SudoClaw AskUser response actions.
 *
 * These actions handle user responses to AskUser prompts from any channel.
 * All responses are routed through SudoClawBridge → SudoClawManager.handleUserResponse().
 */

/**
 * Action names for SudoClaw responses
 */
export const SudoClawActionNames = {
  RESPOND: 'sudoclaw.respond',
  STATUS: 'sudoclaw.status',
} as const;

/**
 * Handle sudoclaw.respond — User response to an AskUser request.
 *
 * Expected params:
 * - requestId: The original request ID
 * - responseType: 'approve' | 'deny' | 'reply'
 * - message: (optional) Text reply for 'reply' type
 */
export const handleSudoClawRespond: ActionHandler = async (context, params) => {
  const requestId = params?.requestId;
  const responseType = params?.responseType as SudoClawResponseType | undefined;
  const message = params?.message;
  const conversationId = context.conversationId;

  if (!requestId || !responseType) {
    console.error(`[SudoClawActions] Missing params - requestId: ${requestId}, responseType: ${responseType}`);
    return createErrorResponse('Missing response parameters');
  }

  if (!conversationId) {
    return createErrorResponse('No active conversation');
  }

  // Validate the pending request exists
  const pendingRequest = getSudoClawManager().getPendingRequest(requestId);
  if (!pendingRequest) {
    return createSuccessResponse({
      type: 'text',
      text: '⏰ This request has already been handled or has expired.',
      parseMode: 'HTML',
    });
  }

  try {
    const bridge = getSudoClawBridge();
    const success = bridge.routeResponse({
      requestId,
      conversationId,
      type: responseType,
      message,
      source: {
        platform: context.platform,
        userId: context.userId,
        displayName: context.displayName,
      },
      respondedAt: Date.now(),
    });

    if (!success) {
      return createSuccessResponse({
        type: 'text',
        text: '⏰ This request has already been handled or has expired.',
        parseMode: 'HTML',
      });
    }

    // Build response confirmation message
    const icon = responseType === 'approve' ? '✅' : responseType === 'deny' ? '❌' : '💬';
    const label = responseType === 'approve' ? 'Approved' : responseType === 'deny' ? 'Denied' : 'Reply sent';
    const confirmText = message
      ? `${icon} <b>${label}</b>\n\n💬 ${message}`
      : `${icon} <b>${label}</b>`;

    return createSuccessResponse({
      type: 'text',
      text: confirmText,
      parseMode: 'HTML',
    });
  } catch (error: any) {
    console.error('[SudoClawActions] Response routing failed:', error);
    return createErrorResponse(`Failed to process response: ${error.message}`);
  }
};

/**
 * Handle sudoclaw.status — Show pending SudoClaw requests.
 */
export const handleSudoClawStatus: ActionHandler = async (context) => {
  const conversationId = context.conversationId;
  if (!conversationId) {
    return createSuccessResponse({
      type: 'text',
      text: 'No active conversation.',
      parseMode: 'HTML',
    });
  }

  const manager = getSudoClawManager();
  const state = manager.getSessionState(conversationId);
  const pending = manager.getPendingRequests(conversationId);

  const lines: string[] = [
    `📊 <b>SudoClaw Status</b>`,
    ``,
    `State: <code>${state}</code>`,
    `Pending requests: <b>${pending.length}</b>`,
  ];

  if (pending.length > 0) {
    lines.push('');
    lines.push('<b>Pending:</b>');
    for (const req of pending) {
      const age = Math.floor((Date.now() - req.createdAt) / 1000);
      const question = req.question.length > 80 ? req.question.slice(0, 80) + '...' : req.question;
      lines.push(`• [${req.urgency}] ${question} (${age}s ago)`);
    }
  }

  return createSuccessResponse({
    type: 'text',
    text: lines.join('\n'),
    parseMode: 'HTML',
  });
};

/**
 * All SudoClaw actions
 */
export const sudoClawActions: IRegisteredAction[] = [
  {
    name: SudoClawActionNames.RESPOND,
    category: 'chat',
    description: 'Respond to a SudoClaw AskUser request',
    handler: handleSudoClawRespond,
  },
  {
    name: SudoClawActionNames.STATUS,
    category: 'system',
    description: 'Show SudoClaw pending request status',
    handler: handleSudoClawStatus,
  },
];
