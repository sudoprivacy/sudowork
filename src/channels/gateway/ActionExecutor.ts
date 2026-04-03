/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import type { TMessage } from '@/common/chatLib';
import { uuid } from '@/common/utils';
import { getDatabase } from '@/process/database';
import { addMessage } from '@/process/message';
import { ProcessConfig } from '@/process/initStorage';
import { getDataPath } from '@/process/utils';
import { ConversationService } from '@/process/services/conversationService';
import { buildChatErrorResponse, chatActions } from '../actions/ChatActions';
import { handlePairingShow, platformActions } from '../actions/PlatformActions';
import { getChannelDefaultModel, systemActions } from '../actions/SystemActions';
import type { IActionContext, IRegisteredAction } from '../actions/types';
import { getChannelMessageService } from '../agent/ChannelMessageService';
import type { SessionManager } from '../core/SessionManager';
import type { PairingService } from '../pairing/PairingService';
import type { PluginMessageHandler } from '../plugins/BasePlugin';
import { resolveChannelConvType } from '../types';
import { createMainMenuCard, createErrorRecoveryCard, createToolConfirmationCard } from '../plugins/lark/LarkCards';
import { convertHtmlToLarkMarkdown } from '../plugins/lark/LarkAdapter';
import { createMainMenuCard as createDingTalkMainMenuCard, createErrorRecoveryCard as createDingTalkErrorRecoveryCard, createResponseActionsCard as createDingTalkResponseActionsCard, createToolConfirmationCard as createDingTalkToolConfirmationCard } from '../plugins/dingtalk/DingTalkCards';
import { convertHtmlToDingTalkMarkdown } from '../plugins/dingtalk/DingTalkAdapter';
import { createMainMenuKeyboard, createToolConfirmationKeyboard } from '../plugins/telegram/TelegramKeyboards';
import { escapeHtml } from '../plugins/telegram/TelegramAdapter';
import type { ChannelAgentType, IUnifiedIncomingMessage, IUnifiedOutgoingMessage, PluginType } from '../types';
import type { PluginManager } from './PluginManager';
import type { AcpBackend } from '@/types/acpTypes';

function getChannelWorkspacePath(platform: string): string {
  const dir = path.join(getDataPath(), 'channel-media', platform);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

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
  return escapeHtml(text);
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
 * - Handle AI chat processing through the configured agent
 * - Manage streaming responses
 * - Execute action handlers with proper context
 */
export class ActionExecutor {
  private pluginManager: PluginManager;
  private sessionManager: SessionManager;
  private pairingService: PairingService;

  // Action registry
  private actionRegistry: Map<string, IRegisteredAction> = new Map();

  // Busy guard: tracks conversations with an active AI generation in progress.
  // Prevents concurrent generations when Feishu retries messages (3s webhook timeout).
  private busyConversations: Set<string> = new Set();

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
      sendTyping: async (cId, stop) => plugin.sendTyping?.(cId, stop),
    };

    try {
      // Check if user is authorized
      const isAuthorized = this.pairingService.isUserAuthorized(user.id, platform);

      // Handle /start command - always show pairing (except for WeChat which auto-authorizes)
      if (content.type === 'command' && content.text === '/start' && platform !== 'wechat') {
        const result = await handlePairingShow(context);
        if (result.message) {
          await context.sendMessage(result.message);
        }
        return;
      }

      // If not authorized, handle based on platform
      if (!isAuthorized) {
        // WeChat: auto-authorize user without pairing flow
        if (platform === 'wechat') {
          const db = getDatabase();
          const now = Date.now();
          const newUserId = `wechat_${user.id}_${now}`;
          const createResult = db.createChannelUser({
            id: newUserId,
            platformUserId: user.id,
            platformType: 'wechat',
            displayName: user.displayName || user.id,
            authorizedAt: now,
          });
          if (!createResult.success) {
            console.error(`[ActionExecutor] Failed to create WeChat user: ${createResult.error}`);
            await context.sendMessage({
              type: 'text',
              text: '❌ Failed to authorize. Please try again.',
              parseMode: 'HTML',
            });
            return;
          }
          console.log(`[ActionExecutor] Auto-authorized WeChat user: ${user.id}`);
        } else {
          // Other platforms: show pairing flow
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

        // Read selected agent for this platform (defaults to claude)
        let savedAgent: unknown = undefined;
        try {
          savedAgent = await (platform === 'lark' ? ProcessConfig.get('assistant.lark.agent') : platform === 'dingtalk' ? ProcessConfig.get('assistant.dingtalk.agent') : platform === 'wechat' ? ProcessConfig.get('assistant.wechat.agent') : ProcessConfig.get('assistant.telegram.agent'));
        } catch {
          // ignore
        }
        const backend = (savedAgent && typeof savedAgent === 'object' && typeof (savedAgent as any).backend === 'string' ? (savedAgent as any).backend : 'openclaw-gateway') as string;
        const customAgentId = savedAgent && typeof savedAgent === 'object' ? ((savedAgent as any).customAgentId as string | undefined) : undefined;
        const agentName = savedAgent && typeof savedAgent === 'object' ? ((savedAgent as any).name as string | undefined) : undefined;

        // Always resolve a provider model (required by ICreateConversationParams typing; ignored by ACP)
        const model = await getChannelDefaultModel(platform);

        // Map backend to conversation type for lookup
        const { convType, convBackend } = resolveChannelConvType(backend);

        // Build human-readable conversation name (just the user's display name)
        // TODO: WeChat API doesn't provide user display names in messages — find a way to resolve human-readable names (e.g., via a contacts/profile API)
        const displayName = channelUser.displayName || user.displayName || chatId;
        const conversationName = displayName;

        // Lookup existing conversation by source + chatId + type + backend (per-chat isolation)
        const db2 = getDatabase();
        const latest = db2.findChannelConversation(source, chatId, convType, convBackend);
        const existing = latest.success ? latest.data : null;

        const result = existing
          ? { success: true as const, conversation: existing }
          : backend === 'openclaw-gateway'
            ? await ConversationService.createConversation({
                type: 'openclaw-gateway',
                model,
                name: conversationName,
                source,
                channelChatId: chatId,
                extra: { workspace: getChannelWorkspacePath(source) },
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
                  workspace: getChannelWorkspacePath(source),
                },
              });

        if (result.success && result.conversation) {
          const { convType: agentType } = resolveChannelConvType(backend);
          session = this.sessionManager.createSessionWithConversation(channelUser, result.conversation.id, agentType as ChannelAgentType, getChannelWorkspacePath(source), chatId);
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
    const conversationId = context.conversationId;

    // ── Busy guard ──────────────────────────────────────────────────────
    // If this conversation already has an active AI generation, return a
    // "still processing" message instead of starting a second one.
    // This prevents Feishu 3-second webhook retries from spawning parallel
    // generations that race on the SQLite database.
    if (conversationId && this.busyConversations.has(conversationId)) {
      console.log(`[ActionExecutor] Conversation ${conversationId} is busy, skipping duplicate request`);
      try {
        await context.sendMessage({
          type: 'text',
          text: '⏳ Still processing your previous message, please wait...',
          parseMode: 'HTML',
        });
      } catch {
        // Ignore send errors for busy response
      }
      return;
    }

    if (conversationId) {
      this.busyConversations.add(conversationId);
    }

    // Update session activity (scoped by chatId)
    if (context.channelUser) {
      this.sessionManager.updateSessionActivity(context.channelUser.id, context.chatId);
    }

    // ── Persist user message to database ────────────────────────────────
    // Save the user's question immediately so it appears in the desktop
    // session UI (position: 'right' = sender side).
    if (conversationId) {
      try {
        const userMessage: TMessage = {
          type: 'text',
          id: uuid(),
          conversation_id: conversationId,
          content: { content: text },
          position: 'right',
          status: 'finish',
        };
        addMessage(conversationId, userMessage);
      } catch (error) {
        console.error(`[ActionExecutor] Failed to persist user message:`, error);
        // Non-fatal – continue with AI generation even if persistence fails
      }
    }

    // Send "thinking" indicator (skip for platforms that don't support editing)
    const supportsEdit = context.platform !== 'wechat';
    let thinkingMsgId = '';
    if (supportsEdit) {
      thinkingMsgId = await context.sendMessage({
        type: 'text',
        text: '⏳ Thinking...',
        parseMode: 'HTML',
      });
    }

    // Start typing indicator
    void context.sendTyping?.(context.chatId);

    try {
      const sessionId = context.sessionId;
      const conversationId = context.conversationId;

      if (!sessionId || !conversationId) {
        throw new Error('Session not initialized');
      }

      const messageService = getChannelMessageService();

      // 节流控制：使用定时器机制确保最后一条消息能被发送
      // Throttle control: use timer mechanism to ensure last message is sent
      let lastUpdateTime = 0;
      const UPDATE_THROTTLE_MS = 500; // Update at most every 500ms
      let pendingUpdateTimer: ReturnType<typeof setTimeout> | null = null;
      let pendingMessage: IUnifiedOutgoingMessage | null = null;

      // 跟踪已发送的消息 ID，用于新插入消息的管理
      // Track sent message IDs for new inserted messages
      const sentMessageIds: string[] = thinkingMsgId ? [thinkingMsgId] : [];

      // 跟踪最后一条消息内容，用于流结束后添加操作按钮
      // Track last message content for adding action buttons after stream ends
      let lastMessageContent: IUnifiedOutgoingMessage | null = null;

      // 执行消息编辑的函数
      // Function to perform message edit
      const doEditMessage = async (msg: IUnifiedOutgoingMessage) => {
        if (!supportsEdit) return; // WeChat doesn't support edit

        lastUpdateTime = Date.now();
        const targetMsgId = sentMessageIds[sentMessageIds.length - 1] || thinkingMsgId;
        try {
          await context.editMessage(targetMsgId, msg);
        } catch {
          // Ignore edit errors (message not modified, etc.)
        }
      };

      // 发送消息
      // Send message
      await messageService.sendMessage(sessionId, conversationId, text, async (message: TMessage, isInsert: boolean) => {
        const now = Date.now();

        // 转换消息格式（根据平台）
        // Convert message format (based on platform)
        const outgoingMessage = convertTMessageToOutgoing(message, context.platform as PluginType, false);

        // Strip replyMarkup during streaming to prevent premature card finalization.
        // Tool confirmation cards set replyMarkup (e.g., for Confirming status),
        // but DingTalk interprets replyMarkup as "stream complete" and finishes the AI Card.
        // Channel conversations use yoloMode (auto-approve), so confirmation buttons are unnecessary.
        const streamOutgoing: IUnifiedOutgoingMessage = { ...outgoingMessage, replyMarkup: undefined };

        // 保存最后一条消息内容（不含 replyMarkup，最终消息会单独添加）
        // Save last message content (without replyMarkup, final message adds it separately)
        lastMessageContent = streamOutgoing;

        // IMPORTANT: Always treat first streaming message as update to thinking message
        // This prevents async race condition where first insert's sendMessage takes time
        // while subsequent messages arrive and get processed as updates
        // 重要：始终将第一个流式消息视为更新thinking消息
        // 这可以防止异步竞态条件：第一个insert的sendMessage耗时时，后续消息已到达并被当作update处理
        if (isInsert && sentMessageIds.length === 1 && thinkingMsgId && supportsEdit) {
          // First streaming message: update thinking message instead of inserting
          // 第一个流式消息：更新thinking消息而不是插入新消息
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
          // 新消息：发送新消息
          // New message: send new message
          if (supportsEdit) {
            try {
              const newMsgId = await context.sendMessage(streamOutgoing);
              sentMessageIds.push(newMsgId);
            } catch {
              // Ignore send errors
            }
          } else {
            // For non-edit platforms (WeChat), we accumulate text and send at isInsert or end.
            // But if it's a NEW block, we might want to send the PREVIOUS one if we accumulated it.
            // However, WeChat is better served by sending the full interaction result at the end
            // to avoid multiple messages for one response.
            // So we just track that we HAVE content.
            if (sentMessageIds.length === 0) {
              sentMessageIds.push('wechat_placeholder');
            }
          }
        } else {
          // 更新消息：使用定时器节流，确保最后一条消息能被发送
          // Update message: throttle with timer to ensure last message is sent
          if (supportsEdit) {
            pendingMessage = streamOutgoing;

            if (now - lastUpdateTime >= UPDATE_THROTTLE_MS) {
              // 距离上次发送超过节流时间，立即发送
              // Enough time has passed since last send, send immediately
              if (pendingUpdateTimer) {
                clearTimeout(pendingUpdateTimer);
                pendingUpdateTimer = null;
              }
              await doEditMessage(streamOutgoing);
            } else {
              // 在节流时间内，设置定时器延迟发送
              // Within throttle window, set timer to send later
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
        }
      });

      // 清除待处理的定时器，确保最后一条消息被处理
      // Clear pending timer and ensure last message is processed
      if (pendingUpdateTimer) {
        clearTimeout(pendingUpdateTimer);
        pendingUpdateTimer = null;
      }
      // 如果有待发送的消息，立即发送
      // If there's a pending message, send it immediately
      if (pendingMessage && supportsEdit) {
        try {
          await doEditMessage(pendingMessage);
        } catch {
          // Ignore final edit error
        }
        pendingMessage = null;
      }

      // 流结束后，更新最后一条消息添加操作按钮（保留原内容）
      // After stream ends, update last message with action buttons (keep original content)
      if (lastMessageContent) {
        const responseMarkup = getResponseActionsMarkup(context.platform as PluginType, lastMessageContent.text);
        const finalMessage: IUnifiedOutgoingMessage = { ...lastMessageContent, replyMarkup: responseMarkup };

        if (supportsEdit && sentMessageIds.length > 0) {
          const lastMsgId = sentMessageIds[sentMessageIds.length - 1];
          await context.editMessage(lastMsgId, finalMessage);
        } else {
          // For WeChat or if no message was sent yet, send the final content as a new message
          await context.sendMessage(finalMessage);
        }
      }
    } catch (error: any) {
      console.error(`[ActionExecutor] Chat processing failed:`, error);

      // Update message with error
      const errorResponse = buildChatErrorResponse(error.message);
      if (supportsEdit && thinkingMsgId) {
        await context.editMessage(thinkingMsgId, errorResponse);
      } else {
        await context.sendMessage(errorResponse);
      }
    } finally {
      // Release busy guard so the next message can be processed
      if (conversationId) {
        this.busyConversations.delete(conversationId);
      }
      // Stop typing indicator
      void context.sendTyping?.(context.chatId, true);
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
