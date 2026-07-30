/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import brand from '@brand';
import type { ActionCategory, IChannelUser, IUnifiedIncomingMessage, IUnifiedOutgoingMessage, PluginType } from '../types';

/**
 * Action context passed to action handlers
 */
export interface IActionContext {
  // Platform information
  platform: PluginType;
  pluginId: string;

  // User information (from message)
  userId: string;
  chatId: string;
  displayName?: string;

  // Authorized assistant user (set if user is authorized)
  channelUser?: IChannelUser;

  // Session information
  sessionId?: string;
  conversationId?: string;

  // Original message
  originalMessage: IUnifiedIncomingMessage;
  originalMessageId?: string;

  // Helper functions
  sendMessage: (message: IUnifiedOutgoingMessage) => Promise<string>;
  editMessage: (messageId: string, message: IUnifiedOutgoingMessage) => Promise<void>;

  /**
   * Send typing indicator
   * @param chatId Chat ID
   * @param stop Whether to stop typing indicator
   */
  sendTyping?: (chatId: string, stop?: boolean) => Promise<void>;
}

/**
 * Action handler function type
 */
export type ActionHandler = (context: IActionContext, params?: Record<string, string>) => Promise<IActionResult>;

/**
 * Result of action execution
 */
export interface IActionResult {
  success: boolean;
  message?: IUnifiedOutgoingMessage;
  error?: string;
}

/**
 * Registered action with metadata
 */
export interface IRegisteredAction {
  name: string;
  category: ActionCategory;
  description: string;
  handler: ActionHandler;
}

/**
 * System action names
 */
export const SystemActionNames = {
  SESSION_NEW: 'session.new',
  SESSION_STATUS: 'session.status',
  HELP_SHOW: 'help.show',
  HELP_FEATURES: 'help.features',
  HELP_PAIRING: 'help.pairing',
  HELP_TIPS: 'help.tips',
  SETTINGS_SHOW: 'settings.show',
  AGENT_SHOW: 'agent.show',
  AGENT_SELECT: 'agent.select',
} as const;

/**
 * Chat action names
 */
export const ChatActionNames = {
  SEND: 'chat.send',
  REGENERATE: 'chat.regenerate',
  CONTINUE: 'chat.continue',
  COPY: 'action.copy',
  TOOL_CONFIRM: 'system.confirm', // Tool confirmation action
} as const;

/**
 * Platform action names (Telegram-specific)
 */
export const PlatformActionNames = {
  PAIRING_SHOW: 'pairing.show',
  PAIRING_REFRESH: 'pairing.refresh',
  PAIRING_CHECK: 'pairing.check',
  PAIRING_HELP: 'pairing.help',
} as const;

export function applyChannelBrand<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replaceAll('Sudowork', brand.displayName).replaceAll('SudoWork', brand.displayName) as T;
  }
  if (Array.isArray(value)) {
    return value.map(applyChannelBrand) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, applyChannelBrand(entry)])) as T;
  }
  return value;
}

/**
 * Helper function to create a text response
 */
export function createTextResponse(
  text: string,
  options?: {
    parseMode?: 'HTML' | 'MarkdownV2' | 'Markdown';
    replyMarkup?: unknown;
  }
): IUnifiedOutgoingMessage {
  return {
    type: 'text',
    text: applyChannelBrand(text),
    parseMode: options?.parseMode || 'HTML',
    replyMarkup: applyChannelBrand(options?.replyMarkup),
  };
}

/**
 * Helper function to create an error response
 */
export function createErrorResponse(error: string): IActionResult {
  const brandedError = applyChannelBrand(error);
  return {
    success: false,
    error: brandedError,
    message: {
      type: 'text',
      text: `❌ ${brandedError}`,
      parseMode: 'HTML',
    },
  };
}

/**
 * Helper function to create a success response
 */
export function createSuccessResponse(message?: IUnifiedOutgoingMessage): IActionResult {
  return {
    success: true,
    message: applyChannelBrand(message),
  };
}
