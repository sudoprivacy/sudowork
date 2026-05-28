/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import BaseAgent from './BaseAgent';
import { MossWsConnection, type MossWsConnectionConfig, type MossWsCallbacks } from '@/agent/remote/MossWsConnection';
import { ipcBridge } from '@/common';
import type { IResponseMessage } from '@/common/ipcBridge';
import type { AcpQuestionAnswerItem, TMessage } from '@/common/chatLib';
import type { AcpQuestionResponseAnswer } from '@/types/acpTypes';
import type { TChatConversation } from '@/common/storage';
import { uuid } from '@/common/utils';
import { mainLog, mainError } from '../utils/mainLogger';
import { getDatabase } from '../database/export';
import { addOrUpdateMessage } from '../message';
import { detectFileIntent, matchesDraftPattern } from './draftsCleanup';
import * as nodePath from 'node:path';
import * as fs from 'node:fs';
import { initMossApi } from '../remote/MossSessionApi';

/**
 * RemoteAgent data interface
 */
export interface RemoteAgentData {
  conversation_id: string;
  workspace?: string;
  /** Moss Server URL (e.g. http://127.0.0.1:43127) */
  serverUrl: string;
  /** Auth token - can be API Key, Access Token, or empty (use username/password) */
  authToken?: string;
  /** Username for password login (when authToken is empty) */
  username?: string;
  /** Password for password login (when authToken is empty) */
  password?: string;
  /** Agent name (corresponds to Moss assistant_name) */
  assistantName?: string;
  /** Skip permission confirmation */
  dangerouslySkipPermissions?: boolean;
  /** Runtime type */
  runtimeType?: 'host' | 'docker';
  /** Yolo mode (auto-approve all) */
  yoloMode?: boolean;
  /** Existing WebSocket URL (for resume mode - reconnect to existing session) */
  wsUrl?: string;
  /** Existing Moss session ID (for resume mode) */
  sessionId?: string;
  /** Whether Moss session is pending creation */
  mossSessionPending?: boolean;
  /** Enabled skill names (optional, for non-assistant sessions) */
  enabledSkills?: string[];
}

/**
 * Remote Agent - integrates with Moss Server Session API
 *
 * LAZY CREATION PATTERN:
 * - If mossSessionPending=true, creates Moss session on first sendMessage
 * - If wsUrl exists, attaches/resumes to existing Moss session
 */
class RemoteAgent extends BaseAgent<RemoteAgentData> {
  private connection: MossWsConnection | null = null;
  private options: RemoteAgentData;
  private bootstrap: Promise<void> | undefined;
  private statusMessageId: string | null = null;
  private mossSessionId: string | null = null;
  private mossWsUrl: string | null = null;
  private stopPromise: Promise<void> | null = null;
  private turnActive = false;
  private userCancelled = false;
  private pendingQuestions = new Map<string, { msgId: string; responseToolCallId?: string; toolCallId: string }>();

  /** Workspace path for this agent, when the user explicitly selected one. */
  workspace?: string;

  /** Turn-level file tracking for precise cleanup on cancel */
  private currentTurnFiles: Map<string, { path: string; intent: 'draft' | 'final'; kind: 'create' | 'edit' }> = new Map();

  constructor(data: RemoteAgentData) {
    super('remote-agent', data);
    this.conversation_id = data.conversation_id;
    this.options = data;
    this.status = 'pending';
    this.workspace = data.workspace?.trim() || undefined;
    // Initialize full workspace snapshot for Bash file tracking
    // 初始化完整工作空间快照用于 Bash 文件追踪
    this.workspaceFileSnapshot = this.getWorkspaceFiles();
    mainLog('RemoteAgent', `[INIT] Initialized workspace snapshot with ${this.workspaceFileSnapshot.size} files`);
  }

  /**
   * Initialize Agent:
   * - If mossSessionPending: Create new Moss session first, then connect
   * - If wsUrl exists: Attach/resume to existing Moss session
   */
  private async initAgent(): Promise<void> {
    if (this.bootstrap) {
      mainLog('RemoteAgent', `Reusing existing bootstrap for conversation ${this.conversation_id}`);
      return this.bootstrap;
    }

    mainLog('RemoteAgent', `Starting initAgent for conversation ${this.conversation_id}`);
    mainLog('RemoteAgent', `serverUrl: ${this.options.serverUrl}, mossSessionPending: ${this.options.mossSessionPending}`);

    this.bootstrap = (async () => {
      this.emitStatusMessage('connecting');

      // Determine mode: create new session or attach/resume existing
      // 确定模式：创建新 session 还是 attach/resume 已存在的
      const isPendingMode = this.options.mossSessionPending;
      const hasExistingWsUrl = !!this.options.wsUrl;

      if (isPendingMode && !hasExistingWsUrl) {
        // LAZY CREATION: Create Moss session now
        // 延迟创建：现在创建 Moss session
        mainLog('RemoteAgent', 'LAZY CREATION MODE: Creating Moss session on first send');

        const config: MossWsConnectionConfig = {
          serverUrl: this.options.serverUrl,
          authToken: this.options.authToken,
          username: this.options.username,
          password: this.options.password,
          cwd: this.workspace,
          assistantName: this.options.assistantName,
          dangerouslySkipPermissions: this.options.dangerouslySkipPermissions ?? this.yoloMode,
          runtimeType: this.options.runtimeType,
          // No wsUrl - will create new session
          wsUrl: undefined,
          sessionId: undefined,
          // 新增: 传递启用的 skill 列表
          enabledSkills: this.options.enabledSkills,
        };

        mainLog('RemoteAgent', `MossWsConnection config: cwd=${config.cwd ?? '<server-default>'}, assistant=${config.assistantName || 'default'}, enabledSkills=${config.enabledSkills?.length || 0}`);

        const callbacks: MossWsCallbacks = {
          onMessage: (msg) => this.handleStreamMessage(msg),
          onPermissionRequest: (req, requestId) => this.handlePermissionRequest(req, requestId),
          onConnected: () => this.handleConnected(),
          onDisconnected: () => this.handleDisconnected(),
          onReconnecting: (attempt, max) => this.handleReconnecting(attempt, max),
          onError: (err) => this.handleError(err),
        };

        this.connection = new MossWsConnection(config, callbacks);
        await this.connection.connect();

        // Get created session info
        // 获取创建的 session 信息
        this.mossSessionId = this.connection.getSessionId();
        this.mossWsUrl = this.connection.getWsUrl();

        mainLog('RemoteAgent', `Moss session created: sessionId=${this.mossSessionId}, wsUrl=${this.mossWsUrl}`);

        // Update local database with Moss session info
        // 更新本地数据库的 Moss session 信息
        await this.updateConversationWithMossSession();
      } else if (hasExistingWsUrl) {
        // RESUME/ATTACH MODE: Use existing wsUrl
        // 恢复/附加模式：使用已有的 wsUrl
        mainLog('RemoteAgent', 'RESUME/ATTACH MODE: Using existing wsUrl');

        const config: MossWsConnectionConfig = {
          serverUrl: this.options.serverUrl,
          authToken: this.options.authToken,
          username: this.options.username,
          password: this.options.password,
          cwd: this.workspace,
          assistantName: this.options.assistantName,
          dangerouslySkipPermissions: this.options.dangerouslySkipPermissions ?? this.yoloMode,
          runtimeType: this.options.runtimeType,
          // Resume mode: use existing wsUrl and sessionId
          wsUrl: this.options.wsUrl,
          sessionId: this.options.sessionId || this.conversation_id,
          // 新增: 传递启用的 skill 列表（resume 模式也支持）
          enabledSkills: this.options.enabledSkills,
        };

        mainLog('RemoteAgent', `MossWsConnection config: resume=${!!config.wsUrl}, sessionId=${config.sessionId}, enabledSkills=${config.enabledSkills?.length || 0}`);

        const callbacks: MossWsCallbacks = {
          onMessage: (msg) => this.handleStreamMessage(msg),
          onPermissionRequest: (req, requestId) => this.handlePermissionRequest(req, requestId),
          onConnected: () => this.handleConnected(),
          onDisconnected: () => this.handleDisconnected(),
          onReconnecting: (attempt, max) => this.handleReconnecting(attempt, max),
          onError: (err) => this.handleError(err),
        };

        this.connection = new MossWsConnection(config, callbacks);
        await this.connection.connect();

        this.mossSessionId = this.connection.getSessionId();
        this.mossWsUrl = this.connection.getWsUrl();
      } else if (this.options.sessionId) {
        // Resume by Moss session ID when local cache does not have a current wsUrl.
        // This happens for sessions created by remote cron and synced back later.
        mainLog('RemoteAgent', `RESUME LOOKUP MODE: requesting wsUrl for session ${this.options.sessionId}`);

        const api = initMossApi(this.options.serverUrl);
        if (this.options.authToken) {
          api.setAccessToken(this.options.authToken);
        }
        const { wsUrl, session } = await api.resumeSession(this.options.sessionId);

        this.options.wsUrl = wsUrl;
        this.mossSessionId = this.options.sessionId;
        this.mossWsUrl = wsUrl;
        await this.updateConversationWithResumeInfo(this.options.sessionId, wsUrl, session);

        const config: MossWsConnectionConfig = {
          serverUrl: this.options.serverUrl,
          authToken: this.options.authToken,
          username: this.options.username,
          password: this.options.password,
          cwd: this.workspace,
          assistantName: this.options.assistantName,
          dangerouslySkipPermissions: this.options.dangerouslySkipPermissions ?? this.yoloMode,
          runtimeType: this.options.runtimeType,
          wsUrl,
          sessionId: this.options.sessionId,
          enabledSkills: this.options.enabledSkills,
        };

        mainLog('RemoteAgent', `MossWsConnection config: resumeLookup=true, sessionId=${config.sessionId}, enabledSkills=${config.enabledSkills?.length || 0}`);

        const callbacks: MossWsCallbacks = {
          onMessage: (msg) => this.handleStreamMessage(msg),
          onPermissionRequest: (req, requestId) => this.handlePermissionRequest(req, requestId),
          onConnected: () => this.handleConnected(),
          onDisconnected: () => this.handleDisconnected(),
          onReconnecting: (attempt, max) => this.handleReconnecting(attempt, max),
          onError: (err) => this.handleError(err),
        };

        this.connection = new MossWsConnection(config, callbacks);
        await this.connection.connect();
      } else {
        // No wsUrl and not pending - need to check conversation status
        // 没有 wsUrl 且不是 pending - 需要检查会话状态
        mainLog('RemoteAgent', 'Checking conversation status for resume/attach...');

        // This shouldn't happen in normal flow
        // 正常流程不应该发生这种情况
        throw new Error('Invalid state: no wsUrl and not pending');
      }

      this.emitStatusMessage('session_active');
      mainLog('RemoteAgent', `initAgent completed for conversation ${this.conversation_id}`);
    })();

    return this.bootstrap;
  }

  private async updateConversationWithResumeInfo(mossSessionId: string, wsUrl: string, sessionData: unknown): Promise<void> {
    try {
      const db = getDatabase();
      const existing = db.getConversation(this.conversation_id);
      if (!existing.success || !existing.data) return;

      const session = sessionData as {
        workDir?: string;
        work_dir?: string;
        assistantName?: string;
        assistant_name?: string;
      };
      void db.updateConversation(this.conversation_id, {
        extra: {
          ...existing.data.extra,
          mossSessionId,
          acpWsUrl: wsUrl,
          mossSessionPending: false,
          workspace: session.workDir || session.work_dir || existing.data.extra?.workspace,
          agentName: session.assistantName || session.assistant_name || existing.data.extra?.agentName,
        },
        status: 'finished',
        modifyTime: Date.now(),
      } as Partial<TChatConversation>);
    } catch (error) {
      mainError('RemoteAgent', `Failed to update resumed Moss session info: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Update conversation record with Moss session info
   * 更新会话记录的 Moss session 信息
   */
  private async updateConversationWithMossSession(): Promise<void> {
    if (!this.mossSessionId || !this.mossWsUrl) {
      mainError('RemoteAgent', 'No Moss session info to update');
      return;
    }

    try {
      const db = getDatabase();
      const existing = db.getConversation(this.conversation_id);

      if (!existing.success || !existing.data) {
        mainError('RemoteAgent', `Conversation ${this.conversation_id} not found for Moss session update`);
        return;
      }

      const updatedConversation = {
        ...existing.data,
        extra: {
          ...existing.data.extra,
          mossSessionId: this.mossSessionId,
          acpWsUrl: this.mossWsUrl,
          mossSessionPending: false,
        },
        status: 'finished',
        modifyTime: Date.now(),
      } as unknown as TChatConversation;

      db.updateConversation(this.conversation_id, updatedConversation);
      mainLog('RemoteAgent', `Updated conversation ${this.conversation_id} with Moss session: ${this.mossSessionId}`);

      // Emit refresh event to update sidebar
      // 发送刷新事件更新侧边栏
      ipcBridge.database.conversationChanged.emit({
        conversationId: this.conversation_id,
        source: 'aionui',
        action: 'updated',
      });
    } catch (error) {
      mainError('RemoteAgent', `Failed to update conversation with Moss session: ${error}`);
    }
  }

  /**
   * Send message
   */
  async sendMessage(data: { content: string; files?: string[]; msg_id?: string }): Promise<{ success: boolean; msg?: string }> {
    mainLog('RemoteAgent', `sendMessage called for conversation ${this.conversation_id}`);
    mainLog('RemoteAgent', `content length: ${data.content?.length || 0}, files: ${data.files?.length || 0}`);
    this.status = 'running';
    this.processingStartTime = Date.now();
    this.turnActive = true;
    this.userCancelled = false;
    this.stopPromise = null;

    // ★ Reset turn-level file tracking for new turn
    // 重置 Turn 级别文件追踪，开始新的 Turn
    this.currentTurnFiles.clear();
    this.workspaceFileSnapshot = this.getWorkspaceFiles();
    mainLog('RemoteAgent', `[TURN-START] Reset file tracking, snapshot size: ${this.workspaceFileSnapshot.size}`);

    try {
      mainLog('RemoteAgent', 'Calling initAgent...');
      await this.initAgent();
      mainLog('RemoteAgent', 'initAgent completed');

      if (!this.connection?.isConnected()) {
        mainError('RemoteAgent', 'Connection not ready after initAgent');
        throw new Error('Connection not ready');
      }

      // Emit user message to UI
      if (data.msg_id && data.content) {
        ipcBridge.conversation.responseStream.emit({
          type: 'user_content',
          conversation_id: this.conversation_id,
          msg_id: data.msg_id,
          data: data.content,
        });
      }

      // Send start event
      ipcBridge.conversation.responseStream.emit({
        type: 'start',
        conversation_id: this.conversation_id,
        msg_id: uuid(36),
        data: { processingStartTime: this.processingStartTime },
      });

      // Handle file references
      let contentToSend = data.content;
      if (data.files && data.files.length > 0) {
        const fileRefs = data.files.map((f) => (f.includes(' ') ? `@"${f}"` : `@${f}`)).join(' ');
        contentToSend = `${fileRefs} ${contentToSend}`;
      }

      // Send to Moss Server
      const result = this.connection.sendMessage({
        content: contentToSend,
        files: data.files,
        msg_id: data.msg_id,
      });

      if (!result.success) {
        this.emitErrorMessage(result.msg || 'Send failed');
      }

      return result;
    } catch (error) {
      this.status = 'finished';
      this.turnActive = false;
      this.processingStartTime = undefined;
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.emitErrorMessage(errorMsg);
      return { success: false, msg: errorMsg };
    }
  }

  /**
   * Attach to an already-started Moss session and mirror its stream into the
   * local conversation UI. Used by remote cron runs where Moss sends the prompt.
   */
  async observeExistingSession(options?: { startedAt?: number }): Promise<{ success: boolean; msg?: string }> {
    mainLog('RemoteAgent', `observeExistingSession called for conversation ${this.conversation_id}`);
    this.status = 'running';
    this.processingStartTime = options?.startedAt ?? Date.now();
    this.turnActive = true;
    this.userCancelled = false;
    this.stopPromise = null;
    this.currentTurnFiles.clear();
    this.workspaceFileSnapshot = this.getWorkspaceFiles();

    try {
      await this.initAgent();

      if (!this.connection?.isConnected()) {
        throw new Error('Connection not ready');
      }

      ipcBridge.conversation.responseStream.emit({
        type: 'start',
        conversation_id: this.conversation_id,
        msg_id: uuid(36),
        data: { processingStartTime: this.processingStartTime },
      });

      return { success: true };
    } catch (error) {
      this.status = 'finished';
      this.turnActive = false;
      this.processingStartTime = undefined;
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.emitErrorMessage(errorMsg);
      return { success: false, msg: errorMsg };
    }
  }

  /**
   * Stop streaming response
   */
  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    if (!this.turnActive) {
      return;
    }

    this.stopPromise = this.performStop().finally(() => {
      this.stopPromise = null;
    });
    return this.stopPromise;
  }

  private async performStop(): Promise<void> {
    this.userCancelled = true;

    // Send interrupt to Moss Server and wait for confirmation
    const confirmed = (await this.connection?.sendInterruptAndWait()) ?? false;

    if (!confirmed) {
      mainLog('RemoteAgent', 'Interrupt confirmation timeout or not connected, proceeding anyway');
    }

    // Clean up all tracked files on cancel (precise cleanup)
    // 取消时精确清理追踪到的所有文件（包括 draft 和 final）
    if (this.workspace) {
      mainLog('RemoteAgent', `[STOP] currentTurnFiles size: ${this.currentTurnFiles.size}`);
      if (this.currentTurnFiles.size > 0) {
        for (const [path, file] of this.currentTurnFiles) {
          mainLog('RemoteAgent', `[STOP] Tracked file: ${path}, intent: ${file.intent}`);
        }
        this.cleanupTrackedFiles().catch((err) => {
          mainError('RemoteAgent', 'Failed to cleanup tracked files:', err);
        });
      } else {
        mainLog('RemoteAgent', '[STOP] No tracked files to cleanup');
      }
    }

    // Emit user cancelled message before finish
    this.emitUserCancelledMessage();

    this.status = 'finished';
    this.turnActive = false;
    this.processingStartTime = undefined;
    this.emitFinishMessage();
  }

  /**
   * Clean up all tracked files from current turn (both draft and final)
   * 清理当前 Turn 追踪到的所有文件（包括 draft 和 final）
   */
  private async cleanupTrackedFiles(): Promise<number> {
    let removedCount = 0;

    for (const [requestedPath, file] of this.currentTurnFiles) {
      try {
        const fullPath = file.path;
        if (fs.existsSync(fullPath)) {
          await fs.promises.unlink(fullPath);
          removedCount++;
          mainLog('RemoteAgent', `[CLEANUP] Removed tracked file: ${requestedPath} (intent: ${file.intent}, actual: ${fullPath})`);
        } else {
          mainLog('RemoteAgent', `[CLEANUP] File already removed: ${fullPath}`);
        }
      } catch (err) {
        mainError('RemoteAgent', `Failed to remove file ${requestedPath}:`, err);
      }
    }

    // Clear tracking
    this.currentTurnFiles.clear();

    if (removedCount > 0) {
      mainLog('RemoteAgent', `[CLEANUP] Total tracked files removed: ${removedCount}`);
    }

    return removedCount;
  }

  /**
   * Emit user cancelled message as content type
   * 发送用户终止消息（作为 content 类型，会显示在对话历史中）
   */
  private emitUserCancelledMessage(): void {
    // Emit as 'content' type so it appears in conversation history
    // and user can continue the conversation
    const msg: IResponseMessage = {
      type: 'content',
      conversation_id: this.conversation_id,
      msg_id: uuid(36),
      data: '请求已被用户终止',
    };

    // Direct emit to bypass any message filtering
    ipcBridge.conversation.responseStream.emit(msg);

    // Persist to local DB
    const tMessage: TMessage = {
      id: msg.msg_id,
      msg_id: msg.msg_id,
      type: 'text',
      position: 'left',
      conversation_id: this.conversation_id,
      content: { content: msg.data as string },
      createdAt: Date.now(),
    };
    addOrUpdateMessage(this.conversation_id, tMessage);
  }

  /**
   * Kill the agent
   */
  kill(): void {
    this.connection?.disconnect();
    this.connection = null;
    this.bootstrap = undefined;
  }

  /**
   * Confirm permission request
   */
  async confirm(id: string, callId: string, data: string): Promise<void> {
    super.confirm(id, callId, data);
    this.connection?.respondToPermissionRequest(callId, data);
  }

  async answerQuestion(toolCallId: string, answers: AcpQuestionResponseAnswer[]): Promise<void> {
    const pending = this.pendingQuestions.get(toolCallId);
    if (pending) {
      this.pendingQuestions.delete(pending.toolCallId);
      if (pending.responseToolCallId) {
        this.pendingQuestions.delete(pending.responseToolCallId);
      }
      this.emitQuestionAnswered(pending.msgId, answers);
    }

    await this.initAgent();
    if (!this.connection?.isConnected()) {
      throw new Error('Connection not ready');
    }

    const answerText = answers
      .map((answer) => answer.value)
      .filter(Boolean)
      .join('\n');
    const result = this.connection.sendQuestionAnswer(answerText, pending?.responseToolCallId || toolCallId);
    if (!result.success) {
      throw new Error(result.msg || 'Failed to send question answer');
    }
  }

  /**
   * Set model for current session
   * Returns immediately after sending the request - actual confirmation comes via model_changed event
   */
  setModel(modelId: string): { success: boolean; msg?: string } {
    mainLog('RemoteAgent', `setModel called: modelId=${modelId}, connection=${!!this.connection}, isConnected=${this.connection?.isConnected()}`);
    if (!this.connection?.isConnected()) {
      mainLog('RemoteAgent', `setModel rejected: not connected`);
      return { success: false, msg: 'Not connected' };
    }
    const result = this.connection.setModel(modelId);
    mainLog('RemoteAgent', `setModel result: ${JSON.stringify(result)}`);
    // Note: This returns immediately after sending the WebSocket message.
    // The moss server will process the request asynchronously and emit model_changed event.
    // The UI will be updated when the model_changed event is received.
    return result;
  }

  // ========== Event handlers ==========

  private handleStreamMessage(msg: IResponseMessage): void {
    if (this.userCancelled && msg.type !== 'finish') {
      mainLog('RemoteAgent', `Ignoring stream message after user cancel: type=${msg.type}`);
      return;
    }

    const enrichedMsg = { ...msg, conversation_id: this.conversation_id };
    ipcBridge.conversation.responseStream.emit(enrichedMsg);

    // Persist messages to local DB for enterprise mode local-first reads
    // 将消息持久化到本地数据库，支持企业模式本地优先读取
    if (msg.type === 'content' || msg.type === 'user_content' || msg.type === 'acp_tool_call' || msg.type === 'error') {
      try {
        const tMessage = this.streamMsgToTMessage(enrichedMsg);
        if (tMessage) {
          addOrUpdateMessage(this.conversation_id, tMessage);
        }
      } catch (err) {
        mainLog('RemoteAgent', `Failed to persist stream message to local DB: ${err}`);
      }
    }

    if (msg.type === 'acp_question') {
      const data = msg.data as { responseToolCallId?: string; toolCallId?: string };
      if (data?.toolCallId) {
        const pendingQuestion = { msgId: msg.msg_id, responseToolCallId: data.responseToolCallId, toolCallId: data.toolCallId };
        this.pendingQuestions.set(data.toolCallId, pendingQuestion);
        if (data.responseToolCallId) {
          this.pendingQuestions.set(data.responseToolCallId, pendingQuestion);
        }
      }
      try {
        const tMessage = this.streamMsgToTMessage(enrichedMsg);
        if (tMessage) {
          addOrUpdateMessage(this.conversation_id, tMessage);
        }
      } catch (err) {
        mainLog('RemoteAgent', `Failed to persist question message to local DB: ${err}`);
      }
    }

    // ★ Track file operations for precise cleanup on cancel
    // 追踪文件操作用于取消时精确清理
    if (msg.type === 'acp_tool_call') {
      this.trackFileOperation(msg.data as any);
    }

    // Only set finished status when receiving 'finish' message
    // 'content' messages are streaming and do NOT indicate session end
    // 只有收到 'finish' 消息才设置 finished 状态
    // 'content' 消息是流式的，不代表会话结束
    if (msg.type === 'finish') {
      this.status = 'finished';
      this.turnActive = false;
      this.processingStartTime = undefined;
      // Clear turn-level file tracking for next turn
      // 清空 Turn 级别文件追踪，为下一个 Turn 做准备
      this.currentTurnFiles.clear();
      mainLog('RemoteAgent', '[FINISH] Cleared currentTurnFiles for next turn');
    }
  }

  /**
   * Track file operations from tool calls
   * 追踪工具调用中的文件操作
   */
  private trackFileOperation(toolCallData: any): void {
    if (!toolCallData) return;

    const toolName = toolCallData.title?.toLowerCase() || '';
    const rawInput = toolCallData.rawInput;
    const status = toolCallData.status;

    // Only track completed operations
    if (status !== 'completed') return;

    // Track write_file/edit_file operations
    if (toolName === 'write_file' || toolName === 'edit_file') {
      if (!this.workspace) return;
      const inputPath = rawInput?.path as string | undefined;
      const content = rawInput?.content as string | undefined;
      if (!inputPath) return;

      // Detect file intent
      let intent: 'draft' | 'final' = 'final';
      if (content) {
        const intentResult = detectFileIntent(inputPath, content);
        if (intentResult.intent === 'draft') {
          intent = 'draft';
        } else if (intentResult.intent === 'final') {
          intent = 'final';
        } else {
          // Use pattern matching as fallback
          intent = matchesDraftPattern(inputPath) ? 'draft' : 'final';
        }
      } else {
        intent = matchesDraftPattern(inputPath) ? 'draft' : 'final';
      }

      // Track the file
      const actualPath = intent === 'draft' ? nodePath.join(this.workspace, '.drafts', nodePath.basename(inputPath)) : nodePath.join(this.workspace, inputPath);

      this.currentTurnFiles.set(inputPath, {
        path: actualPath,
        intent,
        kind: toolName === 'write_file' ? 'create' : 'edit',
      });
      mainLog('RemoteAgent', `[TRACK] File: ${inputPath}, intent: ${intent}, actualPath: ${actualPath}`);
    }

    // Track files generated by Bash tool (scan workspace for new files)
    // 追踪 Bash 工具产生的文件（扫描工作空间新增文件）
    if (toolName === 'bash') {
      this.trackBashGeneratedFiles();
    }
  }

  /**
   * Track files generated by Bash tool execution
   * 追踪 Bash 工具执行产生的文件
   */
  private trackBashGeneratedFiles(): void {
    try {
      if (!this.workspace) return;
      const currentSnapshot = this.getWorkspaceFiles();

      // Compare with previous snapshot to find new files
      const previousSnapshot = this.workspaceFileSnapshot;
      const newFiles: string[] = [];

      for (const [file, time] of currentSnapshot) {
        if (!previousSnapshot.has(file)) {
          newFiles.push(file);
        }
      }

      // Track new files
      for (const file of newFiles) {
        const fileName = nodePath.basename(file);
        const relativePath = nodePath.relative(this.workspace, file);

        // Skip excluded files and directories
        const EXCLUDED = new Set(['.git', '.gitignore', '.env', '.env.local', 'node_modules', '.DS_Store', 'Thumbs.db', '.nexus']);
        if (EXCLUDED.has(fileName) || fileName.startsWith('.nexus')) continue;

        // Detect intent based on file name pattern
        const intent = matchesDraftPattern(fileName) ? 'draft' : 'final';

        // Track the file
        this.currentTurnFiles.set(relativePath, {
          path: file,
          intent,
          kind: 'create',
        });
        mainLog('RemoteAgent', `[TRACK-BASH] New file detected: ${relativePath}, intent: ${intent}`);
      }

      // Update snapshot for next comparison
      this.workspaceFileSnapshot = currentSnapshot;

      if (newFiles.length > 0) {
        mainLog('RemoteAgent', `[TRACK-BASH] Total new files tracked: ${newFiles.length}`);
      }
    } catch (err) {
      mainError('RemoteAgent', 'Failed to track Bash generated files:', err);
    }
  }

  /**
   * Get current workspace files snapshot
   * 获取当前工作空间文件快照
   */
  private getWorkspaceFiles(): Map<string, number> {
    const snapshot = new Map<string, number>();

    try {
      if (!this.workspace) return snapshot;
      // Scan workspace root
      const scanDir = (dir: string) => {
        if (!fs.existsSync(dir)) return;

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = nodePath.join(dir, entry.name);

          // Skip certain directories
          if (entry.isDirectory()) {
            const skipDirs = new Set(['.git', 'node_modules', '.nexus', '__pycache__', '.venv', 'venv']);
            if (skipDirs.has(entry.name)) continue;
            scanDir(fullPath);
          } else if (entry.isFile()) {
            try {
              const stat = fs.statSync(fullPath);
              snapshot.set(fullPath, stat.mtimeMs);
            } catch {
              // Ignore stat errors
            }
          }
        }
      };

      scanDir(this.workspace);
    } catch (err) {
      mainError('RemoteAgent', 'Failed to get workspace files snapshot:', err);
    }

    return snapshot;
  }

  private workspaceFileSnapshot: Map<string, number> = new Map();

  /**
   * Convert stream IResponseMessage to TMessage for local DB persistence
   * 将流式 IResponseMessage 转换为 TMessage 用于本地数据库持久化
   */
  private streamMsgToTMessage(msg: IResponseMessage): import('@/common/chatLib').TMessage | null {
    switch (msg.type) {
      case 'content':
        return {
          id: uuid(),
          type: 'text',
          msg_id: msg.msg_id,
          position: 'left',
          conversation_id: msg.conversation_id,
          content: { content: msg.data as string },
        } as any;
      case 'user_content': {
        // 过滤掉系统提示词，只保留用户请求部分
        // 系统提示词格式：[Assistant Rules - You MUST follow these instructions]\n...\n\n[User Request]\n用户消息
        let userContent = msg.data as string;
        if (userContent.includes('[User Request]')) {
          // 提取 [User Request] 之后的内容作为用户消息
          const parts = userContent.split('[User Request]');
          userContent = parts[parts.length - 1]?.trim() || userContent;
        }
        return {
          id: uuid(),
          type: 'text',
          msg_id: msg.msg_id,
          position: 'right',
          conversation_id: msg.conversation_id,
          content: { content: userContent },
        } as any;
      }
      case 'acp_tool_call':
        return {
          id: uuid(),
          type: 'acp_tool_call',
          msg_id: msg.msg_id,
          position: 'left',
          conversation_id: msg.conversation_id,
          content: msg.data as any,
        } as any;
      case 'acp_question':
        return {
          id: uuid(),
          type: 'acp_question',
          msg_id: msg.msg_id,
          position: 'left',
          conversation_id: msg.conversation_id,
          content: {
            ...(msg.data as Record<string, unknown>),
            conversationId: msg.conversation_id,
          },
        } as any;
      case 'error':
        return {
          id: uuid(),
          type: 'tips',
          msg_id: msg.msg_id,
          position: 'left',
          conversation_id: msg.conversation_id,
          content: { content: msg.data as string, type: 'error' },
        } as any;
      default:
        return null;
    }
  }

  private handlePermissionRequest(req: any, requestId: string): void {
    this.addConfirmation({
      id: requestId,
      callId: requestId,
      title: req.title || req.tool_name || 'Permission Required',
      description: JSON.stringify(req.rawInput || req.input || {}),
      options: req.options?.map((opt: any) => ({
        label: opt.name || opt,
        value: opt.optionId || opt,
      })) || [
        { label: 'Allow', value: 'allow_once' },
        { label: 'Always Allow', value: 'allow_always' },
        { label: 'Reject', value: 'reject_once' },
      ],
    });
  }

  private emitQuestionAnswered(msgId: string, answers: AcpQuestionResponseAnswer[]): void {
    const answerItems: AcpQuestionAnswerItem[] = answers.map((answer, index) => ({
      id: answer.id,
      index: index + 1,
      submissionValue: answer.value,
      displayValue: answer.label || answer.value,
      skipped: answer.value === '[skipped]',
    }));

    const selectedAnswer = answerItems.map((answer) => `${answer.index}. ${answer.skipped ? '[skipped]' : answer.displayValue}`).join('\n');

    ipcBridge.conversation.responseStream.emit({
      type: 'acp_question',
      conversation_id: this.conversation_id,
      msg_id: msgId,
      data: {
        answered: true,
        selectedAnswer,
        answerItems,
      },
    });
  }

  private handleConnected(): void {
    mainLog('RemoteAgent', `Connected to Moss Server for conversation ${this.conversation_id}`);
    this.emitStatusMessage('connected');
  }

  private handleDisconnected(): void {
    mainError('RemoteAgent', `Disconnected from Moss Server for conversation ${this.conversation_id}`);
    this.emitStatusMessage('disconnected');
    this.emitFinishMessage();
  }

  private handleReconnecting(attempt: number, max: number): void {
    mainLog('RemoteAgent', `Reconnecting to Moss Server (${attempt}/${max})`);
    this.emitStatusMessage('connecting');
  }

  private handleError(err: Error): void {
    mainError('RemoteAgent', `Moss connection error: ${err.message}`);
    this.emitErrorMessage(err.message);
  }

  // ========== Message emission ==========

  private emitStatusMessage(status: 'connecting' | 'connected' | 'session_active' | 'disconnected' | 'error'): void {
    if (!this.statusMessageId) {
      this.statusMessageId = uuid(36);
    }

    ipcBridge.conversation.responseStream.emit({
      type: 'agent_status',
      conversation_id: this.conversation_id,
      msg_id: this.statusMessageId,
      data: {
        backend: 'moss-server',
        status,
        agentName: this.options.assistantName,
        mossSessionId: this.mossSessionId,
      },
    });
  }

  private emitErrorMessage(error: string): void {
    ipcBridge.conversation.responseStream.emit({
      type: 'error',
      conversation_id: this.conversation_id,
      msg_id: uuid(36),
      data: error,
    });
    // After error, must emit finish to end the session
    // 发送错误后必须发送 finish 结束会话
    this.status = 'finished';
    this.turnActive = false;
    this.emitFinishMessage();
  }

  private emitFinishMessage(): void {
    this.turnActive = false;
    this.processingStartTime = undefined;
    ipcBridge.conversation.responseStream.emit({
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: uuid(36),
      data: null,
    });
  }

  /**
   * Get Moss session info
   */
  getMossSessionInfo(): { sessionId: string | null; wsUrl: string | null } {
    return {
      sessionId: this.mossSessionId,
      wsUrl: this.mossWsUrl,
    };
  }
}

export default RemoteAgent;
