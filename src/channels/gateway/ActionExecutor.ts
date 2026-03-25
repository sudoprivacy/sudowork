/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chatLib';
import { channel as channelBridge } from '@/common/ipcBridge';
import { getDatabase } from '@/process/database';
import { ProcessConfig } from '@/process/initStorage';
import { ConversationService } from '@/process/services/conversationService';
import { buildChatErrorResponse, chatActions } from '../actions/ChatActions';
import { handlePairingShow, platformActions } from '../actions/PlatformActions';
import { getChannelDefaultModel, systemActions } from '../actions/SystemActions';
import type { IActionContext, IRegisteredAction } from '../actions/types';
import { getChannelMessageService } from '../agent/ChannelMessageService';
import type { SessionManager } from '../core/SessionManager';
import type { PairingService } from '../pairing/PairingService';
import type { PluginMessageHandler } from '../plugins/BasePlugin';
import { getChannelConversationName, resolveChannelConvType } from '../types';
import { createMainMenuCard, createErrorRecoveryCard, createToolConfirmationCard } from '../plugins/lark/LarkCards';
import { convertHtmlToLarkMarkdown } from '../plugins/lark/LarkAdapter';
import { createMainMenuCard as createDingTalkMainMenuCard, createErrorRecoveryCard as createDingTalkErrorRecoveryCard, createResponseActionsCard as createDingTalkResponseActionsCard, createToolConfirmationCard as createDingTalkToolConfirmationCard } from '../plugins/dingtalk/DingTalkCards';
import { convertHtmlToDingTalkMarkdown } from '../plugins/dingtalk/DingTalkAdapter';
import { createMainMenuKeyboard, createToolConfirmationKeyboard } from '../plugins/telegram/TelegramKeyboards';
import { escapeHtml } from '../plugins/telegram/TelegramAdapter';
import type { ChannelAgentType, IUnifiedIncomingMessage, IUnifiedOutgoingMessage, PluginType } from '../types';
import type { PluginManager } from './PluginManager';
import type { AcpBackend } from '@/types/acpTypes';

// ==================== Platform-specific Helpers ====================

/**
 * Get main menu reply markup based on platform
 */
function getMainMenuMarkup(platform: PluginType) {
  if (platform === 'lark') {
    return createMainMenuCard();
  }
  if (platform === 'dingtalk') {
    return createDingTalkMainMenuCard();
  }
  return createMainMenuKeyboard();
}

/**
 * Get response actions markup based on platform
 */
function getResponseActionsMarkup(platform: PluginType, text?: string) {
  if (platform === 'dingtalk') {
    return createDingTalkResponseActionsCard(text || '');
  }
  // Telegram and Lark: no response action buttons
  return undefined;
}

/**
 * Get tool confirmation markup based on platform
 */
function getToolConfirmationMarkup(platform: PluginType, callId: string, options: Array<{ label: string; value: string }>, title?: string, description?: string) {
  if (platform === 'lark') {
    return createToolConfirmationCard(callId, title || 'Confirmation', description || 'Please confirm', options);
  }
  if (platform === 'dingtalk') {
    return createDingTalkToolConfirmationCard(callId, title || 'Confirmation', description || 'Please confirm', options);
  }
  return createToolConfirmationKeyboard(callId, options);
}

/**
 * Get error recovery markup based on platform
 */
function getErrorRecoveryMarkup(platform: PluginType, errorMessage?: string) {
  if (platform === 'lark') {
    return createErrorRecoveryCard(errorMessage);
  }
  if (platform === 'dingtalk') {
    return createDingTalkErrorRecoveryCard(errorMessage);
  }
  return createMainMenuKeyboard(); // Telegram uses main menu for recovery
}

/**
 * Escape/format text for platform
 */
function formatTextForPlatform(text: string, platform: PluginType): string {
  if (platform === 'lark') {
    return convertHtmlToLarkMarkdown(text);
  }
  if (platform === 'dingtalk') {
    return convertHtmlToDingTalkMarkdown(text);
  }
  if (platform === 'wechat') {
    // WeChat: plain text only, strip all markup
    return text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(b|strong|i|em|u|s|code|pre|a|p|div|span|blockquote|h[1-6])[^>]*>/gi, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return escapeHtml(text);
}

/**
 * Check if a platform requires block-streaming (no message editing support).
 * For these platforms, we buffer the full response and send once instead of
 * streaming edits.
 */
function isBlockStreamingPlatform(platform: PluginType): boolean {
  return platform === 'wechat';
}

/**
 * 获取确认选项
 * Get confirmation options based on type
 */
function getConfirmationOptions(type: string): Array<{ label: string; value: string }> {
  switch (type) {
    case 'edit':
      return [
        { label: '✅ Allow Once', value: 'proceed_once' },
        { label: '✅ Always Allow', value: 'proceed_always' },
        { label: '❌ Cancel', value: 'cancel' },
      ];
    case 'exec':
      return [
        { label: '✅ Allow Execution', value: 'proceed_once' },
        { label: '✅ Always Allow', value: 'proceed_always' },
        { label: '❌ Cancel', value: 'cancel' },
      ];
    case 'mcp':
      return [
        { label: '✅ Allow Once', value: 'proceed_once' },
        { label: '✅ Always Allow Tool', value: 'proceed_always_tool' },
        { label: '✅ Always Allow Server', value: 'proceed_always_server' },
        { label: '❌ Cancel', value: 'cancel' },
      ];
    default:
      return [
        { label: '✅ Confirm', value: 'proceed_once' },
        { label: '❌ Cancel', value: 'cancel' },
      ];
  }
}

/**
 * 获取确认提示文本
 * Get confirmation prompt text
 * 注意：所有用户输入的内容都需要转义 HTML 特殊字符
 * Note: All user input content needs HTML special characters escaped
 */
function getConfirmationPrompt(details: { type: string; title?: string; [key: string]: any }): string {
  if (!details) return 'Please confirm the operation';

  switch (details.type) {
    case 'edit':
      return `📝 <b>Edit File Confirmation</b>\nFile: <code>${escapeHtml(details.fileName || 'Unknown file')}</code>\n\nAllow editing this file?`;
    case 'exec':
      return `⚡ <b>Execute Command Confirmation</b>\nCommand: <code>${escapeHtml(details.command || 'Unknown command')}</code>\n\nAllow executing this command?`;
    case 'mcp':
      return `🔧 <b>MCP Tool Confirmation</b>\nTool: <code>${escapeHtml(details.toolDisplayName || details.toolName || 'Unknown tool')}</code>\nServer: <code>${escapeHtml(details.serverName || 'Unknown server')}</code>\n\nAllow calling this tool?`;
    case 'info':
      return `ℹ️ <b>Information Confirmation</b>\n${escapeHtml(details.prompt || '')}\n\nContinue?`;
    default:
      return 'Please confirm the operation';
  }
}

/**
 * 将 TMessage 转换为 IUnifiedOutgoingMessage
 * Convert TMessage to IUnifiedOutgoingMessage for platform
 */
function convertTMessageToOutgoing(message: TMessage, platform: PluginType, isComplete = false): IUnifiedOutgoingMessage {
  switch (message.type) {
    case 'text': {
      // 根据平台格式化文本
      // Format text based on platform
      const rawText = formatTextForPlatform(message.content.content || '', platform);
      const text = rawText.trim() ? rawText : '...';
      return {
        type: 'text',
        text,
        parseMode: 'HTML',
        replyMarkup: isComplete ? getResponseActionsMarkup(platform, text) : undefined,
      };
    }

    case 'tips': {
      const icon = message.content.type === 'error' ? '❌' : message.content.type === 'success' ? '✅' : '⚠️';
      const content = formatTextForPlatform(message.content.content || '', platform);
      return {
        type: 'text',
        text: `${icon} ${content}`,
        parseMode: 'HTML',
      };
    }

    case 'tool_group': {
      // 显示工具调用状态
      // Show tool call status
      const toolLines = message.content.map((tool) => {
        const statusIcon = tool.status === 'Success' ? '✅' : tool.status === 'Error' ? '❌' : tool.status === 'Executing' ? '⏳' : tool.status === 'Confirming' ? '❓' : '📋';
        const desc = formatTextForPlatform(tool.description || tool.name || '', platform);
        return `${statusIcon} ${desc}`;
      });

      // 检查是否有需要确认的工具
      // Check if there are tools that need confirmation
      const confirmingTool = message.content.find((tool) => tool.status === 'Confirming' && tool.confirmationDetails);
      if (confirmingTool && confirmingTool.confirmationDetails) {
        // 根据确认类型生成选项
        // Generate options based on confirmation type
        const options = getConfirmationOptions(confirmingTool.confirmationDetails.type);
        const confirmText = toolLines.join('\n') + '\n\n' + getConfirmationPrompt(confirmingTool.confirmationDetails);

        return {
          type: 'text',
          text: confirmText,
          parseMode: 'HTML',
          replyMarkup: getToolConfirmationMarkup(platform, confirmingTool.callId, options, 'Tool Confirmation', confirmText),
        };
      }

      return {
        type: 'text',
        text: toolLines.join('\n') || '🔧 Executing tools...',
        parseMode: 'HTML',
      };
    }

    case 'tool_call': {
      const statusIcon = message.content.status === 'success' ? '✅' : message.content.status === 'error' ? '❌' : '⏳';
      const name = formatTextForPlatform(message.content.name || '', platform);
      return {
        type: 'text',
        text: `${statusIcon} ${name}`,
        parseMode: 'HTML',
      };
    }

    case 'acp_permission':
    case 'codex_permission': {
      // Channels (Telegram/Lark) use automatic approval via yoloMode.
      // Show a subtle indicator instead of an error message.
      return {
        type: 'text',
        text: `⏳ ${formatTextForPlatform('Applying automatic approval for permission request...', platform)}`,
        parseMode: 'HTML',
      };
    }

    default:
      // 其他类型暂不支持，显示通用消息
      // Other types not supported yet, show generic message
      return {
        type: 'text',
        text: '⏳ Processing...',
        parseMode: 'HTML',
      };
  }
}

/**
 * ActionExecutor - Routes and executes actions from incoming messages
 *
 * Responsibilities:
 * - Route actions to appropriate handlers (platform/system/chat)
 * - Handle AI chat processing through Gemini
 * - Manage streaming responses
 * - Execute action handlers with proper context
 */
export class ActionExecutor {
  private pluginManager: PluginManager;
  private sessionManager: SessionManager;
  private pairingService: PairingService;

  // Action registry
  private actionRegistry: Map<string, IRegisteredAction> = new Map();

  constructor(pluginManager: PluginManager, sessionManager: SessionManager, pairingService: PairingService) {
    this.pluginManager = pluginManager;
    this.sessionManager = sessionManager;
    this.pairingService = pairingService;

    // Register all actions
    this.registerActions();
  }

  /**
   * Get the message handler for plugins
   */
  getMessageHandler(): PluginMessageHandler {
    return this.handleIncomingMessage.bind(this);
  }

  /**
   * Handle incoming message from plugin
   */
  private async handleIncomingMessage(message: IUnifiedIncomingMessage): Promise<void> {
    const { platform, chatId, user, content, action } = message;

    // Get plugin for sending responses
    const plugin = this.getPluginForMessage(message);
    if (!plugin) {
      console.error(`[ActionExecutor] No plugin found for platform: ${platform}`);
      return;
    }

    // Build action context
    const context: IActionContext = {
      platform,
      pluginId: `${platform}_default`, // TODO: Get actual plugin ID
      userId: user.id,
      chatId,
      displayName: user.displayName,
      originalMessage: message,
      originalMessageId: message.id,
      sendMessage: async (msg) => plugin.sendMessage(chatId, msg),
      editMessage: async (msgId, msg) => plugin.editMessage(chatId, msgId, msg),
    };

    try {
      // Check if user is authorized
      const isAuthorized = this.pairingService.isUserAuthorized(user.id, platform);

      // Handle /start command - always show pairing
      if (content.type === 'command' && content.text === '/start') {
        const result = await handlePairingShow(context);
        if (result.message) {
          await context.sendMessage(result.message);
        }
        return;
      }

      // If not authorized, auto-authorize for WeChat (personal channel, already authenticated via QR login)
      // For other platforms, show pairing flow
      if (!isAuthorized) {
        if (platform === 'wechat') {
          // Auto-authorize WeChat users — QR login already authenticates the bot owner
          const db = getDatabase();
          const newUser = {
            id: `wechat_${user.id}_${Date.now()}`,
            platformUserId: user.id,
            platformType: platform as PluginType,
            displayName: user.displayName || user.id,
            authorizedAt: Date.now(),
          };
          const createResult = db.createChannelUser(newUser);
          if (!createResult.success) {
            console.error(`[ActionExecutor] Failed to auto-authorize WeChat user ${user.id}:`, createResult.error);
            await context.sendMessage({ type: 'text', text: 'Authorization failed. Please try again.' });
            return;
          }
          console.log(`[ActionExecutor] Auto-authorized WeChat user: ${user.id}`);
          // Continue to process the message (don't return)
        } else {
          const result = await handlePairingShow(context);
          if (result.message) {
            await context.sendMessage(result.message);
          }
          return;
        }
      }

      // User is authorized - look up the assistant user
      const db = getDatabase();
      const userResult = db.getChannelUserByPlatform(user.id, platform);
      const channelUser = userResult.data;

      if (!channelUser) {
        console.error(`[ActionExecutor] Authorized user not found in database: ${user.id}`);
        await context.sendMessage({
          type: 'text',
          text: '❌ User data error. Please re-pair your account.',
          parseMode: 'HTML',
        });
        return;
      }

      // Set the assistant user in context
      context.channelUser = channelUser;

      // Get or create session (scoped by chatId for per-chat isolation)
      let session = this.sessionManager.getSession(channelUser.id, chatId);
      if (!session || !session.conversationId) {
        const source = platform === 'lark' ? 'lark' : platform === 'dingtalk' ? 'dingtalk' : platform === 'wechat' ? 'wechat' : 'telegram';

        // Read selected agent for this platform (defaults to Gemini)
        let savedAgent: unknown = undefined;
        try {
          savedAgent = await (platform === 'lark' ? ProcessConfig.get('assistant.lark.agent') : platform === 'dingtalk' ? ProcessConfig.get('assistant.dingtalk.agent') : platform === 'wechat' ? ProcessConfig.get('assistant.wechat.agent') : ProcessConfig.get('assistant.telegram.agent'));
        } catch {
          // ignore
        }
        const backend = (savedAgent && typeof savedAgent === 'object' && typeof (savedAgent as any).backend === 'string' ? (savedAgent as any).backend : 'gemini') as string;
        const customAgentId = savedAgent && typeof savedAgent === 'object' ? ((savedAgent as any).customAgentId as string | undefined) : undefined;
        const agentName = savedAgent && typeof savedAgent === 'object' ? ((savedAgent as any).name as string | undefined) : undefined;

        // Always resolve a provider model (required by ICreateConversationParams typing; ignored by ACP/Codex)
        const model = await getChannelDefaultModel(platform);

        // Map backend to conversation type for lookup
        const { convType, convBackend } = resolveChannelConvType(backend);
        const conversationName = getChannelConversationName(platform, convType, convBackend, chatId);

        // Lookup existing conversation by source + chatId + type + backend (per-chat isolation)
        const db2 = getDatabase();
        const latest = db2.findChannelConversation(source, chatId, convType, convBackend);
        const existing = latest.success ? latest.data : null;

        const result = existing
          ? { success: true as const, conversation: existing }
          : backend === 'codex'
            ? await ConversationService.createConversation({
                type: 'codex',
                model,
                name: conversationName,
                source,
                channelChatId: chatId,
                extra: {},
              })
            : backend === 'gemini'
              ? await ConversationService.createGeminiConversation({
                  model,
                  name: conversationName,
                  source,
                  channelChatId: chatId,
                })
              : backend === 'openclaw-gateway'
                ? await ConversationService.createConversation({
                    type: 'openclaw-gateway',
                    model,
                    name: conversationName,
                    source,
                    channelChatId: chatId,
                    extra: {},
                  })
                : await ConversationService.createConversation({
                    type: 'acp',
                    model,
                    name: conversationName,
                    source,
                    channelChatId: chatId,
                    extra: {
                      backend: backend as AcpBackend,
                      customAgentId,
                      agentName,
                    },
                  });

        if (result.success && result.conversation) {
          const { convType: agentType } = resolveChannelConvType(backend);
          session = this.sessionManager.createSessionWithConversation(channelUser, result.conversation.id, agentType as ChannelAgentType, undefined, chatId);
          // Notify renderer to refresh conversation list
          if (!existing) {
            channelBridge.conversationCreated.emit({ conversationId: result.conversation.id, source });
          }
        } else {
          console.error(`[ActionExecutor] Failed to create conversation: ${result.error}`);
          await context.sendMessage({
            type: 'text',
            text: `❌ Failed to create session: ${result.error || 'Unknown error'}`,
            parseMode: 'HTML',
          });
          return;
        }
      }
      context.sessionId = session.id;
      context.conversationId = session.conversationId;

      // Route based on action or content
      if (action) {
        // Explicit action from button press
        await this.executeAction(context, action.name, action.params);
      } else if (content.type === 'action') {
        // Action encoded in content
        await this.executeAction(context, content.text, {});
      } else if (content.type === 'text' && content.text) {
        // Regular text message - send to AI
        await this.handleChatMessage(context, content.text);
      } else {
        // Unsupported content type
        await context.sendMessage({
          type: 'text',
          text: 'This message type is not supported. Please send a text message.',
          parseMode: 'HTML',
          replyMarkup: getMainMenuMarkup(platform as PluginType),
        });
      }
    } catch (error: any) {
      console.error(`[ActionExecutor] Error handling message:`, error);
      await context.sendMessage({
        type: 'text',
        text: `❌ Error processing message: ${error.message}`,
        parseMode: 'HTML',
        replyMarkup: getErrorRecoveryMarkup(platform as PluginType, error.message),
      });
    }
  }

  /**
   * Execute a registered action
   */
  private async executeAction(context: IActionContext, actionName: string, params?: Record<string, string>): Promise<void> {
    const action = this.actionRegistry.get(actionName);

    if (!action) {
      console.warn(`[ActionExecutor] Unknown action: ${actionName}`);
      await context.sendMessage({
        type: 'text',
        text: `Unknown action: ${actionName}`,
        parseMode: 'HTML',
      });
      return;
    }

    try {
      const result = await action.handler(context, params);

      if (result.message) {
        await context.sendMessage(result.message);
      }
    } catch (error: any) {
      console.error(`[ActionExecutor] Action ${actionName} failed:`, error);
      await context.sendMessage({
        type: 'text',
        text: `❌ Action failed: ${error.message}`,
        parseMode: 'HTML',
      });
    }
  }

  /**
   * Handle chat message - send to AI and stream response
   */
  private async handleChatMessage(context: IActionContext, text: string): Promise<void> {
    // Update session activity (scoped by chatId)
    if (context.channelUser) {
      this.sessionManager.updateSessionActivity(context.channelUser.id, context.chatId);
    }

    const blockStreaming = isBlockStreamingPlatform(context.platform as PluginType);

    // For block-streaming platforms (WeChat): send typing indicator instead of "Thinking..."
    // For normal platforms: send editable "Thinking..." message
    let thinkingMsgId = '';
    if (blockStreaming) {
      // Send typing indicator (best-effort) via plugin
      const plugin = this.getPluginForMessage(context.originalMessage);
      if (plugin && 'sendTyping' in plugin && typeof (plugin as any).sendTyping === 'function') {
        const userId = context.chatId.startsWith('user:') ? context.chatId.slice(5) : context.chatId;
        void (plugin as any).sendTyping(userId);
      }
    } else {
      thinkingMsgId = await context.sendMessage({
        type: 'text',
        text: '⏳ Thinking...',
        parseMode: 'HTML',
      });
    }

    try {
      const sessionId = context.sessionId;
      const conversationId = context.conversationId;

      if (!sessionId || !conversationId) {
        throw new Error('Session not initialized');
      }

      const messageService = getChannelMessageService();

      // Track last message content for adding action buttons after stream ends
      let lastMessageContent: IUnifiedOutgoingMessage | null = null;

      if (blockStreaming) {
        // ==================== Block-Streaming Mode (WeChat) ====================
        // Buffer all streaming chunks and send the full response as a single message
        // when the stream completes. No intermediate edits.

        await messageService.sendMessage(sessionId, conversationId, text, async (message: TMessage, _isInsert: boolean) => {
          const outgoingMessage = convertTMessageToOutgoing(message, context.platform as PluginType, false);
          const streamOutgoing: IUnifiedOutgoingMessage = { ...outgoingMessage, replyMarkup: undefined };
          // Just buffer — don't send anything during streaming
          lastMessageContent = streamOutgoing;
        });

        // Stream complete: send full response as a single new message
        if (lastMessageContent) {
          try {
            await context.sendMessage(lastMessageContent);
          } catch (sendError) {
            console.error(`[ActionExecutor] Failed to send block-streamed response:`, sendError);
          }
        }
      } else {
        // ==================== Normal Streaming Mode (Telegram/Lark/DingTalk) ====================
        // Send "Thinking..." then edit with streaming chunks

        // Throttle control: use timer mechanism to ensure last message is sent
        let lastUpdateTime = 0;
        const UPDATE_THROTTLE_MS = 500;
        let pendingUpdateTimer: ReturnType<typeof setTimeout> | null = null;
        let pendingMessage: IUnifiedOutgoingMessage | null = null;

        // Track sent message IDs for new inserted messages
        const sentMessageIds: string[] = [thinkingMsgId];

        // Function to perform message edit
        const doEditMessage = async (msg: IUnifiedOutgoingMessage) => {
          lastUpdateTime = Date.now();
          const targetMsgId = sentMessageIds[sentMessageIds.length - 1] || thinkingMsgId;
          try {
            await context.editMessage(targetMsgId, msg);
          } catch {
            // Ignore edit errors (message not modified, etc.)
          }
        };

        // Send message
        await messageService.sendMessage(sessionId, conversationId, text, async (message: TMessage, isInsert: boolean) => {
          const now = Date.now();

          // Convert message format (based on platform)
          const outgoingMessage = convertTMessageToOutgoing(message, context.platform as PluginType, false);

          // Strip replyMarkup during streaming to prevent premature card finalization.
          const streamOutgoing: IUnifiedOutgoingMessage = { ...outgoingMessage, replyMarkup: undefined };

          // Save last message content
          lastMessageContent = streamOutgoing;

          // IMPORTANT: Always treat first streaming message as update to thinking message
          if (isInsert && sentMessageIds.length === 1) {
            pendingMessage = streamOutgoing;

            if (now - lastUpdateTime >= UPDATE_THROTTLE_MS) {
              if (pendingUpdateTimer) {
                clearTimeout(pendingUpdateTimer);
                pendingUpdateTimer = null;
              }
              await doEditMessage(streamOutgoing);
            } else {
              if (pendingUpdateTimer) {
                clearTimeout(pendingUpdateTimer);
              }
              const delay = UPDATE_THROTTLE_MS - (now - lastUpdateTime);
              pendingUpdateTimer = setTimeout(() => {
                if (pendingMessage) {
                  void doEditMessage(pendingMessage);
                  pendingMessage = null;
                }
                pendingUpdateTimer = null;
              }, delay);
            }
          } else if (isInsert) {
            // New message: send new message
            try {
              const newMsgId = await context.sendMessage(streamOutgoing);
              sentMessageIds.push(newMsgId);
            } catch {
              // Ignore send errors
            }
          } else {
            // Update message: throttle with timer
            pendingMessage = streamOutgoing;

            if (now - lastUpdateTime >= UPDATE_THROTTLE_MS) {
              if (pendingUpdateTimer) {
                clearTimeout(pendingUpdateTimer);
                pendingUpdateTimer = null;
              }
              await doEditMessage(streamOutgoing);
            } else {
              if (pendingUpdateTimer) {
                clearTimeout(pendingUpdateTimer);
              }
              const delay = UPDATE_THROTTLE_MS - (now - lastUpdateTime);
              pendingUpdateTimer = setTimeout(() => {
                if (pendingMessage) {
                  void doEditMessage(pendingMessage);
                  pendingMessage = null;
                }
                pendingUpdateTimer = null;
              }, delay);
            }
          }
        });

        // Clear pending timer and ensure last message is processed
        if (pendingUpdateTimer) {
          clearTimeout(pendingUpdateTimer);
          pendingUpdateTimer = null;
        }
        if (pendingMessage) {
          try {
            await doEditMessage(pendingMessage);
          } catch {
            // Ignore final edit error
          }
          pendingMessage = null;
        }

        // After stream ends, update last message with action buttons
        const lastMsgId = sentMessageIds[sentMessageIds.length - 1] || thinkingMsgId;
        try {
          const responseMarkup = getResponseActionsMarkup(context.platform as PluginType, lastMessageContent?.text);
          const finalMessage: IUnifiedOutgoingMessage = lastMessageContent ? { ...lastMessageContent, replyMarkup: responseMarkup } : { type: 'text', text: '✅ Done', parseMode: 'HTML', replyMarkup: responseMarkup };
          await context.editMessage(lastMsgId, finalMessage);
        } catch {
          // Ignore final edit error
        }
      }
    } catch (error: any) {
      console.error(`[ActionExecutor] Chat processing failed:`, error);

      if (blockStreaming) {
        // For block-streaming: send error as new message
        const errorResponse = buildChatErrorResponse(error.message);
        await context.sendMessage({
          type: 'text',
          text: errorResponse.text,
          parseMode: errorResponse.parseMode,
          replyMarkup: errorResponse.replyMarkup,
        });
      } else {
        // For normal platforms: edit the thinking message with error
        const errorResponse = buildChatErrorResponse(error.message);
        await context.editMessage(thinkingMsgId, {
          type: 'text',
          text: errorResponse.text,
          parseMode: errorResponse.parseMode,
          replyMarkup: errorResponse.replyMarkup,
        });
      }
    }
  }

  /**
   * Get plugin instance for a message
   */
  private getPluginForMessage(message: IUnifiedIncomingMessage) {
    // For now, get the first plugin of the matching type
    const plugins = this.pluginManager.getAllPlugins();
    return plugins.find((p) => p.type === message.platform);
  }

  /**
   * Register all actions
   */
  private registerActions(): void {
    // Register system actions
    for (const action of systemActions) {
      this.actionRegistry.set(action.name, action);
    }

    // Register chat actions
    for (const action of chatActions) {
      this.actionRegistry.set(action.name, action);
    }

    // Register platform actions
    for (const action of platformActions) {
      this.actionRegistry.set(action.name, action);
    }
  }
}
