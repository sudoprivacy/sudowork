/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import type { TMessage, AcpQuestionData } from '@/common/chatLib';
import { database as databaseBridge } from '@/common/ipcBridge';
import { parseNexusFilesMarker } from '@/common/nexusFiles';
import { stripGeneratedFilesMarker } from '@/common/generatedFiles';
import { getDatabase } from '@/process/database';
import { ProcessConfig } from '@/process/initStorage';
import { getDataPath } from '@/process/utils';
import { mainError } from '@/process/utils/mainLogger';
import { ConversationService } from '@/process/services/conversationService';
import { transcriptionService } from '@/process/services/transcription/TranscriptionService';
import type { AcpBackend } from '@/types/acpTypes';
import { acpDetector } from '@/agent/acp/AcpDetector';
import { buildChatErrorResponse, chatActions } from '../actions/ChatActions';
import { handlePairingShow, platformActions } from '../actions/PlatformActions';
import { getChannelDefaultModel, systemActions } from '../actions/SystemActions';
import { getConnectionAgent } from '../channelConnectionConfig';
import type { IActionContext, IRegisteredAction } from '../actions/types';
import { getChannelMessageService, type PendingAnswerResult } from '../agent/ChannelMessageService';
import type { SessionManager } from '../core/SessionManager';
import type { PairingService } from '../pairing/PairingService';
import type { PluginMessageHandler, BasePlugin } from '../plugins/BasePlugin';
import type { IChannelUser, ChannelAgentType, IUnifiedIncomingMessage, IUnifiedOutgoingMessage, PluginType } from '../types';
import { resolveChannelConvType, pluginScope, scopedChatId } from '../types';
import { createMainMenuCard, createErrorRecoveryCard, createToolConfirmationCard } from '../plugins/lark/LarkCards';
import { convertHtmlToLarkMarkdown } from '../plugins/lark/LarkAdapter';
import { createMainMenuCard as createDingTalkMainMenuCard, createErrorRecoveryCard as createDingTalkErrorRecoveryCard, createResponseActionsCard as createDingTalkResponseActionsCard, createToolConfirmationCard as createDingTalkToolConfirmationCard } from '../plugins/dingtalk/DingTalkCards';
import { convertHtmlToDingTalkMarkdown, buildDingTalkQuestionMarkdown } from '../plugins/dingtalk/DingTalkAdapter';
import { createMainMenuKeyboard, createToolConfirmationKeyboard } from '../plugins/telegram/TelegramKeyboards';
import { escapeHtml } from '../plugins/telegram/TelegramAdapter';
import { resolveMediaText } from './voiceTranscription';
import type { PluginManager } from './PluginManager';

function getChannelWorkspacePath(platform: string): string {
  const dir = path.join(getDataPath(), 'channel-media', platform);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Check if a content type is a media type (photo, document, voice, video, audio).
 */
function isMediaContentType(type: string): boolean {
  return type === 'photo' || type === 'document' || type === 'voice' || type === 'audio' || type === 'video';
}

/**
 * Validate a file path before sending - filter out invalid/truncated paths.
 * Agent streaming can output partial paths (e.g., "/Users/y", "/Users/yobach/.nexus/channel")
 * which are directories and cause EISDIR errors when WeComUploader tries to read them.
 */
function isValidFilePath(filePath: string): boolean {
  // Skip empty paths
  if (!filePath || filePath.trim().length === 0) return false;

  // Skip paths that end with "/" (directory indicators)
  if (filePath.endsWith('/')) return false;

  // Skip paths that don't have a file extension (likely directories or truncated)
  const ext = path.extname(filePath);
  if (!ext || ext.length < 2) return false;

  // Check if path exists and is a file (not a directory)
  try {
    if (!fs.existsSync(filePath)) return false;
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) return false;
    return true;
  } catch {
    return false;
  }
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
 * Lark 的 markdown card 不接受本地路径图片引用（`![](C:\...png)` 或 `![](/abs/path.png)`）：
 * 飞书会返回 230099 / 子错码 11310 "the card contains images but no imagekey is passed in"。
 * 对 Lark 平台的 text 仅去除本地路径形式的 markdown image，
 * 保留 http(s)/data/file 协议的远程图片（飞书 markdown card 能正常渲染网络图）。
 * 图片本身改由 file_send 走 image_key 上传通道发送，文字此时只承担"配文"职责。
 *
 * Lark only. Other platforms (dingtalk/wechat/telegram) returned as-is so this
 * helper is non-invasive — the existing DingTalk path strips elsewhere in
 * ChannelResponseRouter.
 */
function stripLarkUnusableImageMarkdown(text: string | undefined, platform: PluginType): string | undefined {
  if ((platform !== 'lark' && platform !== 'dingtalk') || !text) return text;
  return text
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, (match, imgPath: string) => {
      if (/^(https?:|data:|file:)/i.test(imgPath)) return match;
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
function convertTMessageToOutgoing(message: TMessage, platform: PluginType, isComplete = false): IUnifiedOutgoingMessage | null {
  switch (message.type) {
    case 'text': {
      // [[NEXUS_GENERATED_FILES]] is a renderer-only directive for GeneratedFileCard;
      // meaningless to IM users (file body already delivered via a separate file_send).
      if (!stripGeneratedFilesMarker(message.content.content || '').trim()) return null;

      // 根据平台格式化文本
      // Format text based on platform
      const rawText = formatTextForPlatform(message.content.content || '', platform);

      // Parse [[NEXUS_FILES]] marker to extract file paths for media attachments
      // This enables WeChat/Lark/etc to upload and send files to users
      const { cleanText, files } = parseNexusFilesMarker(rawText);
      const text = cleanText.trim();
      // Determine imageUrl and fileUrl from extracted files
      // First image file -> imageUrl, first non-image file -> fileUrl
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
      let imageUrl: string | undefined;
      let fileUrl: string | undefined;
      let fileName: string | undefined;

      for (const filePath of files) {
        const ext = path.extname(filePath).toLowerCase();
        if (imageExtensions.includes(ext) && !imageUrl) {
          imageUrl = filePath;
        } else if (!imageExtensions.includes(ext) && !fileUrl) {
          fileUrl = filePath;
          fileName = path.basename(filePath);
        }
      }

      return {
        type: 'text',
        text,
        parseMode: 'HTML',
        imageUrl,
        fileUrl,
        fileName,
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

    case 'agent_status':
    case 'acp_tool_call':
    case 'codex_tool_call':
    case 'plan':
    case 'available_commands':
      // Desktop-only UI state messages — skip for channel clients
      return null;

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

    case 'file_send': {
      const { filePath, fileName, fileType } = message.content;
      if (fileType === 'image') {
        return { type: 'image' as const, imageUrl: filePath };
      }
      return { type: 'file' as const, fileUrl: filePath, fileName };
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

  /**
   * Per-conversation mutex to serialize message processing.
   * Prevents concurrent AI generations on the same conversation (e.g., from Feishu retries).
   * Each entry holds a Promise that resolves when the current message finishes processing.
   */
  private conversationLocks: Map<string, Promise<void>> = new Map();

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
  private async handleIncomingMessage(message: IUnifiedIncomingMessage, sourcePlugin?: BasePlugin): Promise<void> {
    const { platform, chatId, user, content, action } = message;

    // Reply through the connection that RECEIVED the message. Falling back to "first
    // plugin of this type" would answer from the wrong bot once a type has more than one
    // connection configured.
    const plugin = sourcePlugin ?? this.getPluginForMessage(message);
    if (!plugin) {
      console.error(`[ActionExecutor] No plugin found for platform: ${platform}`);
      return;
    }

    const pluginId = plugin.pluginId;
    // Scope authorizations and sessions to this connection so two bots of one type never
    // share a conversation or an authorization.
    const scope = pluginScope(pluginId, platform);
    const sChatId = scopedChatId(pluginId, platform, chatId);

    // Build action context
    const context: IActionContext = {
      platform,
      pluginId,
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
      const isAuthorized = this.pairingService.isUserAuthorized(user.id, scope);
      console.log(`[ActionExecutor] processMessage: platform=${platform}, userId=${user.id}, chatId=${chatId}, isAuthorized=${isAuthorized}`);

      // Handle /start command
      // WeChat & WeCom: skip pairing, auto-authorize and continue
      // Other platforms: show pairing flow
      if (content.type === 'command' && content.text === '/start') {
        if (platform === 'wechat' || platform === 'wecom') {
          console.log(`[ActionExecutor] processMessage: /start for ${platform}, auto-authorizing user`);
          // Auto-authorize and continue to process message
        } else {
          console.log(`[ActionExecutor] processMessage: handling /start command, showing pairing`);
          const result = await handlePairingShow(context);
          if (result.message) {
            await context.sendMessage(result.message);
          }
          return;
        }
      }

      // If not authorized, handle based on platform
      if (!isAuthorized) {
        console.log(`[ActionExecutor] processMessage: user not authorized, platform=${platform}`);
        // WeChat & WeCom: auto-authorize user without pairing flow
        // Enterprise admin controls access via WeCom console "visible range" settings
        if (platform === 'wechat' || platform === 'wecom') {
          const db = getDatabase();
          const now = Date.now();
          const newUserId = `${scope}_${user.id}_${now}`;
          const channelUser: IChannelUser = {
            id: newUserId,
            platformUserId: user.id,
            platformType: platform,
            pluginScope: scope,
            displayName: user.displayName || user.id,
            authorizedAt: now,
          };
          const createResult = db.createChannelUser(channelUser);
          if (!createResult.success) {
            console.error(`[ActionExecutor] Failed to create ${platform} user: ${createResult.error}`);
            await context.sendMessage({
              type: 'text',
              text: '❌ Authorization failed. Please try again.',
              parseMode: 'HTML',
            });
            return;
          }
          console.log(`[ActionExecutor] Auto-authorized ${platform} user: ${user.id}`);
          // Set the channel user in context directly, no need to re-query
          context.channelUser = channelUser;
        } else {
          // Other platforms (dingtalk, lark, telegram): show pairing flow
          console.log(`[ActionExecutor] processMessage: showing pairing flow for platform=${platform}`);
          const result = await handlePairingShow(context);
          if (result.message) {
            await context.sendMessage(result.message);
          }
          return;
        }
      }

      // User is authorized - look up the assistant user if not already set
      if (!context.channelUser) {
        const db = getDatabase();
        const userResult = db.getChannelUserByPlatform(user.id, scope);
        const channelUser = userResult.data;

        if (!channelUser) {
          console.error(`[ActionExecutor] Authorized user not found in database: ${user.id}`);
          await context.sendMessage({
            type: 'text',
            text: '❌ User data error. Please try again.',
            parseMode: 'HTML',
          });
          return;
        }
        context.channelUser = channelUser;
      }

      const channelUser = context.channelUser;

      // Get or create session (scoped by chatId for per-chat isolation)
      let session = this.sessionManager.getSession(channelUser.id, sChatId);
      if (!session || !session.conversationId) {
        const source = platform === 'lark' ? 'lark' : platform === 'dingtalk' ? 'dingtalk' : platform === 'wechat' ? 'wechat' : platform === 'wecom' ? 'wecom' : 'telegram';

        // Agent for THIS connection, falling back to the type-wide setting.
        let savedAgent: unknown = undefined;
        try {
          savedAgent = await getConnectionAgent(pluginId, platform);
        } catch {
          // ignore
        }
        const backend = (savedAgent && typeof savedAgent === 'object' && typeof (savedAgent as any).backend === 'string' ? (savedAgent as any).backend : 'scode') as string;
        const customAgentId = savedAgent && typeof savedAgent === 'object' ? ((savedAgent as any).customAgentId as string | undefined) : undefined;
        const agentName = savedAgent && typeof savedAgent === 'object' ? ((savedAgent as any).name as string | undefined) : undefined;

        // Always resolve a provider model (required by ICreateConversationParams typing; ignored by ACP)
        const model = await getChannelDefaultModel(platform, pluginId);

        // Map backend to conversation type for lookup
        const { convType, convBackend } = resolveChannelConvType(backend);

        // Resolve cliPath from detected agents so AcpAgent can spawn the CLI correctly
        const detectedAgent = acpDetector.getDetectedAgents().find((a) => a.backend === backend);
        const cliPath = detectedAgent?.cliPath;

        // Build human-readable conversation name (just the user's display name)
        // TODO: WeChat API doesn't provide user display names in messages — find a way to resolve human-readable names (e.g., via a contacts/profile API)
        const displayName = channelUser.displayName || user.displayName || chatId;
        const conversationName = displayName;

        // Lookup existing conversation by source + chatId + type + backend (per-chat isolation)
        const db2 = getDatabase();
        const latest = db2.findChannelConversation(source, sChatId, convType, convBackend);
        const existing = latest.success ? latest.data : null;

        const result = existing
          ? { success: true as const, conversation: existing }
          : await ConversationService.createConversation({
              type: 'acp',
              model,
              name: conversationName,
              source,
              channelChatId: sChatId,
              extra: {
                backend: backend as AcpBackend,
                cliPath,
                customAgentId,
                agentName,
                workspace: getChannelWorkspacePath(source),
              },
            });

        if (result.success && result.conversation) {
          const { convType: agentType } = resolveChannelConvType(backend);
          session = this.sessionManager.createSessionWithConversation(channelUser, result.conversation.id, agentType as ChannelAgentType, getChannelWorkspacePath(source), sChatId);

          // 通知渲染进程刷新对话列表（仅新建对话时）
          if (!existing) {
            databaseBridge.conversationChanged.emit({
              conversationId: result.conversation.id,
              source,
              action: 'created',
            });
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
      } else if (isMediaContentType(content.type)) {
        // Media message (photo, document, voice, video) - extract file paths and send to AI.
        // Align with desktop SendBox: embed `[[NEXUS_FILES]]` so the renderer shows
        // images/files inline (FilePreview) instead of only `[photo message]`.
        // AcpAgent strips the marker before forwarding to the agent and turns the
        // paths into image content blocks via processAtFileReferences().
        let files = content.attachments?.map((a) => a.fileId).filter((id) => !!id) || [];

        // Voice transcription: the agent can't hear an audio file, so for an
        // enabled channel replace the opaque `[voice message]` placeholder with a
        // transcript via the shared TranscriptionService. resolveMediaText falls
        // back to the placeholder on ASR failure and is a no-op for every channel
        // not yet enabled (PoC: WeChat only).
        const { text: plainText, transcribed } = await resolveMediaText(content, platform as PluginType, (p, c) => transcriptionService.transcribe(p, c));

        // When we have a transcript, drop the raw voice file from the attachments:
        // the agent can't decode SILK/AMR, and attaching it next to the transcript
        // makes it ask for clarification instead of acting on the text.
        if (transcribed) {
          const voiceIds = new Set((content.attachments || []).filter((a) => a.type === 'voice').map((a) => a.fileId));
          files = files.filter((id) => !voiceIds.has(id));
        }

        await this.handleChatMessage(context, plainText, files);
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
   * Handle chat message - send to AI and stream response.
   *
   * Uses a per-conversation mutex to serialize processing:
   * 1. "⏳ Thinking..." is sent IMMEDIATELY so the user always sees acknowledgment.
   * 2. If a previous message is still being processed, we wait for it to finish
   *    before starting AI generation — prevents concurrent stream overwrites.
   */
  private async handleChatMessage(context: IActionContext, text: string, files?: string[]): Promise<void> {
    // Update session activity (scoped by chatId)
    if (context.channelUser) {
      this.sessionManager.updateSessionActivity(context.channelUser.id, context.chatId);
    }

    // 立即更新会话 updated_at 并通知前端刷新列表（不等待 AI 响应完成）
    // Immediately update conversation updated_at and notify frontend to refresh list
    if (context.conversationId) {
      const db = getDatabase();
      db.updateConversation(context.conversationId, {});
      databaseBridge.conversationChanged.emit({
        conversationId: context.conversationId,
        source: context.platform,
        action: 'updated',
      });
    }

    // Pending ACP question routing: if this conversation has a pending question
    // (scode awaiting a button-tap answer), route the user's text to answerQuestion
    // instead of sendMessage (which would treat the answer as a new turn). Placed
    // before thinking/lock so a tap reply never spins up a competing AI turn.
    const pendingConvId = context.conversationId || context.chatId;
    if (pendingConvId) {
      const pendingService = getChannelMessageService();
      if (pendingService.hasPendingQuestion(pendingConvId)) {
        let answerResult: PendingAnswerResult;
        try {
          answerResult = pendingService.submitAnswer(pendingConvId, text);
        } catch (err) {
          mainError('ActionExecutor', 'submitAnswer threw', err);
          await context.sendMessage({ type: 'text', text: '❌ 提交失败，请重试', parseMode: 'Markdown' });
          return;
        }
        if (answerResult.kind === 'item_done') {
          await context.sendMessage({
            type: 'text',
            text: `✅ 已选: ${answerResult.displayLabel}（${answerResult.currentIndex}/${answerResult.totalItems}）`,
            parseMode: 'Markdown',
          });
          // Dispatch the next item's card (sendMessage + immediate editMessage finalize
          // to stop the AI Card spinner; same pattern as the outbound acp_question branch).
          const next = pendingService.getPendingForNextRender(pendingConvId);
          if (next) {
            const { markdown } = buildDingTalkQuestionMarkdown(next.content, next.itemIndex);
            const cardMsgId = await context.sendMessage({ type: 'text', text: markdown, parseMode: 'Markdown' });
            await context.editMessage(cardMsgId, { type: 'text', text: markdown, parseMode: 'Markdown', replyMarkup: {} });
          }
          return;
        }
        if (answerResult.kind === 'all_done') {
          await context.sendMessage({ type: 'text', text: `✅ 已提交：${answerResult.displayLabel}`, parseMode: 'Markdown' });
          return;
        }
        if (answerResult.kind === 'multi_select_accumulate') {
          await context.sendMessage({
            type: 'text',
            text: `✅ 已选中：${answerResult.displayLabel}，继续选择或点【提交】`,
            parseMode: 'Markdown',
          });
          return;
        }
        if (answerResult.kind === 'stale') {
          await context.sendMessage({
            type: 'text',
            text: `⚠️ 第 ${answerResult.staleQuestionIndex + 1} 题已经回答过了，请回答当前的第 ${answerResult.currentIndex + 1} 题`,
            parseMode: 'Markdown',
          });
          return;
        }
        // answerResult.kind === 'no_match': fall through to normal chat flow below
      }
    }

    // Send "thinking" indicator IMMEDIATELY (before acquiring lock)
    // This ensures the user always sees acknowledgment, even if the conversation is busy.
    const supportsEdit = context.platform !== 'wechat';
    let thinkingMsgId = '';
    if (supportsEdit) {
      thinkingMsgId = await context.sendMessage({
        type: 'text',
        text: '⏳ Thinking...',
        parseMode: 'HTML',
      });
    }

    // Per-conversation mutex: wait for any previous message to finish processing.
    // This prevents concurrent AI generations that cause stream overwrites and hung promises.
    const conversationId = context.conversationId || context.chatId;

    // Read previous lock BEFORE creating new one (sync — no await between read and set).
    // This prevents TOCTOU race where multiple callers read the same previousLock.
    const previousLock = this.conversationLocks.get(conversationId);

    // Create and register new lock (sync — must happen before any await).
    // Subsequent callers will read THIS lock as their previousLock.
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.conversationLocks.set(conversationId, lockPromise);

    // Now await the previous lock (if any).
    if (previousLock) {
      try {
        await previousLock;
      } catch {
        // Ignore errors from previous message processing
      }
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

      // Track whether thinking message has been updated by first text message
      let thinkingUpdated = false;

      // 跟踪最后一条消息内容，用于流结束后添加操作按钮
      // Track last message content for adding action buttons after stream ends
      let lastMessageContent: IUnifiedOutgoingMessage | null = null;

      // 跟踪最后一条文本消息内容，用于文件消息后仍能正确 finalize AI Card
      // Track last text content to finalize AI Card even when last message is file/image
      let lastTextContent: IUnifiedOutgoingMessage | null = null;

      // 跟踪已发送的文件，避免重复发送
      // Track sent files to avoid duplicate sends
      const sentFiles: Set<string> = new Set();

      // 记录用户输入的文件，避免发回给用户
      // Track user input files to avoid sending back to user
      const userInputFiles: Set<string> = new Set(files || []);

      // 缓存待发送的文件，等到流结束后再发送（保证文本先输出，文件最后发送）
      // Buffer pending files to send after stream ends (ensure text outputs first, files last)
      const pendingFilesToSend: IUnifiedOutgoingMessage[] = [];

      // msg_id → cardId 精确路由表。composeMessage 对同段文本 insert/update 复用同一个 msg_id
      // (chatLib.ts:730)，用它把流式 update 精确路由到该段的 card，而不是盲目打 sentMessageIds[last]
      // —— 后者会与异步建卡竞态，把内容打错 card 或被 isFinished 分支吞掉。
      // msg_id → cardId routing. composeMessage reuses one msg_id per text segment, so we can
      // route streaming updates to the exact card instead of sentMessageIds[last], which races
      // with async card creation and misroutes content.
      const msgIdToCardId: Map<string, string> = new Map();
      // 正在 await 创建 card 的 msg_id 集合。建卡 await 窗口内到达的同段 update，其 msg_id 在
      // msgIdToCardId 里还没有（newMsgId 要等 await 后），用此集合识别并暂存，建卡完成后 flush。
      // msg_ids whose card is still being created (await window). Updates arriving in this window
      // can't find their card in msgIdToCardId yet, so we defer them and flush once the card lands.
      const creatingCardForMsg: Set<string> = new Set();
      // 按 msg_id 暂存的 deferred update（全量覆盖，依赖 streamAICard isFull=true）。
      // Deferred updates keyed by msg_id (last-write-wins, relies on streamAICard isFull=true).
      const deferredByMsgId: Map<string, IUnifiedOutgoingMessage> = new Map();

      // 执行消息编辑的函数
      // Function to perform message edit
      const doEditMessage = async (msg: IUnifiedOutgoingMessage, forceThinkingTarget = false) => {
        if (!supportsEdit) return; // WeChat doesn't support edit

        // 路由决策：优先按 msg_id 精确路由；建卡窗口内的同段 update 暂存；其余 fallback 到 last。
        // Routing: prefer exact msg_id lookup; defer if that segment's card is still being created;
        // otherwise fall back to sentMessageIds[last] (legacy behavior).
        let targetMsgId: string | undefined;
        let deferred = false;
        if (forceThinkingTarget && thinkingMsgId) {
          targetMsgId = thinkingMsgId;
        } else if (msg.msg_id && msgIdToCardId.has(msg.msg_id)) {
          targetMsgId = msgIdToCardId.get(msg.msg_id);
        } else if (msg.msg_id && creatingCardForMsg.has(msg.msg_id)) {
          // 该段的 card 还在异步创建，暂存最新全量内容，建卡完成后 flush 到正确 card。
          // This segment's card is still being created; stash the latest full content and flush later.
          deferredByMsgId.set(msg.msg_id, msg);
          deferred = true;
        } else {
          targetMsgId = sentMessageIds[sentMessageIds.length - 1] || thinkingMsgId;
        }
        if (deferred) return;

        lastUpdateTime = Date.now();
        // Lark markdown cards reject `![](local-path)`. Non-Lark platforms get
        // the original msg back from the helper (identity), so no behavior change.
        const sanitizedText = stripLarkUnusableImageMarkdown(msg.text, context.platform as PluginType);
        const safeMsg = sanitizedText === msg.text ? msg : { ...msg, text: sanitizedText };
        try {
          await context.editMessage(targetMsgId!, safeMsg);
        } catch {
          // Ignore edit errors (message not modified, etc.)
        }
      };

      // 发送消息
      // Send message
      await messageService.sendMessage(sessionId, conversationId, text, files, async (message: TMessage, isInsert: boolean) => {
        const now = Date.now();

        // acp_question → DingTalk dtmd buttons (dingtalk only).
        // First insert: render first item's dtmd options (register pending state when
        // all items are supported). After sendMessage, immediately editMessage with
        // a non-undefined replyMarkup so DingTalkPlugin.editMessage's `isFinal=!!replyMarkup`
        // path runs finishAICard — otherwise the AI Card stays in INPUTING (spinning) forever
        // because acp_question is typically the last message of the agent turn and there's
        // no follow-up card whose creation would invoke finalizePendingCards.
        // Update (answered/cancelled): clear pending. Never falls through to
        // convertTMessageToOutgoing's default ('⏳ Processing...').
        if ((context.platform as PluginType) === 'dingtalk' && message.type === 'acp_question') {
          const acpContent = message.content as AcpQuestionData;
          if (isInsert && !acpContent.answered && !acpContent.cancelled) {
            messageService.registerPendingQuestion(conversationId, acpContent);
            const { markdown } = buildDingTalkQuestionMarkdown(acpContent, 0);
            const cardMsgId = await context.sendMessage({ type: 'text', text: markdown, parseMode: 'Markdown' });
            await context.editMessage(cardMsgId, { type: 'text', text: markdown, parseMode: 'Markdown', replyMarkup: {} });
          } else {
            messageService.clearPendingQuestion(conversationId);
          }
          return;
        }

        // 转换消息格式（根据平台）
        // Convert message format (based on platform)
        const outgoingMessage = convertTMessageToOutgoing(message, context.platform as PluginType, false);

        // Skip desktop-only message types (agent_status, plan, etc.)
        if (!outgoingMessage) return;

        // [DEBUG] Log outgoing message details
        console.log(`[ActionExecutor] 📤 Outgoing: isInsert=${isInsert}, type=${outgoingMessage.type}, text="${outgoingMessage.text?.slice(0, 50)}...", imageUrl=${outgoingMessage.imageUrl || 'no'}, fileUrl=${outgoingMessage.fileUrl || 'no'}, fileName=${outgoingMessage.fileName || 'none'}`);

        // Strip replyMarkup during streaming to prevent premature card finalization.
        // Tool confirmation cards set replyMarkup (e.g., for Confirming status),
        // but DingTalk interprets replyMarkup as "stream complete" and finishes the AI Card.
        // Channel conversations use yoloMode (auto-approve), so confirmation buttons are unnecessary.
        const streamOutgoing: IUnifiedOutgoingMessage = { ...outgoingMessage, replyMarkup: undefined, msg_id: message.msg_id };

        // 保存最后一条消息内容（不含 replyMarkup，最终消息会单独添加）
        // Save last message content (without replyMarkup, final message adds it separately)
        lastMessageContent = streamOutgoing;
        if (streamOutgoing.type === 'text') {
          lastTextContent = streamOutgoing;
        }

        // IMPORTANT: Treat first text streaming message as update to thinking message
        // This prevents async race condition where first insert's sendMessage takes time
        // while subsequent messages arrive and get processed as updates
        // Use thinkingUpdated flag instead of sentMessageIds.length to handle cases
        // where file/image messages are sent before text (e.g., doc generation)
        // 重要：始终将第一个text流式消息视为更新thinking消息
        // 使用 thinkingUpdated 标志而非 sentMessageIds.length，
        // 以处理 file/image 在 text 之前发送的情况（如文档生成）
        if (isInsert && !thinkingUpdated && thinkingMsgId && supportsEdit && streamOutgoing.type === 'text') {
          // First text streaming message: update thinking message instead of inserting
          // 第一个text流式消息：更新thinking消息而不是插入新消息
          thinkingUpdated = true;
          // 首个 text 段复用 thinking card，建立 msg_id → thinkingMsgId 映射，后续同段 update 精确路由。
          // First text segment reuses the thinking card; map its msg_id so later updates route here.
          if (streamOutgoing.msg_id) msgIdToCardId.set(streamOutgoing.msg_id, thinkingMsgId);

          // CRITICAL: First thinking update must be sent IMMEDIATELY without throttle delay.
          // If we delay it with a timer, subsequent UPDATE messages will overwrite the content
          // before the timer fires, and the first message content will be lost forever.
          // 关键：第一个 thinking 更新必须立即发送，不能用节流延迟。
          // 如果用定时器延迟，后续 UPDATE 会在定时器触发前覆盖内容，导致第一条消息永远丢失。
          lastUpdateTime = Date.now();
          // Lark markdown card rejects local-path image refs; helper is a no-op for other platforms.
          const sanitizedText = stripLarkUnusableImageMarkdown(streamOutgoing.text, context.platform as PluginType);
          const safeStreamOutgoing = sanitizedText === streamOutgoing.text ? streamOutgoing : { ...streamOutgoing, text: sanitizedText };
          try {
            await context.editMessage(thinkingMsgId, safeStreamOutgoing);
          } catch {
            // Ignore edit errors
          }
        } else if (isInsert) {
          // 新消息：发送新消息
          // New message: send new message
          if (supportsEdit) {
            // 特殊处理 file_send 类型（Agent 生成的文件）
            // WeCom: 缓存文件，等流结束后发送（保证文本先输出，文件最后）
            // Lark/DingTalk/Telegram: 立即发送（保持原有行为）
            // Special handling for file_send type (Agent-generated files)
            // WeCom: buffer files to send after stream ends (text first, files last)
            // Lark/DingTalk/Telegram: send immediately (keep original behavior)
            if (streamOutgoing.type === 'image' || streamOutgoing.type === 'file') {
              const isWeCom = context.platform === 'wecom';
              const isDingTalk = context.platform === 'dingtalk';
              const isLark = context.platform === 'lark';

              // 检查是否是用户输入的文件，避免发回给用户
              // Check if this is a user input file to avoid sending back to user
              const fileUrl = streamOutgoing.fileUrl;
              const imageUrl = streamOutgoing.imageUrl;
              const isUserInputFile = (fileUrl && userInputFiles.has(fileUrl)) || (imageUrl && userInputFiles.has(imageUrl));

              if (isUserInputFile) {
                console.log(`[ActionExecutor] 📎 file_send SKIPPED (user input): type=${streamOutgoing.type}, fileUrl=${fileUrl || 'none'}, imageUrl=${imageUrl || 'none'}`);
                // 记录到 sentFiles 防止后续重复发送
                // Record to sentFiles to prevent duplicate sends later
                if (fileUrl) sentFiles.add(fileUrl);
                if (imageUrl) sentFiles.add(imageUrl);
                // 标记 thinking 已更新
                // Mark thinking as updated
                if (!thinkingUpdated && thinkingMsgId) {
                  thinkingUpdated = true;
                }
                return;
              }

              // 记录文件路径到 sentFiles，避免后续重复发送（仅记录有效路径）
              // Record valid file paths to sentFiles to avoid duplicate sends later
              if (streamOutgoing.fileUrl && isValidFilePath(streamOutgoing.fileUrl)) sentFiles.add(streamOutgoing.fileUrl);
              if (streamOutgoing.imageUrl && isValidFilePath(streamOutgoing.imageUrl)) sentFiles.add(streamOutgoing.imageUrl);

              if (isWeCom || isDingTalk || isLark) {
                // WeCom/DingTalk/Lark: 缓存文件，等流结束后发送
                // WeCom/DingTalk/Lark: buffer file to send after stream ends
                console.log(`[ActionExecutor] 📎 file_send buffered (WeCom/DingTalk/Lark): type=${streamOutgoing.type}, imageUrl=${imageUrl || 'none'}, fileUrl=${fileUrl || 'none'}`);
                pendingFilesToSend.push(streamOutgoing);
                // WeCom 不支持 edit，需要标记 thinkingUpdated 让后续文本走新消息路径
                // DingTalk/Lark 支持 edit，不设置 thinkingUpdated，让第一条 text 继续编辑 thinking 卡片
                if (isWeCom && !thinkingUpdated && thinkingMsgId) {
                  thinkingUpdated = true;
                }
                return;
              } else {
                // Lark/DingTalk/Telegram: 立即发送文件（保持原有行为）
                // Lark/DingTalk/Telegram: send file immediately (keep original behavior)
                console.log(`[ActionExecutor] 📎 file_send immediate (${context.platform}): type=${streamOutgoing.type}, imageUrl=${imageUrl || 'none'}, fileUrl=${fileUrl || 'none'}`);
                try {
                  await context.sendMessage(streamOutgoing);
                } catch {
                  // Ignore file send errors
                }
                // 标记 thinking 已更新
                // Mark thinking as updated
                if (!thinkingUpdated && thinkingMsgId) {
                  thinkingUpdated = true;
                }
                return;
              }
            }

            // 记录文件路径到 sentFiles，避免后续重复发送（仅记录有效路径）
            // Record valid file paths to sentFiles to avoid duplicate sends later
            if (streamOutgoing.fileUrl && isValidFilePath(streamOutgoing.fileUrl)) sentFiles.add(streamOutgoing.fileUrl);
            if (streamOutgoing.imageUrl && isValidFilePath(streamOutgoing.imageUrl)) sentFiles.add(streamOutgoing.imageUrl);
            // [DEBUG] Log new message send with file tracking
            const fileValid = streamOutgoing.fileUrl ? isValidFilePath(streamOutgoing.fileUrl) : false;
            const imageValid = streamOutgoing.imageUrl ? isValidFilePath(streamOutgoing.imageUrl) : false;
            console.log(`[ActionExecutor] 📥 NEW message: type=${streamOutgoing.type}, imageUrl=${streamOutgoing.imageUrl || 'none'}(valid=${imageValid}), fileUrl=${streamOutgoing.fileUrl || 'none'}(valid=${fileValid}), sentFiles now=${Array.from(sentFiles).join(',') || 'empty'}`);
            const segmentMsgId = streamOutgoing.msg_id;
            try {
              // 先标记该段 card 正在创建，使后续 await 窗口内到达的同段 update 被 deferred。
              // Mark this segment's card as creating first, so same-segment updates in the await
              // window below are deferred instead of misrouted.
              if (segmentMsgId) creatingCardForMsg.add(segmentMsgId);
              // 切换到新段前，把上一段被 throttle 暂存的尾内容 flush 到它的 card。否则接下来
              // createAndDeliverAICard 会 finalize 旧 card，而这段尾还没 stream → 旧 card 缺尾。
              // Flush the previous segment's throttled tail to its card before the new card is created
              // and the old one finalized, otherwise that tail never lands and the old card reads truncated.
              if (pendingMessage) {
                if (pendingUpdateTimer) {
                  clearTimeout(pendingUpdateTimer);
                  pendingUpdateTimer = null;
                }
                await doEditMessage(pendingMessage);
                pendingMessage = null;
              }
              const createdCardId = await context.sendMessage(streamOutgoing);
              // image/file 已在上方特殊处理并 return，此处仅处理 text/buttons
              // image/file already handled above with return, here only text/buttons
              sentMessageIds.push(createdCardId);
              // 建立 msg_id → cardId 映射，并 flush 建卡窗口内暂存的同段 update 到新 card。
              // Register msg_id → cardId and flush any deferred updates for this segment to the new card.
              if (segmentMsgId) {
                msgIdToCardId.set(segmentMsgId, createdCardId);
                const deferred = deferredByMsgId.get(segmentMsgId);
                if (deferred) {
                  deferredByMsgId.delete(segmentMsgId);
                  void doEditMessage(deferred);
                }
              }
            } catch {
              // Ignore send errors
            } finally {
              // 无论成功失败都要清理 creating 标记，否则该段后续 update 会永久 deferred 而丢失。
              // Always clear the creating flag so later updates don't defer forever on a failed card.
              if (segmentMsgId) creatingCardForMsg.delete(segmentMsgId);
            }
          } else {
            // For non-edit platforms (WeChat), buffer files to send after text.
            // Text messages are accumulated and sent at the end via lastMessageContent,
            // then files are sent to ensure proper order (text first, files last).
            if (streamOutgoing.type === 'image' || streamOutgoing.type === 'file') {
              const fileUrl = streamOutgoing.fileUrl;
              const imageUrl = streamOutgoing.imageUrl;
              const isUserInputFile = (fileUrl && userInputFiles.has(fileUrl)) || (imageUrl && userInputFiles.has(imageUrl));

              if (isUserInputFile) {
                console.log(`[ActionExecutor] 📎 file_send SKIPPED (WeChat user input): type=${streamOutgoing.type}, fileUrl=${fileUrl || 'none'}, imageUrl=${imageUrl || 'none'}`);
                if (fileUrl) sentFiles.add(fileUrl);
                if (imageUrl) sentFiles.add(imageUrl);
                return;
              }

              // Buffer image/file for WeChat to send after text (ensures text first, files last)
              if ((imageUrl && isValidFilePath(imageUrl) && !sentFiles.has(imageUrl)) || (fileUrl && isValidFilePath(fileUrl) && !sentFiles.has(fileUrl))) {
                if (imageUrl) sentFiles.add(imageUrl);
                if (fileUrl) sentFiles.add(fileUrl);
                console.log(`[ActionExecutor] 📎 file_send buffered (WeChat): type=${streamOutgoing.type}, imageUrl=${imageUrl || 'none'}, fileUrl=${fileUrl || 'none'}, pendingFilesToSend.length before=${pendingFilesToSend.length}`);
                pendingFilesToSend.push(streamOutgoing);
                console.log(`[ActionExecutor] 📎 file_send buffered (WeChat): pendingFilesToSend.length after=${pendingFilesToSend.length}`);
              }
            } else {
              // Track that we have content for text messages
              if (sentMessageIds.length === 0) {
                sentMessageIds.push('wechat_placeholder');
              }
            }
          }
        } else {
          // 更新消息：使用定时器节流，确保最后一条消息能被发送
          // Update message: throttle with timer to ensure last message is sent
          if (supportsEdit) {
            // 检查是否有文件附件需要发送（支持 edit 的平台如 WeCom 需要单独发送文件）
            // Check if there are file attachments to send (edit-capable platforms like WeCom need separate file send)
            // 排除用户输入的文件，避免发回给用户
            // Exclude user input files to avoid sending back to user
            // 验证路径有效性，过滤 Agent 流式输出的部分/截断路径（如 "/Users/y"，是目录而非文件）
            // Validate path to filter out partial/truncated paths from Agent streaming (e.g., "/Users/y" is a directory)
            const rawFileUrl = streamOutgoing.fileUrl;
            const rawImageUrl = streamOutgoing.imageUrl;
            const fileToSend = rawFileUrl && isValidFilePath(rawFileUrl) && !sentFiles.has(rawFileUrl) && !userInputFiles.has(rawFileUrl) ? rawFileUrl : null;
            const imageToSend = rawImageUrl && isValidFilePath(rawImageUrl) && !sentFiles.has(rawImageUrl) && !userInputFiles.has(rawImageUrl) ? rawImageUrl : null;

            // [DEBUG] Log file send decision with validation status
            const fileValid = rawFileUrl ? isValidFilePath(rawFileUrl) : false;
            const imageValid = rawImageUrl ? isValidFilePath(rawImageUrl) : false;
            console.log(
              `[ActionExecutor] 📎 File check: fileUrl=${rawFileUrl || 'none'}(valid=${fileValid}), imageUrl=${rawImageUrl || 'none'}(valid=${imageValid}), sentFiles=${Array.from(sentFiles).join(',') || 'empty'}, userInputFiles=${Array.from(userInputFiles).join(',') || 'empty'}, fileToSend=${fileToSend || 'skip'}, imageToSend=${imageToSend || 'skip'}`
            );

            // 处理文件发送：WeCom 缓存到流结束，其他渠道立即发送
            // Handle file send: WeCom buffers until stream ends, other channels send immediately
            const isWeCom = context.platform === 'wecom';

            if (fileToSend) {
              sentFiles.add(fileToSend);
              if (isWeCom) {
                // WeCom: 缓存文件，等流结束后发送
                // WeCom: buffer file to send after stream ends
                console.log(`[ActionExecutor] 📁 File buffered (WeCom): ${fileToSend}`);
                pendingFilesToSend.push({
                  type: 'file',
                  text: '',
                  fileUrl: fileToSend,
                  fileName: streamOutgoing.fileName,
                });
              } else {
                // Lark/DingTalk/Telegram: 立即发送文件
                // Lark/DingTalk/Telegram: send file immediately
                console.log(`[ActionExecutor] 📁 File sending immediately (${context.platform}): ${fileToSend}`);
                try {
                  await context.sendMessage({
                    type: 'file',
                    text: '',
                    fileUrl: fileToSend,
                    fileName: streamOutgoing.fileName,
                  });
                } catch {
                  // Ignore file send errors
                }
              }
            }

            if (imageToSend) {
              sentFiles.add(imageToSend);
              if (isWeCom) {
                // WeCom: 缓存图片，等流结束后发送
                // WeCom: buffer image to send after stream ends
                console.log(`[ActionExecutor] 🖼️ Image buffered (WeCom): ${imageToSend}`);
                pendingFilesToSend.push({
                  type: 'image',
                  text: '',
                  imageUrl: imageToSend,
                });
              } else {
                // Lark/DingTalk/Telegram: 立即发送图片
                // Lark/DingTalk/Telegram: send image immediately
                console.log(`[ActionExecutor] 🖼️ Image sending immediately (${context.platform}): ${imageToSend}`);
                try {
                  await context.sendMessage({
                    type: 'image',
                    text: '',
                    imageUrl: imageToSend,
                  });
                } catch {
                  // Ignore image send errors
                }
              }
            }

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
        console.log(`[ActionExecutor] 📤 Stream ended, lastMessageContent: type=${lastMessageContent.type}, text=${lastMessageContent.text?.slice(0, 50) || 'none'}...`);
        // Skip edit for non-text messages (file/image) — these were already sent via sendMessage
        // and cannot be edited (LarkPlugin.editMessage only supports card messages)
        if (lastMessageContent.type === 'file' || lastMessageContent.type === 'image') {
          // File/image was the last message — still need to finalize the AI Card
          // with the last text content so it stops spinning
          if (lastTextContent && supportsEdit && sentMessageIds.length > 0) {
            const responseMarkup = getResponseActionsMarkup(context.platform as PluginType, lastTextContent.text);
            // Strip Lark-incompatible markdown image refs from the final card text
            // (image is sent separately via pendingFilesToSend below). No-op for non-Lark.
            const sanitizedFinalText = stripLarkUnusableImageMarkdown(lastTextContent.text, context.platform as PluginType);
            const finalMessage: IUnifiedOutgoingMessage = { ...lastTextContent, text: sanitizedFinalText, replyMarkup: responseMarkup };
            const lastMsgId = sentMessageIds[sentMessageIds.length - 1];
            await context.editMessage(lastMsgId, finalMessage);
          } else if (!supportsEdit && lastTextContent) {
            // For WeChat (supportsEdit=false), send the last text content as a new message
            const responseMarkup = getResponseActionsMarkup(context.platform as PluginType, lastTextContent.text);
            const finalMessage: IUnifiedOutgoingMessage = { ...lastTextContent, replyMarkup: responseMarkup };
            console.log(`[ActionExecutor] 📤 Sending final text message (WeChat file stream ended): type=${finalMessage.type}, text=${finalMessage.text?.slice(0, 50) || 'none'}...`);
            try {
              const result = await context.sendMessage(finalMessage);
              console.log(`[ActionExecutor] 📤 Final text message result: ${result}`);
            } catch (err) {
              console.error(`[ActionExecutor] 📤 Final text message error: ${err}`);
            }
          }
        } else {
          const responseMarkup = getResponseActionsMarkup(context.platform as PluginType, lastMessageContent.text);
          // Strip Lark-incompatible markdown image refs. No-op for non-Lark.
          const sanitizedFinalText = stripLarkUnusableImageMarkdown(lastMessageContent.text, context.platform as PluginType);
          const finalMessage: IUnifiedOutgoingMessage = { ...lastMessageContent, text: sanitizedFinalText, replyMarkup: responseMarkup };

          if (supportsEdit && sentMessageIds.length > 0) {
            const lastMsgId = sentMessageIds[sentMessageIds.length - 1];
            await context.editMessage(lastMsgId, finalMessage);
          } else if (context.platform === 'lark' && supportsEdit && thinkingMsgId) {
            // 飞书：文件缓冲后 sentMessageIds 为空，回退到 thinkingMsgId 编辑原卡片，避免重复发送文字
            await context.editMessage(thinkingMsgId, finalMessage);
          } else {
            // For WeChat or if no message was sent yet, send the final content as a new message
            console.log(`[ActionExecutor] 📤 Sending final message (WeChat/no sentMessageIds): type=${finalMessage.type}, text=${finalMessage.text?.slice(0, 50) || 'none'}...`);
            try {
              const result = await context.sendMessage(finalMessage);
              console.log(`[ActionExecutor] 📤 Final message result: ${result}`);
            } catch (err) {
              console.error(`[ActionExecutor] 📤 Final message error: ${err}`);
            }
          }
        }
      } else if (supportsEdit && thinkingMsgId) {
        // Stream ended without content (e.g., user cancelled during thinking phase).
        // Finalize the thinking AI Card with cancel message so it stops spinning.
        const cancelMessage: IUnifiedOutgoingMessage = {
          type: 'text',
          text: '请求已被用户终止',
          parseMode: 'HTML',
          replyMarkup: getResponseActionsMarkup(context.platform as PluginType, '请求已被用户终止'),
        };
        try {
          await context.editMessage(thinkingMsgId, cancelMessage);
        } catch {
          // Ignore edit errors
        }
      } else {
        console.log(`[ActionExecutor] 📤 Stream ended, no lastMessageContent`);
      }

      // 流结束后发送缓存的文件（保证文本先输出完整，文件最后发送）
      // Send buffered files after stream ends (ensure text outputs first, files last)
      console.log(`[ActionExecutor] 📁 Checking buffered files: pendingFilesToSend.length=${pendingFilesToSend.length}`);
      if (pendingFilesToSend.length > 0) {
        console.log(`[ActionExecutor] 📁 Sending ${pendingFilesToSend.length} buffered files after stream ends`);
        for (const fileMsg of pendingFilesToSend) {
          try {
            const result = await context.sendMessage(fileMsg);
            console.log(`[ActionExecutor] 📁 Buffered file sent: type=${fileMsg.type}, result=${result}`);
          } catch (err) {
            console.error(`[ActionExecutor] 📁 Buffered file error: type=${fileMsg.type}, error=${err}`);
          }
        }
        pendingFilesToSend.length = 0; // Clear buffer
      }
    } catch (error: any) {
      console.error(`[ActionExecutor] Chat processing failed:`, error);

      // Update message with error
      const errorResponse = buildChatErrorResponse(error.message);
      errorResponse.replyMarkup = getErrorRecoveryMarkup(context.platform as PluginType, error.message);
      if (supportsEdit && thinkingMsgId) {
        await context.editMessage(thinkingMsgId, errorResponse);
      } else {
        await context.sendMessage(errorResponse);
      }
    } finally {
      // Release per-conversation lock so the next queued message can proceed
      releaseLock!();
      if (this.conversationLocks.get(conversationId) === lockPromise) {
        this.conversationLocks.delete(conversationId);
      }

      // Stop typing indicator
      void context.sendTyping?.(context.chatId, true);

      // 首轮对话完成后，自动用用户消息内容更新会话标题
      // After first round of conversation, auto-update title with user message content
      if (conversationId) {
        this.autoUpdateConversationTitle(conversationId, text);
      }

      // 通知渲染进程对话已更新（updated_at 变化影响列表排序）
      if (conversationId) {
        databaseBridge.conversationChanged.emit({
          conversationId,
          source: context.platform,
          action: 'updated',
        });
      }
    }
  }

  /**
   * 如果会话标题尚未被更新过（仍是初始的用户昵称），则使用用户首条消息内容更新标题。
   * 格式为："{displayName}: {message_summary}"，最大50字符。
   *
   * Auto-update conversation title if it hasn't been updated yet.
   * Uses format: "{displayName}: {message_summary}", max 50 characters.
   * Marks the conversation with `titleUpdated: true` in extra to prevent repeated updates.
   */
  private autoUpdateConversationTitle(conversationId: string, messageText: string): void {
    try {
      const db = getDatabase();
      const result = db.getConversation(conversationId);
      if (!result.success || !result.data) return;

      const conversation = result.data;
      const extra = (conversation.extra || {}) as Record<string, unknown>;

      // 已更新过标题则跳过
      // Skip if title has already been updated
      if (extra.titleUpdated) return;

      // 清理用户消息文本：去除换行、多余空格，截取摘要
      // Clean user message text: remove newlines, extra spaces, extract summary
      const cleanText = messageText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      if (!cleanText) return;

      const currentName = conversation.name || '';

      // 组合标题："{displayName}: {message_summary}"
      // Compose title: "{displayName}: {message_summary}"
      const maxSummaryLen = 50 - currentName.length - 2; // 2 for ": "
      let newTitle: string;
      if (maxSummaryLen > 10 && currentName) {
        const summary = cleanText.length > maxSummaryLen ? cleanText.substring(0, maxSummaryLen - 1) + '…' : cleanText;
        newTitle = `${currentName}: ${summary}`;
      } else {
        // 如果用户名太长，直接用消息内容作为标题
        // If display name is too long, use message content directly as title
        newTitle = cleanText.length > 50 ? cleanText.substring(0, 49) + '…' : cleanText;
      }

      db.updateConversation(conversationId, {
        name: newTitle,
        extra: { ...extra, titleUpdated: true },
      } as any);
    } catch (error) {
      console.warn('[ActionExecutor] Failed to auto-update conversation title:', error);
    }
  }

  /**
   * Get plugin instance for a message
   */
  /**
   * Fallback only, for callers with no source plugin. Returns the FIRST connection of the
   * type, which is ambiguous once several are configured — prefer the source plugin the
   * message arrived on.
   */
  private getPluginForMessage(message: IUnifiedIncomingMessage) {
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
