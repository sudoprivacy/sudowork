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
import { isRemoteContainerPath } from '@/common/utils/workspaceSkillSync';
import { filterEnabledSkillNames } from '../utils/enabledSkillFilter';
import { ProcessConfig, getBundledBuiltinSkillDir } from '../initStorage';
import { hasCronCommands } from './CronCommandDetector';
import { isCronSkillAllowed } from '../services/cron/cronPolicy';

/**
 * Cron instruction inlined into a remote session's first message. The moss
 * container can't read sudowork's local cron SKILL.md, so we inline it here.
 * - When cron is ALLOWED: the full skill (single source of truth for the
 *   [CRON_CREATE]/[CRON_LIST]/[CRON_DELETE] contract the local AcpAgent points
 *   at by path).
 * - When cron is DISABLED: an explicit ban, so the agent does NOT silently
 *   hallucinate "task created". Banning must be active, not just omission.
 */
async function buildRemoteCronInstruction(): Promise<string> {
  if (!(await isCronSkillAllowed())) {
    mainLog('RemoteAgent', 'cron disabled by org — injecting explicit ban instruction');
    return CRON_DISABLED_INSTRUCTION;
  }
  try {
    // Read from the bundled SOURCE, not getBuiltinSkillsDir() — the latter
    // resolves to the user's _system/system dir which differs by mode and was
    // ENOENT in enterprise mode (the file lives at _system but the enterprise
    // path computes `system`). The bundled path is stable across modes.
    const skillPath = nodePath.join(getBundledBuiltinSkillDir('cron'), 'SKILL.md');
    const skillContent = await fs.promises.readFile(skillPath, 'utf-8');
    mainLog('RemoteAgent', `cron enabled — injecting cron skill instruction from ${skillPath}`);
    return `[Scheduled Task Skill — you MUST follow this to manage scheduled tasks; output the [CRON_*] commands directly in your reply]\n${skillContent}`;
  } catch (err) {
    mainError('RemoteAgent', `Failed to read cron SKILL.md: ${err}`);
    return CRON_DISABLED_INSTRUCTION;
  }
}

const CRON_DISABLED_INSTRUCTION = '[Scheduled Tasks — DISABLED]\n' + 'Scheduled task / cron functionality is disabled by your organization. ' + 'You CANNOT create, list, modify, or delete scheduled tasks. ' + 'If the user asks you to schedule, create, or manage a recurring/timed task, you MUST tell them that scheduled tasks are disabled by their organization and that an administrator must enable the feature. ' + 'NEVER claim that a scheduled task was created, and NEVER invent a task ID.';

/**
 * Default idle detach timeout for finished remote sessions.
 * After this many minutes of idleness post-finish, the client tears down the
 * Moss WebSocket but leaves the Moss session intact (next sendMessage will
 * resume via the persisted mossSessionId/acpWsUrl). Override via the
 * `remote.idleDetachMinutes` config key; 0 disables detach entirely.
 */
const DEFAULT_REMOTE_IDLE_DETACH_MINUTES = 30;

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

  /**
   * Pending idle-detach timer. Set when the session reaches a quiescent state
   * (finish / disconnect / error) and not currently active. Cleared on any
   * activity (sendMessage, stream message, permission/question, confirm,
   * restart, connected callback) and on explicit detach()/kill().
   */
  private idleDetachTimer: NodeJS.Timeout | null = null;

  /** Workspace path for this agent, when the user explicitly selected one. */
  workspace?: string;

  /** Turn-level file tracking for precise cleanup on cancel */
  private currentTurnFiles: Map<string, { path: string; intent: 'draft' | 'final'; kind: 'create' | 'edit' }> = new Map();

  /**
   * Accumulated assistant text for the current turn. Remote agents read the
   * sudowork cron skill and emit [CRON_CREATE]/[CRON_LIST]/[CRON_DELETE] text
   * commands in their reply; unlike AcpAgent we must detect and process those
   * on the client (moss does not handle these text commands), otherwise the
   * agent's "created" narration is shown while nothing is created and the
   * client_cron_enabled gate never runs. See processFinishedCronCommands.
   */
  private currentTurnText = '';
  private currentTurnMsgId: string | null = null;

  /**
   * Whether the inlined cron skill instruction has been sent to the moss session.
   * The moss container can't read sudowork's local cron SKILL.md, so we inline
   * the cron command contract into the first message of a session (when org
   * policy allows). Reset when a new session is created.
   */
  private cronSkillInjected = false;

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
      const enabledSkills = await filterEnabledSkillNames(this.options.enabledSkills);

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
          enabledSkills,
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
        if (this.mossSessionId && this.mossWsUrl) {
          // Keep the in-memory options aligned with the persisted DB update.
          // After an idle detach, the same RemoteAgent instance may handle the
          // next sendMessage. Without these fields, initAgent would re-enter
          // lazy creation and create a second Moss session instead of resuming.
          this.options.sessionId = this.mossSessionId;
          this.options.wsUrl = this.mossWsUrl;
          this.options.mossSessionPending = false;
        }

        mainLog('RemoteAgent', `Moss session created: sessionId=${this.mossSessionId}, wsUrl=${this.mossWsUrl}`);

        // Update local database with Moss session info
        // 更新本地数据库的 Moss session 信息
        await this.updateConversationWithMossSession();
      } else if (hasExistingWsUrl) {
        // RESUME/ATTACH MODE: Use existing wsUrl
        // 恢复/附加模式：使用已有的 wsUrl
        mainLog('RemoteAgent', 'RESUME/ATTACH MODE: Using existing wsUrl');

        // Re-derive ws_url from the current server before attaching. The
        // persisted acpWsUrl embeds the advertisedHost from session-creation
        // time and goes stale when the server address changes; hitting the
        // resume endpoint also lets the server start respawning a dead
        // runtime before the WS handshake. Stored wsUrl remains the fallback
        // so a transient lookup failure doesn't block reattach.
        let resumeWsUrl = this.options.wsUrl;
        const resumeSessionId = this.options.sessionId || this.conversation_id;
        try {
          const api = initMossApi(this.options.serverUrl);
          const resumed = await api.resumeSession(resumeSessionId);
          if (resumed.wsUrl) {
            resumeWsUrl = resumed.wsUrl;
            this.options.wsUrl = resumed.wsUrl;
          }
        } catch (lookupError) {
          mainLog('RemoteAgent', `resumeSession lookup failed (${lookupError instanceof Error ? lookupError.message : String(lookupError)}), falling back to stored wsUrl`);
        }

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
          wsUrl: resumeWsUrl,
          sessionId: resumeSessionId,
          // 新增: 传递启用的 skill 列表（resume 模式也支持）
          enabledSkills,
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
          enabledSkills,
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

      // Extract Moss workDir (remote container path)
      const mossWorkDir = session.workDir || session.work_dir;

      // Check if workDir is a remote container path using shared helper
      const isRemotePath = isRemoteContainerPath(mossWorkDir);

      // Build the extra update - save remote paths to mossWorkDir, not workspace
      const extraUpdate: Record<string, unknown> = {
        ...existing.data.extra,
        mossSessionId,
        acpWsUrl: wsUrl,
        mossSessionPending: false,
        agentName: session.assistantName || session.assistant_name || existing.data.extra?.agentName,
      };

      if (isRemotePath) {
        // Remote container path - save to mossWorkDir, preserve existing workspace
        extraUpdate.mossWorkDir = mossWorkDir;
        // Do NOT overwrite workspace with remote path
      } else if (mossWorkDir && !existing.data.extra?.workspace) {
        // Local path and no existing workspace - safe to set
        extraUpdate.workspace = mossWorkDir;
      }

      void db.updateConversation(this.conversation_id, {
        extra: extraUpdate,
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

      // Get workDir from Moss session if available
      // 从 Moss session 获取 workDir（如果可用）
      const sessionWorkDir = this.connection?.getWorkDir?.();

      // Check if workDir is a remote container path using shared helper
      const isRemotePath = isRemoteContainerPath(sessionWorkDir);

      // Build the extra update - save remote paths to mossWorkDir, not workspace
      const extraUpdate: Record<string, unknown> = {
        ...existing.data.extra,
        mossSessionId: this.mossSessionId,
        acpWsUrl: this.mossWsUrl,
        mossSessionPending: false,
      };

      if (isRemotePath) {
        // Remote container path - save to mossWorkDir, preserve existing workspace
        extraUpdate.mossWorkDir = sessionWorkDir;
        // Do NOT overwrite workspace with remote path
      } else if (sessionWorkDir && !existing.data.extra?.workspace) {
        // Local path and no existing workspace - safe to set
        extraUpdate.workspace = sessionWorkDir;
      }

      const updatedConversation = {
        ...existing.data,
        extra: extraUpdate,
        status: 'finished',
        modifyTime: Date.now(),
      } as unknown as TChatConversation;

      db.updateConversation(this.conversation_id, updatedConversation);
      mainLog('RemoteAgent', `Updated conversation ${this.conversation_id} with Moss session: ${this.mossSessionId}, mossWorkDir: ${isRemotePath ? sessionWorkDir : 'N/A'}, workspace: ${existing.data.extra?.workspace || 'N/A'}`);

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
  /**
   * Tear down the current Moss connection and reconnect, resuming the same
   * session. Used by the "重启并连接" action after the WebSocket dies (e.g. the
   * laptop wakes from a long sleep and the socket has hung up). initAgent is
   * guarded by `this.bootstrap`, so it would otherwise reuse the dead
   * connection — clearing bootstrap forces a fresh attach/resume via the
   * persisted wsUrl/sessionId.
   */
  async restartAndConnect(): Promise<void> {
    mainLog('RemoteAgent', `restartAndConnect for conversation ${this.conversation_id}`);
    this.cancelIdleDetachTimer();
    this.emitStatusMessage('connecting');
    try {
      this.connection?.disconnect();
    } catch (error) {
      mainError('RemoteAgent', `disconnect during restart failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.connection = null;
    // Clear bootstrap so initAgent rebuilds the connection instead of returning
    // the stale (resolved) one.
    this.bootstrap = undefined;
    await this.initAgent();
    if (!this.connection?.isConnected()) {
      throw new Error('Connection not ready after restart');
    }
  }

  async sendMessage(data: { content: string; files?: string[]; msg_id?: string }): Promise<{ success: boolean; msg?: string }> {
    mainLog('RemoteAgent', `sendMessage called for conversation ${this.conversation_id}`);
    mainLog('RemoteAgent', `content length: ${data.content?.length || 0}, files: ${data.files?.length || 0}`);
    // Activity: cancel any pending idle detach before we start work.
    this.cancelIdleDetachTimer();
    this.status = 'running';
    this.processingStartTime = Date.now();
    this.turnActive = true;
    this.userCancelled = false;
    this.currentTurnText = '';
    this.currentTurnMsgId = null;
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

      // initAgent reuses a cached bootstrap, so a connection that died while
      // idle (e.g. socket hang up after the laptop slept) won't be rebuilt by
      // the call above. Detect the dead socket and transparently reconnect once
      // before failing, so the user's send self-heals instead of erroring.
      if (!this.connection?.isConnected()) {
        mainLog('RemoteAgent', 'Connection stale after initAgent; attempting reconnect');
        await this.restartAndConnect();
      }

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

      // Tell the remote (moss) agent about scheduled tasks, once per session.
      // The moss container can't read the local cron SKILL.md, so the
      // instruction is inlined: the full skill when cron is allowed, or an
      // explicit ban when disabled (so the agent never hallucinates a created
      // task). Always inject one or the other.
      if (!this.cronSkillInjected) {
        this.cronSkillInjected = true;
        try {
          const cronInstruction = await buildRemoteCronInstruction();
          contentToSend = `${cronInstruction}\n\n[User Request]\n${contentToSend}`;
          mainLog('RemoteAgent', 'Injected cron instruction into first message');
        } catch (err) {
          mainError('RemoteAgent', `Failed to build cron instruction: ${err}`);
        }
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
    this.cancelIdleDetachTimer();
    this.status = 'running';
    this.processingStartTime = options?.startedAt ?? Date.now();
    this.turnActive = true;
    this.userCancelled = false;
    this.currentTurnText = '';
    this.currentTurnMsgId = null;
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
   * Detach from the remote session WITHOUT terminating it server-side.
   *
   * Tears down the local WebSocket and clears in-memory state so the next
   * sendMessage rebuilds the connection via the persisted
   * mossSessionId/acpWsUrl resume path. Used for:
   *   - Client-side idle detach after a quiescent finished session.
   *   - App-exit cleanup (WorkerManage.clear) — Moss container/session
   *     reclamation is handled by the Moss server's own idle policy.
   *
   * Critically distinct from terminate: deleteConversation goes through
   * RemoteConversationProvider, which calls MossSessionApi.terminateSession
   * separately. This method must never touch the Moss API.
   */
  detach(): void {
    this.cancelIdleDetachTimer();
    try {
      this.connection?.disconnect();
    } catch (err) {
      mainError('RemoteAgent', `detach() disconnect failed for ${this.conversation_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.connection = null;
    this.bootstrap = undefined;
    mainLog('RemoteAgent', `Detached conversation ${this.conversation_id}`);
  }

  /**
   * Kill the agent (existing WorkerManage cleanup entry point).
   *
   * Semantically: "drop this agent instance from local cache." Always
   * delegates to detach() at the RemoteAgent level — RemoteAgent never
   * terminates the Moss session itself. The terminate side of a delete
   * happens in RemoteConversationProvider.deleteConversation, which calls
   * MossSessionApi.terminateSession explicitly before invoking
   * WorkerManage.kill.
   */
  kill(): void {
    this.detach();
  }

  /** Schedule the idle-detach timer if not already pending and not active. */
  private scheduleIdleDetachTimer(): void {
    if (this.turnActive) return;
    if (this.idleDetachTimer) return;
    if (!this.connection) return;

    const timeoutMs = this.getIdleDetachTimeoutMs();
    if (timeoutMs <= 0) return;

    this.idleDetachTimer = setTimeout(() => {
      this.idleDetachTimer = null;
      // Re-check turnActive at fire time — activity may have resumed.
      if (this.turnActive) {
        mainLog('RemoteAgent', `Idle detach skipped (active) for ${this.conversation_id}`);
        return;
      }
      mainLog('RemoteAgent', `Idle detach firing for ${this.conversation_id} after ${timeoutMs}ms`);
      this.detach();
    }, timeoutMs);
  }

  /** Cancel any pending idle-detach timer. Safe to call when none is set. */
  private cancelIdleDetachTimer(): void {
    if (this.idleDetachTimer) {
      clearTimeout(this.idleDetachTimer);
      this.idleDetachTimer = null;
    }
  }

  /**
   * Read the idle-detach timeout (ms) from config every fire to honor
   * runtime changes. Returns 0 to disable detach.
   */
  private getIdleDetachTimeoutMs(): number {
    let minutes: number | undefined;
    try {
      minutes = ProcessConfig.getSync('remote.idleDetachMinutes');
    } catch {
      minutes = undefined;
    }
    if (typeof minutes !== 'number' || Number.isNaN(minutes)) {
      return DEFAULT_REMOTE_IDLE_DETACH_MINUTES * 60_000;
    }
    if (minutes <= 0) return 0;
    return Math.floor(minutes * 60_000);
  }

  /**
   * Confirm permission request
   */
  async confirm(id: string, callId: string, data: string): Promise<void> {
    // Activity: user responded to a permission prompt. Keep the connection
    // hot so the agent can resume mid-tool-call.
    this.cancelIdleDetachTimer();
    super.confirm(id, callId, data);
    this.connection?.respondToPermissionRequest(callId, data);
  }

  async answerQuestion(toolCallId: string, answers: AcpQuestionResponseAnswer[]): Promise<void> {
    this.cancelIdleDetachTimer();
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

    // Any inbound stream activity (content, tool_call, question, etc.) means
    // the session is alive — cancel any pending idle detach. We re-schedule
    // below when msg.type === 'finish'.
    if (msg.type !== 'finish') {
      this.cancelIdleDetachTimer();
    }

    const enrichedMsg = { ...msg, conversation_id: this.conversation_id };
    ipcBridge.conversation.responseStream.emit(enrichedMsg);

    // Accumulate assistant text so cron commands emitted in the reply can be
    // detected and processed on finish (see processFinishedCronCommands).
    if (msg.type === 'content' && typeof msg.data === 'string') {
      this.currentTurnText += msg.data;
      this.currentTurnMsgId = msg.msg_id || this.currentTurnMsgId;
    }

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

      // Process any cron commands the agent emitted this turn before resetting
      // turn state. Fire-and-forget — feedback is sent back into the session.
      const finishedText = this.currentTurnText;
      const finishedMsgId = this.currentTurnMsgId;
      this.currentTurnText = '';
      this.currentTurnMsgId = null;
      if (hasCronCommands(finishedText)) {
        void this.processFinishedCronCommands(finishedText, finishedMsgId);
      }

      // Clear turn-level file tracking for next turn
      // 清空 Turn 级别文件追踪，为下一个 Turn 做准备
      this.currentTurnFiles.clear();
      mainLog('RemoteAgent', '[FINISH] Cleared currentTurnFiles for next turn');
      // Session is quiescent — start (or restart) idle detach countdown.
      this.scheduleIdleDetachTimer();
    }
  }

  /**
   * Detect and execute cron commands the remote agent emitted in its reply.
   * Routes through MessageMiddleware.processCronInMessage, which applies the
   * client_cron_enabled gate and (via getCronProvider) creates jobs on the
   * active backend — moss in remote mode. Any system response (the
   * disabled-by-org refusal, or the created/listed/deleted result) is emitted
   * to the UI and fed back into the moss session so the agent relays an honest
   * answer instead of falsely claiming success.
   */
  private async processFinishedCronCommands(text: string, msgId: string | null): Promise<void> {
    try {
      // Lazy import: MessageMiddleware pulls in the cron provider/database graph;
      // importing it at module top-level would bloat RemoteAgent's load and its
      // test harness. Cron commands are rare, so a per-occurrence import is fine.
      const { processCronInMessage } = await import('./MessageMiddleware');
      const message: TMessage = {
        id: msgId || uuid(),
        msg_id: msgId || uuid(),
        type: 'text',
        position: 'left',
        conversation_id: this.conversation_id,
        content: { content: text },
        status: 'finish',
        createdAt: Date.now(),
      } as TMessage;

      const collectedResponses: string[] = [];
      // Remote sessions run the moss default backend; 'scode' is the label used
      // for the cron job's agentType metadata.
      await processCronInMessage(this.conversation_id, 'scode', message, (sysMsg) => {
        collectedResponses.push(sysMsg);
        ipcBridge.conversation.responseStream.emit({
          type: 'system',
          conversation_id: this.conversation_id,
          msg_id: uuid(),
          data: sysMsg,
        });
      });

      if (collectedResponses.length > 0 && this.connection) {
        const feedbackMessage = `[System Response]\n${collectedResponses.join('\n')}`;
        this.connection.sendMessage({ content: feedbackMessage, msg_id: uuid() });
      }
    } catch (err) {
      mainError('RemoteAgent', `Failed to process cron commands: ${err}`);
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
    // Permission prompts are interactive — keep the connection hot while we
    // wait for the user. Without this, a long-thought permission dialog could
    // outlive the idle detach window.
    this.cancelIdleDetachTimer();
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
    // Fresh connection — drop any leftover detach timer from the previous
    // disconnected lifecycle.
    this.cancelIdleDetachTimer();
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
    // Cover the locally-emitted finish paths (performStop, emitErrorMessage,
    // handleDisconnected). The Moss-emitted finish in handleStreamMessage
    // schedules the timer there directly.
    this.scheduleIdleDetachTimer();
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
