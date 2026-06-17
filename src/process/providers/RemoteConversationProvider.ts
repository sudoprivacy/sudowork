/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDatabase } from '@process/database';
import WorkerManage from '@process/WorkerManage';
import { initMossApi, type MossSessionApi } from '@process/remote/MossSessionApi';
import { mainLog, mainError } from '@process/utils/mainLogger';
import { ProcessConfig } from '@process/initStorage';
import type { IConversationProvider, IProviderConfig } from './types';
import type { TChatConversation } from '@/common/storage';
import type { TMessage } from '@/common/chatLib';
import type { ICreateConversationParams, IBridgeResponse, ISendMessageParams } from '@/common/ipcBridge';
import type { AcpModelInfo } from '@/types/acpTypes';
import { uuid } from '@/common/utils';
import { isRemoteContainerPath } from '@/common/utils/workspaceSkillSync';

const HIDDEN_CRON_SESSIONS_KEY = 'remote.hiddenCronSessionIds';

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
   * Initialize Moss API client with JWT access token
   * 初始化 Moss API 客户端并设置 JWT access token
   *
   * Uses sudoclaw JWT token directly as Bearer token for authentication.
   * 直接使用 sudoclaw JWT token 作为 Bearer token 进行认证。
   * No need to convert API-KEY to auth-token.
   * 无需将 API-KEY 转换为 auth-token。
   */
  private mossApiPromise: Promise<MossSessionApi> | null = null;

  private async ensureMossApi(): Promise<MossSessionApi> {
    // If already initialized, return immediately
    // 如果已经初始化，立即返回
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
      // Moss Server URL must be configured in enterprise settings
      // Moss Server URL 必须在企业设置中配置
      // Do NOT use hardcoded default value - read from enterprise config instead
      // 不使用硬编码默认值 - 从企业配置读取
      if (!this.config.mossServerUrl) {
        throw new Error('Moss Server URL not configured. Please configure server URL in enterprise settings.');
      }

      const api = initMossApi(this.config.mossServerUrl);

      // Set the JWT access token directly, no conversion needed
      // 直接设置 JWT access token，无需转换
      if (this.config.authToken) {
        api.setAccessToken(this.config.authToken);
      }

      // Ensure the token is valid, triggering a refresh if needed
      // If authToken was empty, getValidToken will attempt to refresh from ProcessConfig
      await api.ensureAuthenticated();

      this.mossApi = api;
      mainLog('RemoteProvider', 'Moss API initialized with JWT token');
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
        // Deliberately no authToken here: persisted session tokens outlive
        // logins and resurface revoked (issue #849). Connections always read
        // the current auth storage instead.
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
   * Get conversation - LOCAL-FIRST approach
   * 获取会话 - 本地优先策略
   *
   * Returns local DB record immediately without blocking on Moss Server API calls.
   * Moss Server connection (resume/attach) is deferred to when the user actually
   * sends a message, avoiding white screen when Moss Server is unavailable.
   *
   * 立即返回本地数据库记录，不阻塞等待 Moss Server API 调用。
   * Moss Server 连接（resume/attach）延迟到用户实际发送消息时，
   * 避免 Moss Server 不可用时白屏。
   */
  async getConversation(id: string): Promise<TChatConversation | undefined> {
    try {
      const db = getDatabase();

      const existing = db.getConversation(id);
      if (!existing.success || !existing.data) {
        mainLog('RemoteProvider', `Conversation ${id} not found in local DB`);
        return undefined;
      }

      const conversation = existing.data;
      return conversation;
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
      const mossSessionId = extra?.mossSessionId || (existing.success && existing.data ? existing.data.id : id);
      const isCronSession = !!(existing.data?.extra as { cronJobId?: string } | undefined)?.cronJobId;

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

      if (isCronSession && mossSessionId) {
        await this.hideCronSession(mossSessionId);
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

  private async hideCronSession(mossSessionId: string): Promise<void> {
    try {
      const hidden = ((await ProcessConfig.get(HIDDEN_CRON_SESSIONS_KEY)) || {}) as Record<string, number>;
      hidden[mossSessionId] = Date.now();
      await ProcessConfig.set(HIDDEN_CRON_SESSIONS_KEY, hidden);
    } catch (error) {
      mainError('RemoteProvider', `Failed to remember hidden cron session ${mossSessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private isCronSessionHidden(mossSessionId: string): boolean {
    const hidden = (ProcessConfig.getSync(HIDDEN_CRON_SESSIONS_KEY) || {}) as Record<string, number>;
    return Object.prototype.hasOwnProperty.call(hidden, mossSessionId);
  }

  /**
   * List conversations - ONLY from local database, never calls Moss API
   * 列出会话 - 只从本地数据库获取，不调用 Moss API
   */
  async listConversations(page = 0, pageSize = 10000): Promise<TChatConversation[]> {
    const db = getDatabase();
    await this.syncCronSessions().catch((error) => {
      mainError('RemoteProvider', `Failed to sync cron sessions: ${error instanceof Error ? error.message : String(error)}`);
    });
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

    return conversations;
  }

  private parseCronSource(source?: string): { cronJobId?: string; cronJobName?: string; cronRunId?: string } | null {
    if (!source) return null;
    try {
      const data = JSON.parse(source) as { source?: string; cronJobId?: string; cronJobName?: string; cronRunId?: string };
      if (data.source !== 'cron' || !data.cronJobId) return null;
      return data;
    } catch {
      return null;
    }
  }

  private findLocalConversationByMossSessionId(mossSessionId: string): TChatConversation | null {
    const db = getDatabase();
    const direct = db.getConversation(mossSessionId);
    if (direct.success && direct.data) {
      return direct.data;
    }

    const conversations = db.getUserConversations(undefined, 0, 10000);
    return (
      conversations.data?.find((conversation) => {
        const extra = conversation.extra as { mossSessionId?: string } | undefined;
        return extra?.mossSessionId === mossSessionId;
      }) ?? null
    );
  }

  private async syncCronSessions(): Promise<void> {
    const api = await this.ensureMossApi();
    const sessions = await api.listSessions({ source: 'cron' });
    if (sessions.length === 0) return;

    const db = getDatabase();
    for (const session of sessions) {
      const mossSessionId = session.sessionId || session.session_id;
      if (!mossSessionId) continue;

      const cronSource = this.parseCronSource(session.source);
      if (!cronSource?.cronJobId) continue;
      if (this.isCronSessionHidden(mossSessionId)) continue;

      const existingConversation = this.findLocalConversationByMossSessionId(mossSessionId);
      const now = Date.now();
      const modifyTime = session.lastActiveAt || session.last_active_at || session.updatedAt || session.updated_at || now;
      const createTime = existingConversation?.createTime || session.createdAt || session.created_at || modifyTime;
      const existingExtra = existingConversation?.extra as Record<string, unknown> | undefined;

      // Extract Moss workDir (remote container path)
      const mossWorkDir = session.workDir || session.work_dir || session.cwd;

      // Check if workDir is a remote container path
      const isRemotePath = isRemoteContainerPath(mossWorkDir);

      // Build extra - save remote paths to mossWorkDir, preserve existing workspace
      const extra: Record<string, unknown> = {
        ...existingExtra,
        backend: 'remote-agent',
        mossServerUrl: this.config.mossServerUrl,
        // Scrub any legacy pinned token from existing records — persisted
        // session tokens outlive logins and resurface revoked (issue #849).
        authToken: undefined,
        runtimeType: this.config.runtimeType,
        agentName: session.assistantName || session.assistant_name,
        sessionMode: 'remote',
        mossSessionId,
        mossSessionPending: false,
        mossSessionUpdatedAt: modifyTime,
        cronJobId: cronSource.cronJobId,
        cronJobName: cronSource.cronJobName,
        cronRunId: cronSource.cronRunId,
      };

      if (isRemotePath) {
        // Remote container path - save to mossWorkDir, preserve existing workspace
        extra.mossWorkDir = mossWorkDir;
        // Preserve existing workspace if present
        if (existingExtra?.workspace) {
          extra.workspace = existingExtra.workspace;
        }
      } else if (mossWorkDir) {
        // Local path - safe to set as workspace
        extra.workspace = mossWorkDir;
      } else if (existingExtra?.workspace) {
        // No new workDir, preserve existing workspace
        extra.workspace = existingExtra.workspace;
      }

      const conversation: TChatConversation = {
        id: existingConversation?.id || mossSessionId,
        name: existingConversation?.name || this.formatCronSessionTitle(cronSource.cronJobName, createTime),
        type: 'remote-agent',
        createTime,
        modifyTime,
        status: session.status === 'ended' || session.status === 'terminated' ? 'finished' : 'running',
        source: 'aionui',
        extra,
      };

      if (existingConversation) {
        void db.updateConversation(existingConversation.id, {
          modifyTime: conversation.modifyTime,
          status: conversation.status,
          extra: conversation.extra,
        });
      } else {
        void db.createConversation(conversation);
      }
    }
  }

  private formatCronSessionTitle(jobName: string | undefined, timestamp: number): string {
    const name = jobName || 'Cron Session';
    const date = new Date(timestamp || Date.now());
    const runTime = date
      .toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      .replace(/\//g, '-');
    return `${name} ${runTime}`;
  }

  // ========== Messages / 消息 ==========

  /**
   * Convert Moss Server messages to TMessage format (reusable)
   * 将 Moss Server 消息转换为 TMessage 格式（可复用）
   */
  private convertMossMessagesToTMessages(allMessages: any[], conversationId: string, mossSessionId: string): { messages: TMessage[]; foundModel: string } {
    const messages: TMessage[] = [];
    const finishedMessageStatus = 'finish';
    let messageIndex = 0;
    let foundModel = '';

    for (const msg of allMessages) {
      const msgType = msg.type;
      const innerRole = msg.message?.role;
      const msgModel = msg.message?.model;
      const timestamp = new Date(msg.timestamp || Date.now()).getTime();

      if (msgType === 'assistant' && msgModel) {
        foundModel = msgModel;
      }

      if (msgType === 'tool_use') {
        const toolCallId = msg.tool_use_id || msg.id || msg.uuid || `${conversationId}-${messageIndex}`;
        const responseToolCallId = msg.uuid || toolCallId;
        const toolName = msg.name || 'Tool';
        const rawInput = this.parseMossToolInput(msg.input);

        if (toolName === 'AskUserQuestion') {
          const question = typeof rawInput.question === 'string' ? rawInput.question : '';
          const description = typeof rawInput.description === 'string' ? rawInput.description : undefined;
          const options = Array.isArray(rawInput.options) ? rawInput.options.filter((option): option is string => typeof option === 'string') : [];

          messages.push({
            id: `${conversationId}-${messageIndex++}`,
            msg_id: toolCallId,
            conversation_id: conversationId,
            type: 'acp_question',
            position: 'left',
            content: {
              question,
              intro: description,
              options,
              conversationId,
              toolCallId,
              responseToolCallId,
            },
            create_time: timestamp,
            status: finishedMessageStatus,
          } as unknown as TMessage);
        } else {
          messages.push({
            id: `${conversationId}-${messageIndex++}`,
            msg_id: toolCallId,
            conversation_id: conversationId,
            type: 'acp_tool_call',
            position: 'left',
            content: {
              sessionId: mossSessionId,
              update: {
                sessionUpdate: 'tool_call',
                toolCallId,
                status: 'completed',
                title: toolName,
                kind: this.getMossToolKind(toolName),
                rawInput,
                content: [],
              },
            },
            create_time: timestamp,
            status: finishedMessageStatus,
          } as unknown as TMessage);
        }
        continue;
      }

      if (msgType !== 'user' && msgType !== 'assistant' && innerRole !== 'user' && innerRole !== 'assistant') {
        continue;
      }

      const contentArray = msg.message?.content || msg.content || [];
      const isError = msg.error || msg.isApiErrorMessage;
      const msgRole = msgType || innerRole || 'unknown';

      if (isError && msgRole === 'assistant') {
        const errorText = Array.isArray(contentArray)
          ? contentArray
              .filter((c: any) => c?.type === 'text')
              .map((c: any) => c.text || '')
              .join('\n')
          : typeof contentArray === 'string'
            ? contentArray
            : '';
        messages.push({
          id: `${conversationId}-${messageIndex++}`,
          conversation_id: conversationId,
          type: 'tips',
          position: 'left',
          content: { content: errorText || msg.error || 'Unknown error', type: 'error' },
          create_time: timestamp,
          status: finishedMessageStatus,
        } as unknown as TMessage);
        continue;
      }

      if (msgRole === 'user' && Array.isArray(contentArray)) {
        for (const block of contentArray) {
          if (block?.type === 'text') {
            const textContent = this.extractDisplayUserContent(block.text || '');
            if (textContent && textContent.trim()) {
              messages.push({
                id: `${conversationId}-${messageIndex++}`,
                conversation_id: conversationId,
                type: 'text',
                role: 'user',
                position: 'right',
                content: { content: textContent },
                create_time: timestamp,
                status: finishedMessageStatus,
              } as unknown as TMessage);
            }
          } else if (block?.type === 'tool_result') {
            const toolUseId = block.tool_use_id || block.toolCallId;
            const isError = block.is_error;
            const resultContent = block.content || '';

            if (isError) {
              messages.push({
                id: `${conversationId}-${messageIndex++}`,
                msg_id: toolUseId,
                conversation_id: conversationId,
                type: 'tips',
                position: 'left',
                content: { content: resultContent || 'Tool execution failed', type: 'error' },
                create_time: timestamp,
                status: finishedMessageStatus,
              } as unknown as TMessage);
            } else {
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
                status: finishedMessageStatus,
              } as unknown as TMessage);
            }
          }
        }
        continue;
      }

      if (msgRole === 'user') {
        const textContent = Array.isArray(contentArray)
          ? contentArray
              .filter((c: any) => c?.type === 'text')
              .map((c: any) => c.text || '')
              .join('\n')
          : typeof contentArray === 'string'
            ? contentArray
            : '';
        const displayText = this.extractDisplayUserContent(textContent);
        if (displayText && displayText.trim()) {
          messages.push({
            id: `${conversationId}-${messageIndex++}`,
            conversation_id: conversationId,
            type: 'text',
            role: 'user',
            position: 'right',
            content: { content: displayText },
            create_time: timestamp,
            status: finishedMessageStatus,
          } as unknown as TMessage);
        }
        continue;
      }

      if (msgRole === 'assistant' && Array.isArray(contentArray)) {
        for (const block of contentArray) {
          if (block?.type === 'thinking') {
            // thinking content is not displayed in UI
          } else if (block?.type === 'text') {
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
                status: finishedMessageStatus,
              } as unknown as TMessage);
            }
          } else if (block?.type === 'tool_use') {
            const toolCallId = block.id || `${conversationId}-${messageIndex}`;
            const responseToolCallId = block.uuid || toolCallId;
            const rawInput = this.parseMossToolInput(block.input);
            if (block.name === 'AskUserQuestion') {
              const question = typeof rawInput.question === 'string' ? rawInput.question : '';
              const description = typeof rawInput.description === 'string' ? rawInput.description : undefined;
              const options = Array.isArray(rawInput.options) ? rawInput.options.filter((option): option is string => typeof option === 'string') : [];

              messages.push({
                id: `${conversationId}-${messageIndex++}`,
                msg_id: toolCallId,
                conversation_id: conversationId,
                type: 'acp_question',
                position: 'left',
                content: {
                  question,
                  intro: description,
                  options,
                  conversationId,
                  toolCallId,
                  responseToolCallId,
                },
                create_time: timestamp,
                status: finishedMessageStatus,
              } as unknown as TMessage);
            } else {
              messages.push({
                id: `${conversationId}-${messageIndex++}`,
                msg_id: toolCallId,
                conversation_id: conversationId,
                type: 'acp_tool_call',
                position: 'left',
                content: {
                  sessionId: mossSessionId,
                  update: {
                    sessionUpdate: 'tool_call',
                    toolCallId,
                    status: 'completed',
                    title: block.name,
                    kind: this.getMossToolKind(block.name || ''),
                    rawInput,
                    content: [],
                  },
                },
                create_time: timestamp,
                status: finishedMessageStatus,
              } as unknown as TMessage);
            }
          }
        }
      } else if (msgRole === 'assistant') {
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
            status: finishedMessageStatus,
          } as unknown as TMessage);
        }
      }
    }

    return { messages, foundModel };
  }

  private parseMossToolInput(input: unknown): Record<string, unknown> {
    if (!input) return {};
    if (typeof input === 'string') {
      try {
        const parsed = JSON.parse(input);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      } catch {
        return { input };
      }
    }
    return typeof input === 'object' ? (input as Record<string, unknown>) : { input };
  }

  private extractDisplayUserContent(content: string): string {
    let userContent = content;
    if (userContent.includes('[User Request]')) {
      const parts = userContent.split('[User Request]');
      userContent = parts[parts.length - 1]?.trim() || userContent;
    }
    return userContent;
  }

  private getMossToolKind(toolName: string): 'read' | 'edit' | 'execute' {
    const normalized = toolName.toLowerCase();
    if (normalized.includes('read')) return 'read';
    if (normalized.includes('write') || normalized.includes('edit') || normalized.includes('patch')) return 'edit';
    return 'execute';
  }

  /**
   * Get messages - LOCAL-FIRST approach
   * 获取消息 - 本地优先策略
   *
   * 1. Check local DB first → return if messages exist (fast, offline-capable)
   * 2. If no local messages AND mossSessionId available → try Moss Server, save locally, return
   * 3. If mossSessionPending or no mossSessionId → return empty
   * 4. If Moss Server unavailable → log only, return empty (no throw)
   */
  async getMessages(conversationId: string, _page = 0, _pageSize = 10000): Promise<TMessage[]> {
    try {
      const db = getDatabase();
      const existing = db.getConversation(conversationId);

      const extra = existing.data?.extra as { mossSessionPending?: boolean; mossSessionId?: string } | undefined;
      if (!existing.success || !existing.data || extra?.mossSessionPending || !extra?.mossSessionId) {
        return [];
      }

      // 1. Check local DB first / 先检查本地数据库
      const localMessages = db.getConversationMessages(conversationId, 0, 10000);
      if (localMessages.data && localMessages.data.length > 0) {
        return localMessages.data;
      }

      // 2. No local messages - try Moss Server and save locally
      // 没有本地消息 - 尝试从 Moss Server 获取并保存到本地
      const mossSessionId = extra.mossSessionId;
      try {
        const api = await this.ensureMossApi();
        const contextData = await api.getSessionContext(mossSessionId);

        if (!contextData?.context?.messages?.length) {
          return [];
        }

        const allMessages = contextData.context.messages;
        const { messages, foundModel } = this.convertMossMessagesToTMessages(allMessages, conversationId, mossSessionId);

        // Save to local DB for future local-first reads / 保存到本地数据库供后续本地优先读取
        let insertedCount = 0;
        for (const msg of messages) {
          try {
            const insertResult = db.insertMessage(msg);
            if (insertResult?.success === false) {
              mainError('RemoteProvider', `Failed to insert message to local DB: ${insertResult.error ?? 'unknown error'}`);
            } else {
              insertedCount++;
            }
          } catch (insertErr) {
            mainError('RemoteProvider', `Failed to insert message to local DB: ${insertErr}`);
          }
        }
        mainLog('RemoteProvider', `Saved ${insertedCount}/${messages.length} messages to local DB from Moss session ${mossSessionId}`);

        if (foundModel) {
          this.cachedModelInfo.set(conversationId, {
            source: 'models',
            currentModelId: foundModel,
            currentModelLabel: foundModel,
            canSwitch: false,
            availableModels: [],
          });
        }

        // Sync customTitle from Moss Server if available / 同步 Moss Server 的 customTitle
        const customTitle = contextData.context?.customTitle;
        if (customTitle && existing.data.name !== customTitle) {
          db.updateConversation(conversationId, { name: customTitle } as Partial<TChatConversation>);
        }

        return messages;
      } catch (mossError) {
        // Moss Server unavailable - log only, don't throw / Moss Server 不可用 - 仅记录日志，不抛出
        mainLog('RemoteProvider', `Moss Server unavailable for getMessages, conversation ${conversationId}: ${mossError instanceof Error ? mossError.message : String(mossError)}`);
        return [];
      }
    } catch (error) {
      mainLog('RemoteProvider', `Failed to get messages for ${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Sync messages from Moss Server to local DB
   * 从 Moss Server 同步消息到本地数据库
   *
   * Called when user clicks on a history conversation to ensure local data is up-to-date.
   * 当用户点击历史会话时调用，确保本地数据是最新的。
   *
   * 1. Fetch messages from Moss Server via getSessionContext API
   * 2. Clear existing local messages (avoid duplicates)
   * 3. Insert all converted messages to local DB
   * 4. Sync conversation name from Moss Server's customTitle
   * 5. Update mossSessionUpdatedAt timestamp
   */
  async syncFromMossServer(conversationId: string): Promise<{ syncedCount: number; nameUpdated: boolean }> {
    try {
      const db = getDatabase();
      const existing = db.getConversation(conversationId);

      if (!existing.success || !existing.data) {
        mainLog('RemoteProvider', `Conversation ${conversationId} not found for sync`);
        return { syncedCount: 0, nameUpdated: false };
      }

      const extra = existing.data.extra as { mossSessionPending?: boolean; mossSessionId?: string } | undefined;
      if (extra?.mossSessionPending || !extra?.mossSessionId) {
        mainLog('RemoteProvider', `Conversation ${conversationId} is pending or no Moss session ID, skip sync`);
        return { syncedCount: 0, nameUpdated: false };
      }

      const mossSessionId = extra.mossSessionId;
      const api = await this.ensureMossApi();
      const contextData = await api.getSessionContext(mossSessionId);

      if (!contextData?.context?.messages?.length) {
        mainLog('RemoteProvider', `No messages found for Moss session ${mossSessionId} during sync`);
        return { syncedCount: 0, nameUpdated: false };
      }

      const allMessages = contextData.context.messages;
      const { messages, foundModel } = this.convertMossMessagesToTMessages(allMessages, conversationId, mossSessionId);

      // Clear existing local messages to avoid duplicates / 清除现有本地消息避免重复
      db.deleteConversationMessages(conversationId);

      // Insert all converted messages / 插入所有转换后的消息
      let insertedCount = 0;
      for (const msg of messages) {
        try {
          const insertResult = db.insertMessage(msg);
          if (insertResult?.success === false) {
            mainError('RemoteProvider', `Failed to insert message during sync: ${insertResult.error ?? 'unknown error'}`);
          } else {
            insertedCount++;
          }
        } catch (insertErr) {
          mainError('RemoteProvider', `Failed to insert message during sync: ${insertErr}`);
        }
      }

      // Update model info cache / 更新模型信息缓存
      if (foundModel) {
        this.cachedModelInfo.set(conversationId, {
          source: 'models',
          currentModelId: foundModel,
          currentModelLabel: foundModel,
          canSwitch: false,
          availableModels: [],
        });
      }

      // Sync customTitle from Moss Server / 同步 Moss Server 的 customTitle
      let nameUpdated = false;
      const customTitle = contextData.context?.customTitle;
      if (customTitle && existing.data.name !== customTitle) {
        db.updateConversation(conversationId, {
          name: customTitle,
          extra: {
            ...existing.data.extra,
            mossSessionUpdatedAt: Date.now(),
          },
        } as Partial<TChatConversation>);
        nameUpdated = true;
        mainLog('RemoteProvider', `Synced conversation name from Moss Server: "${existing.data.name}" → "${customTitle}"`);
      } else {
        // Update mossSessionUpdatedAt timestamp only / 仅更新时间戳
        db.updateConversation(conversationId, {
          extra: {
            ...existing.data.extra,
            mossSessionUpdatedAt: Date.now(),
          },
        } as Partial<TChatConversation>);
      }

      mainLog('RemoteProvider', `Synced ${insertedCount}/${messages.length} messages from Moss Server for session ${mossSessionId}`);
      return { syncedCount: insertedCount, nameUpdated };
    } catch (error) {
      mainError('RemoteProvider', `Failed to sync from Moss Server: ${error instanceof Error ? error.message : String(error)}`);
      return { syncedCount: 0, nameUpdated: false };
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

      // Extract Moss workDir (remote container path)
      const mossWorkDir = sessionData.workDir || sessionData.work_dir;

      // Check if workDir is a remote container path
      const isRemotePath = isRemoteContainerPath(mossWorkDir);

      // Build extra update - save remote paths to mossWorkDir, not workspace
      const extraUpdate: Record<string, unknown> = {
        ...existing.data.extra,
        mossSessionId,
        acpWsUrl: wsUrl,
        mossSessionPending: false,
        agentName: sessionData.assistantName || sessionData.assistant_name,
      };

      if (isRemotePath) {
        // Remote container path - save to mossWorkDir, preserve existing workspace
        extraUpdate.mossWorkDir = mossWorkDir;
        // Do NOT overwrite workspace with remote path
      } else if (mossWorkDir && !existing.data.extra?.workspace) {
        // Local path and no existing workspace - safe to set
        extraUpdate.workspace = mossWorkDir;
      }

      const updatedConversation = {
        ...existing.data,
        // Optionally update ID to Moss session ID (requires special handling)
        // 可选：将 ID 更新为 Moss session ID（需要特殊处理）
        // id: mossSessionId,
        extra: extraUpdate,
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
