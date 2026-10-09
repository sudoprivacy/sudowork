/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { database as databaseBridge } from '@sudowork/host-bridge/ipcBridge';
import type { TProviderWithModel } from '@sudowork/common/storage';
import { acpDetector } from '@/agent/acp/AcpDetector';
import { ProcessConfig } from '@/process/initStorage';
import { ConversationService } from '@/process/services/conversationService';
import WorkerManage from '@/process/WorkerManage';
import { GOOGLE_AUTH_PROVIDER_ID } from '@/common/constants';
import type { AcpBackend } from '@/types/acpTypes';
import { getChannelMessageService } from '../agent/ChannelMessageService';
import { getChannelManager } from '../core/ChannelManager';
import { getConnectionAgent, getConnectionModel } from '../channelConnectionConfig';
import type { AgentDisplayInfo } from '../plugins/telegram/TelegramKeyboards';
import { createAgentSelectionKeyboard, createHelpKeyboard, createMainMenuKeyboard, createSessionControlKeyboard } from '../plugins/telegram/TelegramKeyboards';
import { getChannelConversationName, resolveChannelConvType } from '../types';
import { createAgentSelectionCard, createFeaturesCard, createHelpCard, createMainMenuCard, createPairingGuideCard, createSessionStatusCard, createSettingsCard, createTipsCard } from '../plugins/lark/LarkCards';
import {
  createAgentSelectionCard as createDingTalkAgentSelectionCard,
  createFeaturesCard as createDingTalkFeaturesCard,
  createHelpCard as createDingTalkHelpCard,
  createMainMenuCard as createDingTalkMainMenuCard,
  createPairingGuideCard as createDingTalkPairingGuideCard,
  createSessionStatusCard as createDingTalkSessionStatusCard,
  createSettingsCard as createDingTalkSettingsCard,
  createTipsCard as createDingTalkTipsCard,
} from '../plugins/dingtalk/DingTalkCards';
import type { ChannelAgentType, PluginType } from '../types';
import type { ActionHandler, IRegisteredAction } from './types';
import { SystemActionNames, createErrorResponse, createSuccessResponse } from './types';

/**
 * Get the default model for Channel assistant (Telegram/Lark)
 * Reads from saved config or falls back to default Gemini model
 */

export async function getChannelDefaultModel(platform: PluginType, pluginId?: string): Promise<TProviderWithModel> {
  try {
    const providers = await ProcessConfig.get('model.config');
    const providerList = providers && Array.isArray(providers) ? providers : [];

    // Helper: find a provider with a valid API key
    const findProviderWithApiKey = (providerId: string, modelName: string): TProviderWithModel | null => {
      const provider = providerList.find((p) => p.id === providerId);
      if (provider?.apiKey && provider.model?.includes(modelName)) {
        return { ...provider, useModel: modelName } as TProviderWithModel;
      }
      return null;
    };

    // Model for THIS connection, falling back to the type-wide setting.
    const savedModel = await getConnectionModel(pluginId, platform);
    if (savedModel?.id && savedModel?.useModel) {
      // Google Auth is frontend-only (OAuth browser flow), not usable in channels.
      // Fall through to find a provider with a valid API key instead.
      if (savedModel.id === GOOGLE_AUTH_PROVIDER_ID) {
        console.warn(`[SystemActions] Google Auth is not supported in channel mode (${platform}), falling back to API key provider`);
        // Try to find any Gemini provider with API key for the same model
        const fallback = providerList.find((p) => p.platform === 'gemini' && p.apiKey && p.model?.includes(savedModel.useModel));
        if (fallback) {
          return { ...fallback, useModel: savedModel.useModel } as TProviderWithModel;
        }
        // Otherwise fall through to general fallback below
      } else {
        // For regular (API-key-based) providers, look up full config
        const result = findProviderWithApiKey(savedModel.id, savedModel.useModel);
        if (result) return result;
      }
    }

    // Fallback: try to get any Gemini provider with a valid API key
    const geminiProvider = providerList.find((p) => p.platform === 'gemini' && p.apiKey && p.model?.length);
    if (geminiProvider) {
      return {
        ...geminiProvider,
        useModel: geminiProvider.model[0],
      } as TProviderWithModel;
    }

    // Last resort: any provider with a valid API key
    const anyProvider = providerList.find((p) => p.apiKey && p.model?.length);
    if (anyProvider) {
      console.warn(`[SystemActions] No Gemini provider with API key, using ${anyProvider.platform} provider`);
      return {
        ...anyProvider,
        useModel: anyProvider.model[0],
      } as TProviderWithModel;
    }
  } catch (error) {
    console.warn('[SystemActions] Failed to get saved model, using default:', error);
  }

  // Default fallback - minimal config for Gemini (no API key — will fail with clear error)
  console.error('[SystemActions] No provider with valid API key found. Channel messages will fail.');
  return {
    id: 'gemini_default',
    platform: 'gemini',
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKey: '',
    useModel: 'gemini-2.0-flash',
  };
}

/**
 * SystemActions - Handlers for system-level actions
 *
 * These actions handle session management, help, and settings.
 * They don't require AI processing - just system operations.
 */

/**
 * Handle session.new - Create a new conversation session
 */
export const handleSessionNew: ActionHandler = async (context) => {
  const manager = getChannelManager();
  const sessionManager = manager.getSessionManager();

  if (!sessionManager) {
    return createErrorResponse('Session manager not available');
  }

  if (!context.channelUser) {
    return createErrorResponse('User not authorized');
  }

  // Clear existing session and agent for this user+chat
  const existingSession = sessionManager.getSession(context.channelUser.id, context.chatId);
  if (existingSession) {
    // Clear agent cache in ChannelMessageService
    const messageService = getChannelMessageService();
    await messageService.clearContext(existingSession.id);

    // Kill the worker for the old conversation
    if (existingSession.conversationId) {
      try {
        WorkerManage.kill(existingSession.conversationId);
      } catch (err) {
        console.warn(`[SystemActions] Failed to kill old conversation:`, err);
      }
    }
  }
  sessionManager.clearSession(context.channelUser.id, context.chatId);

  const platform = context.platform;
  const source = platform === 'lark' ? 'lark' : platform === 'dingtalk' ? 'dingtalk' : 'telegram';

  // Agent for THIS connection, falling back to the type-wide setting.
  let savedAgent: unknown = undefined;
  try {
    savedAgent = await getConnectionAgent(context.pluginId, platform);
  } catch {
    // ignore
  }
  const backend = (savedAgent && typeof savedAgent === 'object' && typeof (savedAgent as any).backend === 'string' ? (savedAgent as any).backend : 'scode') as string;
  const customAgentId = savedAgent && typeof savedAgent === 'object' ? ((savedAgent as any).customAgentId as string | undefined) : undefined;
  const agentName = savedAgent && typeof savedAgent === 'object' ? ((savedAgent as any).name as string | undefined) : undefined;

  // Provider model is required by typing; ACP will ignore it.
  const model = await getChannelDefaultModel(platform, context.pluginId);

  // Always create a NEW conversation for "session.new" (scoped by chatId)
  const channelChatId = context.chatId;
  const { convType, convBackend } = resolveChannelConvType(backend);

  // Resolve cliPath from detected agents so AcpAgent can spawn the CLI correctly
  const detectedAgent = acpDetector.getDetectedAgents().find((a) => a.backend === backend);
  const cliPath = detectedAgent?.cliPath;
  // 使用用户昵称作为初始标题（与自动创建会话保持一致），后续首条消息会自动更新标题
  // Use user display name as initial title (consistent with auto-created conversations),
  // the title will be auto-updated on the first message
  const name = context.channelUser?.displayName || context.displayName || getChannelConversationName(platform, convType, convBackend, channelChatId);
  const result = await ConversationService.createConversation({
    type: 'acp',
    model,
    source,
    name,
    channelChatId,
    extra: {
      backend: backend as AcpBackend,
      cliPath,
      customAgentId,
      agentName,
    },
  });

  if (!result.success || !result.conversation) {
    return createErrorResponse(`Failed to create session: ${result.error || 'Unknown error'}`);
  }

  // Create session with the new conversation ID (scoped by chatId)
  const agentType = convType as ChannelAgentType;
  const session = sessionManager.createSessionWithConversation(context.channelUser, result.conversation.id, agentType, undefined, channelChatId);

  // 通知渲染进程刷新对话列表
  databaseBridge.conversationChanged.emit({
    conversationId: result.conversation.id,
    source,
    action: 'created',
  });

  const markup = context.platform === 'lark' ? createMainMenuCard() : context.platform === 'dingtalk' ? createDingTalkMainMenuCard() : createMainMenuKeyboard();
  return createSuccessResponse({
    type: 'text',
    text: `🆕 <b>New Session Created</b>\n\nSession ID: <code>${session.id.slice(-8)}</code>\n\nYou can start a new conversation now!`,
    parseMode: 'HTML',
    replyMarkup: markup,
  });
};

/**
 * Handle session.status - Show current session status
 */
export const handleSessionStatus: ActionHandler = async (context) => {
  const manager = getChannelManager();
  const sessionManager = manager.getSessionManager();

  if (!sessionManager) {
    return createErrorResponse('Session manager not available');
  }

  const userId = context.channelUser?.id;
  const session = userId ? sessionManager.getSession(userId, context.chatId) : null;

  // Use platform-specific markup
  if (context.platform === 'lark') {
    const sessionData = session ? { id: session.id, agentType: session.agentType, createdAt: session.createdAt, lastActivity: session.lastActivity } : undefined;
    return createSuccessResponse({
      type: 'text',
      text: '', // Lark card includes the text
      replyMarkup: createSessionStatusCard(sessionData),
    });
  }

  if (context.platform === 'dingtalk') {
    const sessionData = session ? { id: session.id, agentType: session.agentType, createdAt: session.createdAt, lastActivity: session.lastActivity } : undefined;
    return createSuccessResponse({
      type: 'text',
      text: '', // DingTalk card includes the text
      replyMarkup: createDingTalkSessionStatusCard(sessionData),
    });
  }

  if (!session) {
    return createSuccessResponse({
      type: 'text',
      text: '📊 <b>Session Status</b>\n\nNo active session.\n\nSend a message to start a new conversation, or tap the "New Chat" button.',
      parseMode: 'HTML',
      replyMarkup: createSessionControlKeyboard(),
    });
  }

  const duration = Math.floor((Date.now() - session.createdAt) / 1000 / 60);
  const lastActivity = Math.floor((Date.now() - session.lastActivity) / 1000);

  return createSuccessResponse({
    type: 'text',
    text: ['📊 <b>Session Status</b>', '', `🤖 Agent: <code>${session.agentType}</code>`, `⏱ Duration: ${duration} min`, `📝 Last activity: ${lastActivity} sec ago`, `🔖 Session ID: <code>${session.id.slice(-8)}</code>`].join('\n'),
    parseMode: 'HTML',
    replyMarkup: createSessionControlKeyboard(),
  });
};

/**
 * Handle help.show - Show help menu
 */
export const handleHelpShow: ActionHandler = async (context) => {
  if (context.platform === 'lark') {
    return createSuccessResponse({
      type: 'text',
      text: '', // Lark card includes the text
      replyMarkup: createHelpCard(),
    });
  }
  if (context.platform === 'dingtalk') {
    return createSuccessResponse({
      type: 'text',
      text: '',
      replyMarkup: createDingTalkHelpCard(),
    });
  }
  return createSuccessResponse({
    type: 'text',
    text: [
      '❓ <b>Sudowork Assistant</b>',
      '',
      'A remote assistant to interact with Sudowork via Telegram.',
      '',
      '<b>Common Actions:</b>',
      '• 🆕 New Chat - Start a new session',
      '• 📊 Status - View current session status',
      '• ❓ Help - Show this help message',
      '',
      'Send a message to chat with the AI assistant.',
    ].join('\n'),
    parseMode: 'HTML',
    replyMarkup: createHelpKeyboard(),
  });
};

/**
 * Handle help.features - Show feature introduction
 */
export const handleHelpFeatures: ActionHandler = async (context) => {
  if (context.platform === 'lark') {
    return createSuccessResponse({
      type: 'text',
      text: '',
      replyMarkup: createFeaturesCard(),
    });
  }
  if (context.platform === 'dingtalk') {
    return createSuccessResponse({
      type: 'text',
      text: '',
      replyMarkup: createDingTalkFeaturesCard(),
    });
  }
  return createSuccessResponse({
    type: 'text',
    text: [
      '🤖 <b>Features</b>',
      '',
      '<b>AI Chat</b>',
      '• Natural language conversation',
      '• Streaming output, real-time display',
      '• Context memory support',
      '',
      '<b>Session Management</b>',
      '• Single session mode',
      '• Clear context anytime',
      '• View session status',
      '',
      '<b>Message Actions</b>',
      '• Copy reply content',
      '• Regenerate reply',
      '• Continue conversation',
    ].join('\n'),
    parseMode: 'HTML',
    replyMarkup: createHelpKeyboard(),
  });
};

/**
 * Handle help.pairing - Show pairing guide
 */
export const handleHelpPairing: ActionHandler = async (context) => {
  if (context.platform === 'lark') {
    return createSuccessResponse({
      type: 'text',
      text: '',
      replyMarkup: createPairingGuideCard(),
    });
  }
  if (context.platform === 'dingtalk') {
    return createSuccessResponse({
      type: 'text',
      text: '',
      replyMarkup: createDingTalkPairingGuideCard(),
    });
  }
  return createSuccessResponse({
    type: 'text',
    text: [
      '🔗 <b>Pairing Guide</b>',
      '',
      '<b>First-time Setup:</b>',
      '1. Send any message to the bot',
      '2. Bot displays pairing code',
      '3. Approve pairing in Sudowork settings',
      '4. Ready to use after pairing',
      '',
      '<b>Notes:</b>',
      '• Pairing code valid for 10 minutes',
      '• Sudowork app must be running',
      '• One Telegram account can only pair once',
    ].join('\n'),
    parseMode: 'HTML',
    replyMarkup: createHelpKeyboard(),
  });
};

/**
 * Handle help.tips - Show usage tips
 */
export const handleHelpTips: ActionHandler = async (context) => {
  if (context.platform === 'lark') {
    return createSuccessResponse({
      type: 'text',
      text: '',
      replyMarkup: createTipsCard(),
    });
  }
  if (context.platform === 'dingtalk') {
    return createSuccessResponse({
      type: 'text',
      text: '',
      replyMarkup: createDingTalkTipsCard(),
    });
  }
  return createSuccessResponse({
    type: 'text',
    text: [
      '💬 <b>Tips</b>',
      '',
      '<b>Effective Conversations:</b>',
      '• Be clear and specific',
      '• Feel free to ask follow-ups',
      '• Regenerate if not satisfied',
      '',
      '<b>Quick Actions:</b>',
      '• Use bottom buttons for quick access',
      '• Tap message buttons for actions',
      '• New chat clears history context',
    ].join('\n'),
    parseMode: 'HTML',
    replyMarkup: createHelpKeyboard(),
  });
};

/**
 * Handle settings.show - Show settings info
 */
export const handleSettingsShow: ActionHandler = async (context) => {
  if (context.platform === 'lark') {
    return createSuccessResponse({
      type: 'text',
      text: '',
      replyMarkup: createSettingsCard(),
    });
  }
  if (context.platform === 'dingtalk') {
    return createSuccessResponse({
      type: 'text',
      text: '',
      replyMarkup: createDingTalkSettingsCard(),
    });
  }
  return createSuccessResponse({
    type: 'text',
    text: ['⚙️ <b>Settings</b>', '', 'Channel settings need to be configured in the Sudowork app.', '', 'Open Sudowork → WebUI → Channels'].join('\n'),
    parseMode: 'HTML',
    replyMarkup: createMainMenuKeyboard(),
  });
};

/**
 * Handle agent.show - Show agent selection keyboard/card
 */
export const handleAgentShow: ActionHandler = async (context) => {
  const manager = getChannelManager();
  const sessionManager = manager.getSessionManager();

  if (!sessionManager) {
    return createErrorResponse('Session manager not available');
  }

  // Get current agent type from session (scoped by chatId)
  const userId = context.channelUser?.id;
  const session = userId ? sessionManager.getSession(userId, context.chatId) : null;
  const currentAgent = session?.agentType || 'acp';

  // Get available agents dynamically
  const availableAgents = getAvailableChannelAgents();

  if (availableAgents.length === 0) {
    return createErrorResponse('No agents available');
  }

  // Use platform-specific markup
  if (context.platform === 'lark') {
    return createSuccessResponse({
      type: 'text',
      text: '', // Lark card includes the text
      replyMarkup: createAgentSelectionCard(availableAgents, currentAgent),
    });
  }

  if (context.platform === 'dingtalk') {
    return createSuccessResponse({
      type: 'text',
      text: '',
      replyMarkup: createDingTalkAgentSelectionCard(availableAgents, currentAgent),
    });
  }

  return createSuccessResponse({
    type: 'text',
    text: ['🔄 <b>Switch Agent</b>', '', 'Select an AI agent for your conversations:', '', `Current: <b>${getAgentDisplayName(currentAgent)}</b>`].join('\n'),
    parseMode: 'HTML',
    replyMarkup: createAgentSelectionKeyboard(availableAgents, currentAgent),
  });
};

/**
 * Handle agent.select - Switch to a different agent
 */
export const handleAgentSelect: ActionHandler = async (context, params) => {
  const manager = getChannelManager();
  const sessionManager = manager.getSessionManager();

  if (!sessionManager) {
    return createErrorResponse('Session manager not available');
  }

  if (!context.channelUser) {
    return createErrorResponse('User not authorized');
  }

  const newAgentType = params?.agentType as ChannelAgentType;

  // Validate agent type is available
  const availableAgents = getAvailableChannelAgents();
  const isValidAgent = availableAgents.some((agent) => agent.type === newAgentType);
  if (!newAgentType || !isValidAgent) {
    return createErrorResponse('Invalid or unavailable agent type');
  }

  // Get current session (scoped by chatId)
  const existingSession = sessionManager.getSession(context.channelUser.id, context.chatId);

  // If same agent, no need to switch
  if (existingSession?.agentType === newAgentType) {
    const markup = context.platform === 'lark' ? createMainMenuCard() : context.platform === 'dingtalk' ? createDingTalkMainMenuCard() : createMainMenuKeyboard();
    return createSuccessResponse({
      type: 'text',
      text: `✓ Already using <b>${getAgentDisplayName(newAgentType)}</b>`,
      parseMode: 'HTML',
      replyMarkup: markup,
    });
  }

  // Clear existing session and agent (scoped by chatId)
  if (existingSession) {
    const messageService = getChannelMessageService();
    await messageService.clearContext(existingSession.id);

    if (existingSession.conversationId) {
      try {
        WorkerManage.kill(existingSession.conversationId);
      } catch (err) {
        console.warn(`[SystemActions] Failed to kill old conversation:`, err);
      }
    }
  }
  sessionManager.clearSession(context.channelUser.id, context.chatId);

  const markup = context.platform === 'lark' ? createMainMenuCard() : context.platform === 'dingtalk' ? createDingTalkMainMenuCard() : createMainMenuKeyboard();
  return createSuccessResponse({
    type: 'text',
    text: [`✓ <b>Switched to ${getAgentDisplayName(newAgentType)}</b>`, '', 'A new conversation has been started.', '', 'Send a message to begin!'].join('\n'),
    parseMode: 'HTML',
    replyMarkup: markup,
  });
};

/**
 * Get display name for agent type
 */
function getAgentDisplayName(agentType: ChannelAgentType): string {
  const names: Record<ChannelAgentType, string> = {
    acp: '🧠 Claude',
  };
  return names[agentType] || agentType;
}

/**
 * Map backend type to ChannelAgentType
 * Only returns types that are supported by channels
 */
function backendToChannelAgentType(): ChannelAgentType | null {
  return 'acp';
}

/**
 * Get emoji for agent backend
 */
function getAgentEmoji(backend: string): string {
  const emojis: Record<string, string> = {
    claude: '🧠',
    gemini: '🤖',
    codex: '⚡',
    qwen: '🔮',
    scode: '⚡',
  };
  return emojis[backend] || '🤖';
}

/**
 * Get available agents for channel selection
 * Filters detected agents to only those supported by channels
 */
function getAvailableChannelAgents(): AgentDisplayInfo[] {
  const detectedAgents = acpDetector.getDetectedAgents();
  const availableAgents: AgentDisplayInfo[] = [];
  const seenTypes = new Set<ChannelAgentType>();

  // Add detected agents (claude, gemini, codex, etc.)
  for (const agent of detectedAgents) {
    const channelType = backendToChannelAgentType();
    if (channelType && !seenTypes.has(channelType)) {
      availableAgents.push({
        type: channelType,
        emoji: getAgentEmoji(agent.backend),
        name: agent.name,
      });
      seenTypes.add(channelType);
    }
  }

  return availableAgents;
}

/**
 * All system actions
 */
export const systemActions: IRegisteredAction[] = [
  {
    name: SystemActionNames.SESSION_NEW,
    category: 'system',
    description: 'Create a new conversation session',
    handler: handleSessionNew,
  },
  {
    name: SystemActionNames.SESSION_STATUS,
    category: 'system',
    description: 'Show current session status',
    handler: handleSessionStatus,
  },
  {
    name: SystemActionNames.HELP_SHOW,
    category: 'system',
    description: 'Show help menu',
    handler: handleHelpShow,
  },
  {
    name: SystemActionNames.HELP_FEATURES,
    category: 'system',
    description: 'Show feature introduction',
    handler: handleHelpFeatures,
  },
  {
    name: SystemActionNames.HELP_PAIRING,
    category: 'system',
    description: 'Show pairing guide',
    handler: handleHelpPairing,
  },
  {
    name: SystemActionNames.HELP_TIPS,
    category: 'system',
    description: 'Show usage tips',
    handler: handleHelpTips,
  },
  {
    name: SystemActionNames.SETTINGS_SHOW,
    category: 'system',
    description: 'Show settings info',
    handler: handleSettingsShow,
  },
  {
    name: SystemActionNames.AGENT_SHOW,
    category: 'system',
    description: 'Show agent selection',
    handler: handleAgentShow,
  },
  {
    name: SystemActionNames.AGENT_SELECT,
    category: 'system',
    description: 'Switch to a different agent',
    handler: handleAgentSelect,
  },
];
