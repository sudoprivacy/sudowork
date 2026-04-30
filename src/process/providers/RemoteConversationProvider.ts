/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IConversationProvider, IProviderConfig } from './types';
import type { TChatConversation } from '@/common/storage';
import type { TMessage } from '@/common/chatLib';
import type { ICreateConversationParams, IBridgeResponse, ISendMessageParams } from '@/common/ipcBridge';
import type { AcpModelInfo } from '@/types/acpTypes';
import { getDatabase } from '@process/database';
import WorkerManage from '@process/WorkerManage';
import { initMossApi, type MossSessionApi } from '@process/remote/MossSessionApi';
import { mainLog, mainError } from '@process/utils/mainLogger';
import { uuid } from '@/common/utils';

/**
 * Remote Conversation Provider
 * 远程会话 Provider
 *
 * Manages conversations via Moss Server API.
 * 通过 Moss Server API 管理会话。
 *
 * IMPORTANT: Lazy creation pattern
 * 重要：延迟创建模式
 * - createConversation: Only inserts to local DB, does NOT call Moss API
 *   - createConversation: 只入库，不调用 Moss API
 * - Moss session is created on first sendMessage (via RemoteAgent.initAgent)
 *   - Moss session 在首次 sendMessage 时创建（通过 RemoteAgent.initAgent）
 * - Session list is maintained locally, never calls Moss list API
 *   - 会话列表维护在本地，不调用 Moss 会话列表 API
 *
 * Local database caches conversation metadata (name) for sidebar display.
 * 本地数据库缓存会话元数据（名称）用于侧边栏显示。
 * Messages are stored on Moss Server, not locally.
 * 消息存储在 Moss Server 上，不在本地。
 */
export class RemoteConversationProvider implements IConversationProvider {
  readonly type = 'remote' as const;

  private config: IProviderConfig;
  private mossApi: MossSessionApi | null = null;
  /** Cached model info for conversations (extracted from history messages) */
  /** 缓存的会话模型信息（从历史消息中提取） */
  private cachedModelInfo: Map<string, AcpModelInfo> = new Map();

  constructor(config: IProviderConfig) {
    this.config = config;
  }

  /**
   * Initialize Moss API client with authentication
   * 初始化 Moss API 客户端并进行认证
   */
  private mossApiPromise: Promise<MossSessionApi> | null = null;

  private async ensureMossApi(): Promise<MossSessionApi> {
    // If already initialized and authentication completed, return immediately
    // 如果已经初始化且认证完成，立即返回
    if (this.mossApi) {
      return this.mossApi;
    }

    // If initialization is in progress, wait for it to complete
    // 如果正在初始化，等待完成
    if (this.mossApiPromise) {
      return this.mossApiPromise;
    }

    // Start initialization
    // 开始初始化
    this.mossApiPromise = (async () => {
      const api = initMossApi(this.config.mossServerUrl || 'http://127.0.0.1:43127');
      await api.authenticate(this.config.authToken, this.config.username, this.config.password);
      this.mossApi = api;
      mainLog('RemoteProvider', 'Moss API initialized and authenticated');
      return api;
    })();

    try {
      return await this.mossApiPromise;
    } finally {
      // Clear promise after completion (success or failure)
      // 完成后清除 promise（成功或失败）
      this.mossApiPromise = null;
    }
  }

  // ========== Conversation CRUD / 会话 CRUD ==========

  /**
   * Create conversation - LAZY CREATION PATTERN
   * 创建会话 - 延迟创建模式
   *
   * Only inserts to local database, does NOT call Moss API.
   * 只入库到本地数据库，不调用 Moss API。
   * Moss session is created on first sendMessage.
   * Moss session 在首次发送消息时创建。
   */
  async createConversation(params: ICreateConversationParams): Promise<TChatConversation> {
    mainLog('RemoteProvider', `Creating local conversation record: workspace=${params.extra?.workspace}`);

    // Generate local conversation ID (not Moss session ID yet)
    // 生成本地会话 ID（还不是 Moss session ID）
    // Moss session ID will be assigned on first sendMessage
    // Moss session ID 在首次发送消息时分配
    const localId = params.id || uuid();

    // Build conversation object with local ID
    // 使用本地 ID 构建会话对象
    const conversation: TChatConversation = {
      id: localId,
      name: params.name || 'New Remote Session',
      type: 'remote-agent',
      createTime: Date.now(),
      modifyTime: Date.now(),
      extra: {
        workspace: params.extra?.workspace,
        backend: 'remote-agent',
        mossServerUrl: this.config.mossServerUrl,
        authToken: this.config.authToken,
        runtimeType: this.config.runtimeType,
        agentName: params.extra?.agentName || params.extra?.presetAssistantId,
        presetAssistantId: params.extra?.presetAssistantId,
        dangerouslySkipPermissions: params.extra?.dangerouslySkipPermissions ?? false,
        sessionMode: params.extra?.sessionMode,
        // Mark as pending Moss session creation
        // 标记为待创建 Moss session
        mossSessionPending: true,
      },
      status: 'pending',
      source: 'aionui',
    };

    // Insert to local database first (for sidebar display)
    // 先入库到本地数据库（用于侧边栏显示）
    const db = getDatabase();
    const createResult = db.createConversation(conversation);
    if (!createResult.success) {
      mainError('RemoteProvider', `Failed to create conversation in DB: ${createResult.error}`);
      throw new Error(`Failed to create conversation: ${createResult.error}`);
    }
    mainLog('RemoteProvider', `Conversation inserted to local DB: ${localId}`);

    // Register with WorkerManage (RemoteAgent will create Moss session on first send)
    // 注册到 WorkerManage（RemoteAgent 在首次发送时创建 Moss session）
    WorkerManage.buildConversation(conversation);

    return conversation;
  }

  /**
   * Get conversation - handles both pending and existing Moss sessions
   * 获取会话 - 处理待创建和已存在的 Moss session
   */
  async getConversation(id: string): Promise<TChatConversation | undefined> {
    try {
      const db = getDatabase();

      // Check local cache first
      // 先检查本地缓存
      const existing = db.getConversation(id);
      if (!existing.success || !existing.data) {
        mainLog('RemoteProvider', `Conversation ${id} not found in local DB`);
        return undefined;
      }

      const conversation = existing.data;

      // Extract extra fields
      // 提取 extra 字段
      const extra = existing.data.extra as {
        mossSessionPending?: boolean;
        acpWsUrl?: string;
        mossSessionId?: string;
      };

      // If Moss session is pending OR no Moss session ID exists, return local record
      // 如果 Moss session 待创建 或者 没有 Moss session ID，返回本地记录
      // This handles:
      // 1. New conversations with mossSessionPending: true
      // 2. Existing conversations where Moss session was never created (mossSessionId undefined)
      if (extra?.mossSessionPending || !extra?.mossSessionId) {
        mainLog('RemoteProvider', `Conversation ${id} is pending Moss session creation (pending=${extra?.mossSessionPending}, mossSessionId=${extra?.mossSessionId})`);
        return conversation;
      }

      // Existing Moss session - get wsUrl via resume API
      // 已存在的 Moss session - 通过 resume API 获取 wsUrl
      // Use the actual Moss session ID, not the local conversation ID
      // 使用实际的 Moss session ID，不是本地会话 ID
      const mossSessionId = extra.mossSessionId;
      const api = await this.ensureMossApi();

      // First check session status via GET /api/v1/sessions/:id
      // 先通过 GET /api/v1/sessions/:id 检查 session 状态
      const sessionInfo = await api.getSession(mossSessionId);
      mainLog('RemoteProvider', `Session API response: ${JSON.stringify(sessionInfo)}`);
      const status = sessionInfo.status || sessionInfo.desiredState;

      mainLog('RemoteProvider', `Session ${mossSessionId} status: ${status}`);

      // If session ended/terminated, call resume API to restart
      // 如果 session 已结束，调用 resume API 重启
      if (status === 'ended' || status === 'terminated' || status === 'detached') {
        mainLog('RemoteProvider', `Session ${mossSessionId} ended, resuming...`);
        const resumeResult = await api.resumeSession(mossSessionId);

        // Update conversation with new wsUrl
        // 更新会话的 wsUrl
        const updatedConversation = {
          ...conversation,
          extra: {
            ...conversation.extra,
            acpWsUrl: resumeResult.wsUrl,
            mossSessionPending: false,
          },
          status: 'finished',
        } as TChatConversation;

        db.updateConversation(id, updatedConversation);
        return updatedConversation;
      }

      // Session is active - get wsUrl via GET /api/v1/sessions/:id (attach mode)
      // Session 活跃 - 通过 GET API 获取 wsUrl（attach 模式）
      const wsUrl = sessionInfo.wsUrl || sessionInfo.ws_url;
      if (!wsUrl) {
        // No wsUrl in response, call resume to get one
        // 响应中没有 wsUrl，调用 resume 获取
        const resumeResult = await api.resumeSession(mossSessionId);
        const updatedConversation = {
          ...conversation,
          extra: {
            ...conversation.extra,
            acpWsUrl: resumeResult.wsUrl,
            mossSessionPending: false,
          },
          status: 'finished',
        } as TChatConversation;

        db.updateConversation(id, updatedConversation);
        return updatedConversation;
      }

      // Return conversation with wsUrl
      // 返回带有 wsUrl 的会话
      return {
        ...conversation,
        extra: {
          ...conversation.extra,
          acpWsUrl: wsUrl,
          mossSessionPending: false,
        },
        status: 'finished',
      } as TChatConversation;
    } catch (error) {
      mainError('RemoteProvider', `Failed to get conversation: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  async updateConversation(id: string, updates: Partial<TChatConversation>, mergeExtra?: boolean): Promise<boolean> {
    try {
      const db = getDatabase();

      const existing = db.getConversation(id);
      if (!existing.success || !existing.data) {
        return false;
      }

      let finalUpdates = updates;
      if (mergeExtra && updates.extra && existing.data) {
        finalUpdates = {
          ...updates,
          extra: {
            ...existing.data.extra,
            ...updates.extra,
          },
        } as Partial<TChatConversation>;
      }

      const result = db.updateConversation(id, finalUpdates);
      return result.success;
    } catch (error) {
      mainError('RemoteProvider', 'Failed to update conversation:', error);
      return false;
    }
  }

  async deleteConversation(id: string): Promise<boolean> {
    try {
      const db = getDatabase();

      // Kill local task first
      // 先终止本地任务
      WorkerManage.kill(id);

      const existing = db.getConversation(id);
      const extra = existing.data?.extra as { mossSessionPending?: boolean; mossSessionId?: string } | undefined;

      // Try to terminate Moss session if exists (optional, failure should not block local delete)
      // 尝试终止 Moss session（可选，失败不应阻止本地删除）
      if (existing.success && existing.data && !extra?.mossSessionPending && extra?.mossSessionId) {
        try {
          const api = await this.ensureMossApi();
          await api.terminateSession(extra.mossSessionId);
          mainLog('RemoteProvider', `Terminated Moss session: ${extra.mossSessionId}`);
        } catch (mossError) {
          // Moss Server error - log but continue with local delete
          // Moss Server 错误 - 记录日志但继续本地删除
          mainError('RemoteProvider', `Failed to terminate Moss session (continuing with local delete): ${mossError instanceof Error ? mossError.message : String(mossError)}`);
        }
      }

      // Delete from local database (always attempt this)
      // 从本地数据库删除（始终尝试此操作）
      const result = db.deleteConversation(id);
      if (!result.success) {
        mainError('RemoteProvider', `Failed to delete conversation from local DB: ${result.error}`);
        return false;
      }

      mainLog('RemoteProvider', `Deleted conversation ${id} from local DB`);
      return true;
    } catch (error) {
      mainError('RemoteProvider', 'Failed to delete conversation:', error);
      return false;
    }
  }

  /**
   * List conversations - ONLY from local database, never calls Moss API
   * 列出会话 - 只从本地数据库获取，不调用 Moss API
   */
  async listConversations(page = 0, pageSize = 10000): Promise<TChatConversation[]> {
    const db = getDatabase();
    const result = db.getUserConversations(undefined, page, pageSize);

    if (!result.data || result.data.length === 0) {
      mainLog('RemoteProvider', 'No conversations found in local DB');
      return [];
    }

    // Filter for remote-agent type conversations
    // 只筛选 remote-agent 类型的会话
    const conversations = result.data.filter((c) => c.type === 'remote-agent' || c.extra?.backend === 'remote-agent');

    // Sort by modifyTime
    // 按 modifyTime 排序
    conversations.sort((a, b) => (b.modifyTime || 0) - (a.modifyTime || 0));

    mainLog('RemoteProvider', `Listed ${conversations.length} remote conversations from local DB`);
    return conversations;
  }

  // ========== Messages / 消息 ==========

  /**
   * Get messages from Moss Server
   * 从 Moss Server 获取消息
   */
  async getMessages(conversationId: string, _page = 0, _pageSize = 10000): Promise<TMessage[]> {
    try {
      const db = getDatabase();
      const existing = db.getConversation(conversationId);

      // If session is pending or no Moss session ID, no messages yet
      // 如果 session 待创建 或者 没有 Moss session ID，还没有消息
      const extra = existing.data?.extra as { mossSessionPending?: boolean; mossSessionId?: string } | undefined;
      if (!existing.success || !existing.data || extra?.mossSessionPending || !extra?.mossSessionId) {
        mainLog('RemoteProvider', `Session ${conversationId} is pending or no Moss session ID, no messages`);
        return [];
      }

      // Use the actual Moss session ID for API calls
      // 使用实际的 Moss session ID 进行 API 调用
      const mossSessionId = extra.mossSessionId;
      const api = await this.ensureMossApi();
      const contextData = await api.getSessionContext(mossSessionId);

      mainLog('RemoteProvider', `Session context raw data: ${JSON.stringify(contextData?.context)}`);

      if (!contextData?.context?.messages?.length) {
        mainLog('RemoteProvider', `No messages found for Moss session ${mossSessionId}`);
        return [];
      }

      // Convert Moss messages to TMessage format
      // 将 Moss 消息转换为 TMessage 格式
      // Moss message structure: { type: "user"|"assistant", message: { role, content } }
      // Moss 消息结构：{ type: "user"|"assistant", message: { role, content } }
      const allMessages = contextData.context.messages;
      mainLog('RemoteProvider', `Total messages: ${allMessages.length}, types: ${allMessages.map((m: any) => m.type).join(',')}`);

      const messages: TMessage[] = [];
      let messageIndex = 0;
      let foundModel = '';

      for (const msg of allMessages) {
        const msgType = msg.type;
        const innerRole = msg.message?.role;
        const msgModel = msg.message?.model;

        // Extract model info from the LAST (most recent) assistant message
        // 从最后一条（最近一条）assistant 消息中提取模型信息
        // Update model info from every assistant message (last one wins)
        // 从每条 assistant 消息更新模型信息（最后一条生效）
        if (msgType === 'assistant' && msgModel) {
          foundModel = msgModel;
        }

        // Skip non-user/assistant messages
        // 跳过非 user/assistant 消息
        if (msgType !== 'user' && msgType !== 'assistant' && innerRole !== 'user' && innerRole !== 'assistant') {
          continue;
        }

        const contentArray = msg.message?.content || msg.content || [];
        const timestamp = new Date(msg.timestamp || Date.now()).getTime();
        const isError = msg.error || msg.isApiErrorMessage;
        const msgRole = msgType || innerRole || 'unknown';

        // Handle error messages
        // 处理错误消息
        if (isError && msgRole === 'assistant') {
          const errorText = Array.isArray(contentArray)
            ? contentArray
                .filter((c: any) => c?.type === 'text')
                .map((c: any) => c.text || '')
                .join('\n')
            : typeof contentArray === 'string' ? contentArray : '';
          messages.push({
            id: `${conversationId}-${messageIndex++}`,
            conversation_id: conversationId,
            type: 'tips',
            position: 'left',
            content: { content: errorText || msg.error || 'Unknown error', type: 'error' },
            create_time: timestamp,
            status: 'finished',
          } as unknown as TMessage);
          continue;
        }

        // User messages: process each content block
        // 用户消息：处理每个 content block
        if (msgRole === 'user' && Array.isArray(contentArray)) {
          for (const block of contentArray) {
            if (block?.type === 'text') {
              // text block → text message
              // text block → text 消息
              const textContent = block.text || '';
              if (textContent && textContent.trim()) {
                messages.push({
                  id: `${conversationId}-${messageIndex++}`,
                  conversation_id: conversationId,
                  type: 'text',
                  role: 'user',
                  position: 'right',
                  content: { content: textContent },
                  create_time: timestamp,
                  status: 'finished',
                } as unknown as TMessage);
              }
            } else if (block?.type === 'tool_result') {
              // tool_result block → update tool call status or error tips
              // tool_result block → 更新工具调用状态或错误提示
              const toolUseId = block.tool_use_id || block.toolCallId;
              const isError = block.is_error;
              const resultContent = block.content || '';

              if (isError) {
                // Tool execution failed → tips message with error
                // 工具执行失败 → 错误提示消息
                messages.push({
                  id: `${conversationId}-${messageIndex++}`,
                  msg_id: toolUseId,
                  conversation_id: conversationId,
                  type: 'tips',
                  position: 'left',
                  content: { content: resultContent || 'Tool execution failed', type: 'error' },
                  create_time: timestamp,
                  status: 'finished',
                } as unknown as TMessage);
              } else {
                // Tool execution success → update tool call status to completed
                // 工具执行成功 → 更新工具调用状态为 completed
                // Note: This creates a separate message; frontend will merge by toolCallId
                // 注意：这会创建独立消息；前端会根据 toolCallId 合并
                messages.push({
                  id: `${conversationId}-${messageIndex++}`,
                  msg_id: toolUseId,
                  conversation_id: conversationId,
                  type: 'acp_tool_call',
                  position: 'left',
                  content: {
                    sessionId: mossSessionId,
                    update: {
                      sessionUpdate: 'tool_call_update',
                      toolCallId: toolUseId,
                      status: 'completed',
                      content: [{ type: 'content', content: { type: 'text', text: resultContent } }],
                    },
                  },
                  create_time: timestamp,
                  status: 'finished',
                } as unknown as TMessage);
              }
            }
          }
          continue;
        }

        // Fallback: User messages with simple text content
        // 后备处理：用户消息的简单文本内容
        if (msgRole === 'user') {
          const textContent = Array.isArray(contentArray)
            ? contentArray
                .filter((c: any) => c?.type === 'text')
                .map((c: any) => c.text || '')
                .join('\n')
            : typeof contentArray === 'string' ? contentArray : '';
          if (textContent && textContent.trim()) {
            messages.push({
              id: `${conversationId}-${messageIndex++}`,
              conversation_id: conversationId,
              type: 'text',
              role: 'user',
              position: 'right',
              content: { content: textContent },
              create_time: timestamp,
              status: 'finished',
            } as unknown as TMessage);
          }
          continue;
        }

        // Assistant messages: process each content block separately
        // Assistant 消息：分别处理每个 content block
        if (msgRole === 'assistant' && Array.isArray(contentArray)) {
          for (const block of contentArray) {
            if (block?.type === 'thinking') {
              // thinking block → skip, same as realtime transformMessage
              // thinking block → 跳过，与实时消息 transformMessage 处理一致
              // thinking 内容不显示在 UI 中
              // thinking content is not displayed in UI
              // Do nothing, skip this block
            } else if (block?.type === 'text') {
              // text block → text message
              // text block → text 消息
              const textContent = block.text || '';
              if (textContent && textContent.trim()) {
                messages.push({
                  id: `${conversationId}-${messageIndex++}`,
                  conversation_id: conversationId,
                  type: 'text',
                  role: 'assistant',
                  position: 'left',
                  content: { content: textContent },
                  create_time: timestamp,
                  status: 'finished',
                } as unknown as TMessage);
              }
            } else if (block?.type === 'tool_use') {
              // tool_use block → acp_tool_call message
              // Must use ToolCallUpdate format with 'update' property
              // tool_use block → acp_tool_call 消息，必须使用 ToolCallUpdate 格式（包含 update 属性）
              messages.push({
                id: `${conversationId}-${messageIndex++}`,
                msg_id: block.id || `${conversationId}-${messageIndex}`,
                conversation_id: conversationId,
                type: 'acp_tool_call',
                position: 'left',
                content: {
                  sessionId: mossSessionId,
                  update: {
                    sessionUpdate: 'tool_call',
                    toolCallId: block.id || `${conversationId}-${messageIndex}`,
                    status: 'completed',
                    title: block.name,
                    kind: 'execute',
                    rawInput: block.input,
                    content: [],
                  },
                },
                create_time: timestamp,
                status: 'finished',
              } as unknown as TMessage);
            }
          }
        } else if (msgRole === 'assistant') {
          // Fallback: handle string content
          // 后备处理：字符串内容
          const textContent = typeof contentArray === 'string' ? contentArray : '';
          if (textContent && textContent.trim()) {
            messages.push({
              id: `${conversationId}-${messageIndex++}`,
              conversation_id: conversationId,
              type: 'text',
              role: 'assistant',
              position: 'left',
              content: { content: textContent },
              create_time: timestamp,
              status: 'finished',
            } as unknown as TMessage);
          }
        }
      }

      // Store model info for getModelInfo API (not as TMessage)
      // 存储模型信息供 getModelInfo API 使用（不作为 TMessage）
      // Note: Model info is sent via acp_model_info message type during realtime streaming
      // 注意：实时流式消息时通过 acp_model_info 消息类型发送
      if (foundModel) {
        // Cache model info for this conversation (will be returned by getModelInfo)
        // 缓存此会话的模型信息（由 getModelInfo 返回）
        this.cachedModelInfo.set(conversationId, {
          source: 'models',
          currentModelId: foundModel,
          currentModelLabel: foundModel,
          canSwitch: false,
          availableModels: [],
        });
      }

      mainLog('RemoteProvider', `Loaded ${messages.length} messages from Moss for session ${mossSessionId}`);
      return messages;
    } catch (error) {
      mainError('RemoteProvider', `Failed to get messages: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  async sendMessage(params: ISendMessageParams): Promise<IBridgeResponse> {
    try {
      const task = await WorkerManage.getTaskByIdRollbackBuild(params.conversation_id);
      if (!task) {
        return { success: false, msg: 'conversation not found' };
      }

      await task.sendMessage({
        content: params.input,
        files: params.files,
        msg_id: params.msg_id,
      });

      return { success: true };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  }

  async stop(conversationId: string): Promise<IBridgeResponse> {
    try {
      const task = WorkerManage.getTaskById(conversationId);
      if (!task) {
        return { success: true, msg: 'conversation not found' };
      }
      await task.stop();
      return { success: true };
    } catch (error) {
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Update conversation after Moss session is created
   * Moss session 创建后更新会话
   *
   * Called by RemoteAgent after successful Moss session creation
   * 由 RemoteAgent 在成功创建 Moss session 后调用
   */
  async updateMossSessionInfo(localConversationId: string, mossSessionId: string, wsUrl: string, sessionData: any): Promise<boolean> {
    try {
      const db = getDatabase();

      // Update conversation ID to Moss session ID
      // 将会话 ID 更新为 Moss session ID
      // Note: This may require updating the database primary key
      // 注意：这可能需要更新数据库主键

      // For now, we keep local ID but update extra with Moss session info
      // 暂时保持本地 ID，但在 extra 中更新 Moss session 信息
      const existing = db.getConversation(localConversationId);
      if (!existing.success || !existing.data) {
        mainError('RemoteProvider', `Conversation ${localConversationId} not found for Moss session update`);
        return false;
      }

      const updatedConversation = {
        ...existing.data,
        // Optionally update ID to Moss session ID (requires special handling)
        // 可选：将 ID 更新为 Moss session ID（需要特殊处理）
        // id: mossSessionId,
        extra: {
          ...existing.data.extra,
          mossSessionId,
          acpWsUrl: wsUrl,
          mossSessionPending: false,
          workspace: sessionData.workDir || sessionData.work_dir,
          agentName: sessionData.assistantName || sessionData.assistant_name,
        },
        status: 'finished',
        modifyTime: Date.now(),
      } as TChatConversation;

      const result = db.updateConversation(localConversationId, updatedConversation);
      mainLog('RemoteProvider', `Updated conversation ${localConversationId} with Moss session info`);
      return result.success;
    } catch (error) {
      mainError('RemoteProvider', `Failed to update Moss session info: ${error}`);
      return false;
    }
  }

  /**
   * Get cached model info for a conversation
   * 获取会话的缓存模型信息
   *
   * Model info is extracted from history messages (last assistant message's model field)
   * 模型信息从历史消息中提取（最后一条 assistant 消息的 model 字段）
   * If cache is empty, fetches from Moss API and caches the result
   * 如果缓存为空，从 Moss API 获取并缓存结果
   */
  async getCachedModelInfo(conversationId: string): Promise<AcpModelInfo | null> {
    // Check cache first
    // 先检查缓存
    const cached = this.cachedModelInfo.get(conversationId);
    if (cached) {
      return cached;
    }

    // Cache is empty, fetch from Moss API
    // 缓存为空，从 Moss API 获取
    try {
      const db = getDatabase();
      const existing = db.getConversation(conversationId);
      const extra = existing.data?.extra as { mossSessionId?: string } | undefined;

      if (!existing.success || !existing.data || !extra?.mossSessionId) {
        return null;
      }

      const mossSessionId = extra.mossSessionId;
      const api = await this.ensureMossApi();
      const contextData = await api.getSessionContext(mossSessionId);

      if (!contextData?.context?.messages?.length) {
        return null;
      }

      // Find last assistant message's model
      // 找到最后一条 assistant 消息的模型
      let foundModel = '';
      for (const msg of contextData.context.messages) {
        if (msg.type === 'assistant' && msg.message?.model) {
          foundModel = msg.message.model;
        }
      }

      if (foundModel) {
        const modelInfo: AcpModelInfo = {
          source: 'models',
          currentModelId: foundModel,
          currentModelLabel: foundModel,
          canSwitch: false,
          availableModels: [],
        };
        // Cache for future use
        // 缓存供后续使用
        this.cachedModelInfo.set(conversationId, modelInfo);
        return modelInfo;
      }

      return null;
    } catch (error) {
      mainError('RemoteProvider', `Failed to get model info: ${error}`);
      return null;
    }
  }
}

export default RemoteConversationProvider;
