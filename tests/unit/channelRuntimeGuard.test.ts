import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUnifiedIncomingMessage } from '@/channels/types';

const h = vi.hoisted(() => ({
  getConversation: vi.fn(),
  getChannelUserByPlatform: vi.fn(),
  processConfigGet: vi.fn(),
  createConversation: vi.fn(),
  sendAgentMessage: vi.fn(),
}));

vi.mock('@/common/ipcBridge', () => ({
  database: { conversationChanged: { emit: vi.fn() } },
}));
vi.mock('@/common/nexusFiles', () => ({ parseNexusFilesMarker: vi.fn(() => []) }));
vi.mock('@/common/generatedFiles', () => ({ stripGeneratedFilesMarker: vi.fn((text: string) => text) }));
vi.mock('@/process/database', () => ({
  getDatabase: () => ({
    getConversation: h.getConversation,
    getChannelUserByPlatform: h.getChannelUserByPlatform,
    findChannelConversation: vi.fn(() => ({ success: true, data: null })),
    updateConversation: vi.fn(),
  }),
}));
vi.mock('@/process/initStorage', () => ({ ProcessConfig: { get: h.processConfigGet } }));
vi.mock('@/process/utils', () => ({ getDataPath: vi.fn(() => '/tmp') }));
vi.mock('@/process/utils/mainLogger', () => ({ mainError: vi.fn() }));
vi.mock('@/process/services/conversationService', () => ({
  ConversationService: { createConversation: h.createConversation },
}));
vi.mock('@/process/services/transcription/TranscriptionService', () => ({
  transcriptionService: { transcribe: vi.fn() },
}));
vi.mock('@/agent/acp/AcpDetector', () => ({ acpDetector: { getDetectedAgents: vi.fn(() => []) } }));
vi.mock('@/channels/actions/ChatActions', () => ({
  buildChatErrorResponse: vi.fn(),
  chatActions: [],
}));
vi.mock('@/channels/actions/PlatformActions', () => ({
  handlePairingShow: vi.fn(),
  platformActions: [],
}));
vi.mock('@/channels/actions/SystemActions', () => ({
  getChannelDefaultModel: vi.fn(),
  systemActions: [],
}));
vi.mock('@/channels/agent/ChannelMessageService', () => ({
  getChannelMessageService: () => ({
    hasPendingQuestion: vi.fn(() => false),
    sendMessage: h.sendAgentMessage,
  }),
}));
vi.mock('@/channels/plugins/lark/LarkCards', () => ({
  createMainMenuCard: vi.fn(),
  createErrorRecoveryCard: vi.fn(),
  createToolConfirmationCard: vi.fn(),
}));
vi.mock('@/channels/plugins/lark/LarkAdapter', () => ({ convertHtmlToLarkMarkdown: vi.fn() }));
vi.mock('@/channels/plugins/dingtalk/DingTalkCards', () => ({
  createMainMenuCard: vi.fn(),
  createErrorRecoveryCard: vi.fn(),
  createResponseActionsCard: vi.fn(),
  createToolConfirmationCard: vi.fn(),
}));
vi.mock('@/channels/plugins/dingtalk/DingTalkAdapter', () => ({
  convertHtmlToDingTalkMarkdown: vi.fn(),
  buildDingTalkQuestionMarkdown: vi.fn(),
}));
vi.mock('@/channels/plugins/telegram/TelegramKeyboards', () => ({
  createMainMenuKeyboard: vi.fn(),
  createToolConfirmationKeyboard: vi.fn(),
}));
vi.mock('@/channels/plugins/telegram/TelegramAdapter', () => ({ escapeHtml: vi.fn((text: string) => text) }));
vi.mock('@/channels/gateway/voiceTranscription', () => ({ resolveMediaText: vi.fn() }));

const channelUser = {
  id: 'channel-user-1',
  platformUserId: 'platform-user-1',
  platformType: 'telegram' as const,
  displayName: 'User',
  authorizedAt: 1,
};

const incomingMessage: IUnifiedIncomingMessage = {
  id: 'message-1',
  platform: 'telegram',
  chatId: 'chat-1',
  user: { id: 'platform-user-1', displayName: 'User' },
  content: { type: 'text', text: 'Hello' },
  timestamp: 1,
};

describe('ActionExecutor runtime backend guard', () => {
  const sendMessage = vi.fn(async () => 'message-id');
  const pluginManager = {
    getAllPlugins: () => [
      {
        type: 'telegram',
        sendMessage,
        editMessage: vi.fn(),
      },
    ],
  };
  const pairingService = { isUserAuthorized: vi.fn(() => true) };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.getChannelUserByPlatform.mockReturnValue({ success: true, data: channelUser });
  });

  it('rejects a configured Codex backend before conversation creation', async () => {
    h.processConfigGet.mockResolvedValue({ backend: 'codex' });
    const sessionManager = {
      getSession: vi.fn(() => null),
      createSessionWithConversation: vi.fn(),
    };
    const { ActionExecutor } = await import('@/channels/gateway/ActionExecutor');
    const executor = new ActionExecutor(pluginManager as never, sessionManager as never, pairingService as never);

    await executor.getMessageHandler()(incomingMessage);

    expect(h.createConversation).not.toHaveBeenCalled();
    expect(sessionManager.createSessionWithConversation).not.toHaveBeenCalled();
    expect(h.sendAgentMessage).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('chat-1', expect.objectContaining({ text: '❌ Error processing message: ACP backend codex is disabled' }));
  });

  it('rejects a persisted Codex conversation before sending to the agent', async () => {
    h.getConversation.mockReturnValue({
      success: true,
      data: { id: 'conversation-1', type: 'acp', extra: { backend: 'codex' } },
    });
    const sessionManager = {
      getSession: vi.fn(() => ({
        id: 'session-1',
        userId: channelUser.id,
        agentType: 'acp',
        conversationId: 'conversation-1',
        createdAt: 1,
        lastActivity: 1,
      })),
      createSessionWithConversation: vi.fn(),
    };
    const { ActionExecutor } = await import('@/channels/gateway/ActionExecutor');
    const executor = new ActionExecutor(pluginManager as never, sessionManager as never, pairingService as never);

    await executor.getMessageHandler()(incomingMessage);

    expect(h.processConfigGet).not.toHaveBeenCalled();
    expect(h.createConversation).not.toHaveBeenCalled();
    expect(h.sendAgentMessage).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('chat-1', expect.objectContaining({ text: '❌ Error processing message: ACP backend codex is disabled' }));
  });
});
