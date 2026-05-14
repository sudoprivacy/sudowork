/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { AcpAdapter } from '@/agent/acp/AcpAdapter';
import { AcpApprovalStore } from '@/agent/acp/ApprovalStore';
import { OpenClawGatewayConnection } from '@/agent/openclaw/OpenClawGatewayConnection';
import { getGatewayAuthPassword, getGatewayAuthToken, getGatewayPort, readOpenClawConfigFromDir, SUDOCLAW_DEFAULT_PORT } from '@/agent/openclaw/openclawConfig';
import type { ChatEvent, EventFrame, HelloOk, OpenClawGatewayConfig } from '@/agent/openclaw/types';
import { channelEventBus } from '@/channels/agent/ChannelEventBus';
import { ipcBridge } from '@/common';
import type { IConfirmation, TMessage } from '@/common/chatLib';
import { transformMessage } from '@/common/chatLib';
import { NavigationInterceptor } from '@/common/navigation';
import * as fs from 'node:fs';
import type { IResponseMessage } from '@/common/ipcBridge';
import { uuid } from '@/common/utils';
import type { AcpBackendAll, AcpResult, ToolCallUpdate } from '@/types/acpTypes';
import { AcpErrorType, createAcpError } from '@/types/acpTypes';
import { getDatabase } from '@process/database';
import { addMessage, addOrUpdateMessage } from '@process/message';
import { cronBusyGuard } from '@process/services/cron/CronBusyGuard';
import { getSudoclawWorkspaceRoot } from '@process/initAgent';
import { SUDOCLAW_DIR } from '@process/services/sudoclaw/SudoclawInstallService';
import BaseAgent from '@process/task/BaseAgent';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { translateLLMError } from '@process/utils/llmErrorTranslation';
import { resolveImageConfig, callImagesGenerations, callImagesEdits, saveImageResult, resolveChatModel, callChatCompletionsWithImage, readSudorouterCredentials } from '../bridge/imageGenerationBridge';
import { buildDraftsInstruction, hasMcpServersConfigured, buildMcporterCommandHint } from './agentUtils';
import { normalizeWindowsImagePaths } from './acp/AcpMessagePipeline';
import { cleanupIntermediateFiles } from './draftsCleanup';
import { inferToolFailure } from '@/agent/acp/inferToolFailure';
import { createHash } from 'node:crypto';
import * as nodePath from 'node:path';
import { ProcessConfig } from '@process/initStorage';
import { serviceManager } from '@process/services/serviceManager';

// Telemetry imports for conversation tracking
import { startConversationTracking, endConversationSuccess, endConversationError, endConversationUserCancel } from '../telemetry';

// CrashReporter imports for breadcrumb tracking
import { conversationBreadcrumbs, apiBreadcrumbs, systemBreadcrumbs } from '../telemetry/BreadcrumbTracker';

/** Default prompt timeout in seconds */
const DEFAULT_PROMPT_TIMEOUT_SECONDS = 300;

/** Prompt timeout range (seconds) */
const PROMPT_TIMEOUT_MIN_SECONDS = 30;
const PROMPT_TIMEOUT_MAX_SECONDS = 3600;
const CONNECTION_TIMEOUT_MS = 30_000;
const CONNECTION_MAX_ATTEMPTS = 30;
const CONNECTION_RETRY_DELAY_MS = 1_000;

/**
 * openclaw's bundled `TOOL_RESULT_MAX_CHARS2` — the byte cap it applies via
 * `truncateToolText` before passing tool stdout back to the LLM.
 *
 * The openclaw default is 8000. Sudowork patches the bundle on every
 * gateway start (`SudoclawInstallService.patchOpenclawToolResultCap`) to
 * raise this to 1_000_000 (1 MB) so browser tools that legitimately
 * return tens of KB (`page_html` on a real page, `page_discover` on a
 * busy DOM) reach the LLM intact. This constant must stay in sync with
 * that patch — when the helper-captured stdout exceeds it we still
 * surface a "this was almost certainly truncated" warning to the LLM,
 * but at 1 MB that's only ever an edge case.
 *
 * If `patchOpenclawToolResultCap` fails open (upstream restructured the
 * literal), the install service logs a warning and the original 8 KB cap
 * stays in effect — but our threshold here is 1 MB, so the warning won't
 * fire. The mainLog warning from the install service is the canonical
 * signal in that case.
 */
const OPENCLAW_TOOL_RESULT_CAP_BYTES = 1_000_000;

/**
 * Count ai-dev-browser sub-cmds inside a compound shell string. Both the
 * `browser`/`aidb` wrapper and direct `python -m ai_dev_browser.tools.*`
 * invocations POST to the sidechannel, so each one consumes one queue entry
 * regardless of which path it takes. We split on the same set of separators
 * the compound regex tests for (`\n`, `&&`, `||`, `;`) and count sub-cmds
 * that start with a recognised browser invocation token.
 *
 * Floor at 1 to keep the existing single-cmd behaviour for callers that ask
 * about a non-compound string. Mismatches between this count and what the
 * helper actually POSTs degrade gracefully — `waitForNextAdbEntry` returns
 * `null` after a short wait when there's nothing left, so we just stop
 * collecting and emit whatever we got.
 */
function countAdbInvocations(cmdRaw: string): number {
  const subCmds = cmdRaw.split(/\n|&&|\|\||;/);
  let count = 0;
  for (const sub of subCmds) {
    const trimmed = sub.trim();
    if (!trimmed) continue;
    if (/^(?:browser|aidb)(?:\.cmd|\.bat)?\b/i.test(trimmed)) {
      count++;
    } else if (/python(?:3|\.exe|3\.exe)?\s+(?:-[a-zA-Z]\S*\s+)*-m\s+ai_dev_browser/i.test(trimmed)) {
      count++;
    }
  }
  return Math.max(count, 1);
}

interface ToolEventData {
  phase?: string;
  name?: string;
  toolCallId?: string;
  args?: Record<string, unknown>;
  meta?: string;
  isError?: boolean;
  status?: string;
  title?: string;
  kind?: string;
  content?: unknown[];
  /**
   * openclaw's phase==='result' event payload also carries a `result` field
   * containing the sanitized tool return (`{content:[{type:'text',text}],
   * details:{...}}`, truncated at 8 KB). sudowork previously ignored this,
   * so the UI only saw the short `meta` description. Reading it gives us
   * the real exec stdout without any hook gymnastics.
   */
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    details?: Record<string, unknown>;
  };
}

export interface OpenClawAgentData {
  conversation_id: string;
  workspace?: string;
  backend?: AcpBackendAll;
  agentName?: string;
  model?: string;
  /** Gateway configuration */
  gateway?: {
    host?: string;
    port?: number;
    token?: string;
    password?: string;
    useExternalGateway?: boolean;
    /** OpenClaw state directory (e.g. ~/.nexus/sudoclaw) */
    stateDir?: string;
    forceSubprocessGateway?: boolean;
  };
  /** Session key for resume */
  sessionKey?: string;
  /** YOLO mode (auto-approve all permissions) */
  yoloMode?: boolean;
}

class OpenClawAgent extends BaseAgent<OpenClawAgentData> {
  workspace?: string;
  bootstrap: Promise<void>;
  private options: OpenClawAgentData;

  // Transport — WebSocket connection to ServiceManager-owned gateway
  private connection: OpenClawGatewayConnection | null = null;
  private adapter: AcpAdapter;
  private approvalStore = new AcpApprovalStore();
  private pendingPermissions = new Map<string, { resolve: (response: { optionId: string }) => void; reject: (error: Error) => void }>();
  private pendingNavigationTools = new Set<string>();

  // Streaming message state
  private currentStreamMsgId: string | null = null;
  private accumulatedAssistantText = '';
  private agentAssistantFallbackText = '';
  /** When true, accumulated text matches a prefix of "NO_REPLY" and is buffered pending more tokens */
  private noReplyBuffering = false;
  private statusMessageId: string | null = null;
  private connectionTipMessageId: string | null = null;
  private _lastConnectionStatus: string | null = null;
  private disconnectTipMessageId: string | null = null;
  private isFirstMessage: boolean = true;
  private expectReconnectOnClose = false;
  private hasEmittedTerminalConnectionError = false;

  /** Snapshot of known deliverable files and their mtime, used to detect new files created by Bash/execute tools */
  private workspaceFileSnapshot: Map<string, number> = new Map();

  constructor(data: OpenClawAgentData) {
    super('openclaw-gateway', data);
    this.conversation_id = data.conversation_id;
    this.workspace = data.workspace;
    this.options = data;
    this.status = 'pending';
    this.adapter = new AcpAdapter(data.conversation_id, 'openclaw-gateway');
    this.bootstrap = this.connect(data);
  }

  // ========== Connection Lifecycle ==========

  private async connect(data: OpenClawAgentData): Promise<void> {
    try {
      this.expectReconnectOnClose = false;
      this.hasEmittedTerminalConnectionError = false;
      this.emitStatusMessage('connecting');

      const gatewayConfig = data.gateway ?? { port: SUDOCLAW_DEFAULT_PORT };
      const useExternal = gatewayConfig.useExternalGateway ?? false;
      const stateDir = gatewayConfig.stateDir ?? SUDOCLAW_DIR;
      const port = gatewayConfig.port || getGatewayPort(stateDir);
      const host = gatewayConfig.host || 'localhost';

      // Auto-load token/password from Sudoclaw config
      const authFromConfig = stateDir ? readOpenClawConfigFromDir(stateDir)?.gateway?.auth : null;
      const token = gatewayConfig.token ?? (authFromConfig?.mode === 'token' ? authFromConfig.token : null) ?? (stateDir ? getGatewayAuthToken(stateDir) : null) ?? undefined;
      const password = gatewayConfig.password ?? (authFromConfig?.mode === 'password' ? authFromConfig.password : null) ?? (stateDir ? getGatewayAuthPassword(stateDir) : null) ?? undefined;

      // Wait for ServiceManager-owned gateway if not using external
      let connectHost = host;
      let connectPort = port;
      if (!useExternal) {
        const { serviceManager } = await import('@process/services/serviceManager');
        const gw = await serviceManager.waitForGateway();
        if (!gw) throw new Error('Sudoclaw gateway failed to start');
        connectHost = gw.host;
        connectPort = gw.port;
      }

      for (let attempt = 1; attempt <= CONNECTION_MAX_ATTEMPTS; attempt += 1) {
        this.connection?.stop();
        this.connection = new OpenClawGatewayConnection({
          url: `ws://${connectHost}:${connectPort}`,
          stateDir: stateDir ?? undefined,
          token,
          password,
          onEvent: (evt) => this.handleEvent(evt),
          onHelloOk: (_hello: HelloOk) => this.handleGatewayHello(),
          onConnectError: (err) => this.handleConnectError(err),
          onReconnectScheduled: () => {
            this.expectReconnectOnClose = true;
            this.emitRetryingConnectionMessage();
          },
          onClose: (code, reason) => this.handleClose(code, reason),
          onTokenMismatch: !useExternal
            ? async () => {
                const { serviceManager } = await import('@process/services/serviceManager');
                await serviceManager.restartOpenClaw();
              }
            : undefined,
        });

        this.connection.start();

        try {
          await this.waitForConnection(CONNECTION_TIMEOUT_MS);
          break;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.connection?.stop();
          this.connection = null;

          if (attempt >= CONNECTION_MAX_ATTEMPTS) {
            throw error;
          }

          mainWarn('OpenClawAgent', `Connection attempt ${attempt}/${CONNECTION_MAX_ATTEMPTS} failed, retrying: ${errorMsg}`);
          this.emitRetryingConnectionMessage();
          await new Promise((resolve) => setTimeout(resolve, CONNECTION_RETRY_DELAY_MS));
        }
      }

      this.emitStatusMessage('connected');

      // Resolve session
      await this.resolveSession();
      this.emitStatusMessage('session_active');
      this.emitConnectionRecoveredMessage();
    } catch (error) {
      this.emitTerminalConnectionErrorOnce();
      throw error;
    }
  }

  private async waitForConnection(timeoutMs = CONNECTION_TIMEOUT_MS): Promise<void> {
    const startTime = Date.now();
    while (!this.connection?.isConnected) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error('Connection timeout');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private async resolveSession(): Promise<void> {
    if (!this.connection) {
      throw new Error('Connection not available');
    }

    const resumeKey = this.options.sessionKey;

    if (resumeKey) {
      try {
        const result = await this.connection.sessionsResolve({ key: resumeKey });
        this.connection.sessionKey = result.key;
        await this.syncConfiguredSessionModel();
        return;
      } catch (err) {
        mainWarn('OpenClawAgent', 'Failed to resume session, using default:', err);
      }
    }

    const defaultKey = this.conversation_id;
    try {
      const resetResult = await this.connection.sessionsReset({ key: defaultKey, reason: 'new' });
      this.connection.sessionKey = resetResult.key;
    } catch (err) {
      mainWarn('OpenClawAgent', 'Failed to reset session, trying plain resolve:', err);
      try {
        const result = await this.connection.sessionsResolve({ key: defaultKey });
        this.connection.sessionKey = result.key;
      } catch (resolveErr) {
        mainWarn('OpenClawAgent', 'Failed to resolve default session, falling back:', resolveErr);
        this.connection.sessionKey = defaultKey;
      }
    }

    if (this.connection.sessionKey !== resumeKey) {
      this.saveSessionKey(this.connection.sessionKey!);
    }

    await this.syncConfiguredSessionModel();
  }

  private normalizeSessionModelRef(modelId: string): string {
    const trimmed = modelId.trim();
    if (!trimmed) {
      return '';
    }
    if (trimmed.includes('/')) {
      return trimmed;
    }
    return `sudorouter-${trimmed}/${trimmed}`;
  }

  private extractModelId(modelRef: string): string {
    const trimmed = modelRef.trim();
    if (!trimmed) {
      return '';
    }
    const parts = trimmed.split('/');
    return (parts[parts.length - 1] || '').trim();
  }

  private getConfiguredPrimaryModelRef(): string {
    const stateDir = this.options.gateway?.stateDir ?? SUDOCLAW_DIR;
    const config = readOpenClawConfigFromDir(stateDir) as { agents?: { defaults?: { model?: { primary?: string } } } } | null;
    const primaryModel = config?.agents?.defaults?.model?.primary?.trim() || '';
    return primaryModel ? this.normalizeSessionModelRef(this.extractModelId(primaryModel)) : '';
  }

  private async patchSessionModel(modelId: string): Promise<void> {
    const normalizedModel = this.normalizeSessionModelRef(modelId);
    if (!normalizedModel || !this.connection?.sessionKey) {
      return;
    }

    const configuredPrimaryModel = this.getConfiguredPrimaryModelRef();
    mainLog('OpenClawAgent', `[SESSION_MODEL_SWITCH] session=${this.connection.sessionKey} requested=${modelId.trim()} normalized=${normalizedModel} configuredPrimary=${configuredPrimaryModel || '<empty>'}`);

    if (configuredPrimaryModel && configuredPrimaryModel === normalizedModel) {
      this.options.model = modelId.trim();
      mainLog('OpenClawAgent', `[SESSION_MODEL_SWITCH] skip sessions.patch because target model matches configured primary: ${configuredPrimaryModel}`);
      return;
    }

    mainLog('OpenClawAgent', `[SESSION_MODEL_SWITCH] execute sessions.patch session=${this.connection.sessionKey} model=${normalizedModel}`);
    await this.connection.sessionsPatch({
      key: this.connection.sessionKey,
      model: normalizedModel,
    });
    this.options.model = modelId.trim();
    mainLog('OpenClawAgent', `[SESSION_MODEL_SWITCH] sessions.patch completed session=${this.connection.sessionKey} model=${normalizedModel}`);
  }

  private async syncConfiguredSessionModel(): Promise<void> {
    if (!this.options.model) {
      return;
    }
    try {
      await this.patchSessionModel(this.options.model);
    } catch (error) {
      mainWarn('OpenClawAgent', 'Failed to sync configured session model:', error);
    }
  }

  /**
   * Apply prompt timeout from user config before sending message.
   * Reads agent.promptTimeout from ProcessConfig and sets it on the gateway connection.
   * Falls back to DEFAULT_PROMPT_TIMEOUT_SECONDS (300s) if not configured.
   * Uses synchronous read to avoid IPC blocking issues.
   */
  private applyPromptTimeoutFromConfig(): void {
    if (!this.connection) {
      mainWarn('OpenClawAgent', 'applyPromptTimeoutFromConfig: connection is null');
      return;
    }

    mainLog('OpenClawAgent', 'applyPromptTimeoutFromConfig: reading config synchronously');
    try {
      // Use synchronous read to avoid IPC blocking
      const timeoutSeconds = ProcessConfig.getSync('agent.promptTimeout');

      mainLog('OpenClawAgent', `Read promptTimeout from config: ${timeoutSeconds}`);
      if (timeoutSeconds && timeoutSeconds > 0) {
        // Clamp to valid range
        const clampedSeconds = Math.max(PROMPT_TIMEOUT_MIN_SECONDS, Math.min(PROMPT_TIMEOUT_MAX_SECONDS, timeoutSeconds));
        const timeoutMs = clampedSeconds * 1000;
        this.connection.setPromptTimeout(timeoutMs);
        mainLog('OpenClawAgent', `Applied prompt timeout: ${clampedSeconds}s (${timeoutMs}ms), current connection timeout: ${this.connection.getPromptTimeout()}ms`);
      } else {
        // Use default if not configured
        this.connection.setPromptTimeout(DEFAULT_PROMPT_TIMEOUT_SECONDS * 1000);
        mainLog('OpenClawAgent', `Using default prompt timeout: ${DEFAULT_PROMPT_TIMEOUT_SECONDS}s`);
      }
    } catch (error) {
      mainWarn('OpenClawAgent', 'Failed to read prompt timeout config, using default:', error);
      this.connection.setPromptTimeout(DEFAULT_PROMPT_TIMEOUT_SECONDS * 1000);
    }
  }

  // ========== Public API (BaseAgent contract) ==========

  async setSessionModel(modelId: string): Promise<{ sessionKey: string; model: string }> {
    await this.bootstrap;

    if (!this.connection?.isConnected || !this.connection?.sessionKey) {
      this.bootstrap = this.connect(this.options);
      await this.bootstrap;
    }

    if (!this.connection?.sessionKey) {
      throw new Error('OpenClaw session is not available');
    }

    await this.patchSessionModel(modelId);

    return {
      sessionKey: this.connection.sessionKey,
      model: modelId.trim(),
    };
  }

  async sendMessage(data: { content: string; agentContent?: string; files?: string[]; msg_id?: string; skills?: string[] }) {
    cronBusyGuard.setProcessing(this.conversation_id, true);
    this.status = 'running';
    mainLog('OpenClawAgent', `sendMessage called: content="${data.content?.substring(0, 50)}..."`);
    try {
      await this.bootstrap;
      mainLog('OpenClawAgent', 'sendMessage: bootstrap completed');

      // Start telemetry conversation tracking
      const modelId = this.options.model || 'unknown';
      startConversationTracking(this.conversation_id, modelId, 'sudoclaw');

      // Breadcrumb: conversation started
      conversationBreadcrumbs.start(this.conversation_id, modelId, 'sudoclaw');

      // Auto-reconnect if needed
      if (!this.connection?.isConnected || !this.connection?.sessionKey) {
        this.bootstrap = this.connect(this.options);
        await this.bootstrap;
      }

      // Save user message to chat history
      if (data.msg_id && data.content) {
        const userMessage: TMessage = {
          id: data.msg_id,
          msg_id: data.msg_id,
          type: 'text',
          position: 'right',
          conversation_id: this.conversation_id,
          content: { content: data.content, skills: (data as any).skills || [] },
          createdAt: Date.now(),
        };
        addMessage(this.conversation_id, userMessage);
        const userResponseMessage: IResponseMessage = {
          type: 'user_content',
          conversation_id: this.conversation_id,
          msg_id: data.msg_id,
          data: userMessage.content.content,
        };
        ipcBridge.openclawConversation.responseStream.emit(userResponseMessage);
      }

      // Reset streaming state
      this.currentStreamMsgId = null;
      this.accumulatedAssistantText = '';
      this.agentAssistantFallbackText = '';
      this.adapter.resetMessageTracking();

      // Intercept /image <prompt> slash command
      const imageMatch = data.content.trim().match(/^\/image\s+([\s\S]+)$/);
      if (imageMatch !== null) {
        return await this.handleImageCommand(imageMatch[1].trim());
      }

      // On the first message, prepend MCP tool discovery guidance (if MCP servers are configured)
      // Workspace directive is injected on EVERY message to ensure agent uses the correct workspace
      let processedContent = data.agentContent || data.content;

      // MCP tool discovery - only inject on first message if MCP servers are configured
      if (this.isFirstMessage) {
        this.isFirstMessage = false;
        if (hasMcpServersConfigured()) {
          processedContent = `${buildMcporterCommandHint()}\n\n${processedContent}`;
        }
      }

      // Workspace directive - tell agent to use per-conversation workspace on EVERY message
      // This is critical because the agent may reset context between messages or after errors
      if (this.workspace) {
        const configuredWorkspace = getSudoclawWorkspaceRoot();
        const draftsInstruction = buildDraftsInstruction(this.workspace);
        const workspaceDirective = `[CRITICAL: Workspace & Identity - MUST VERIFY ON EVERY FILE OPERATION]

⚠️ PATH VERIFICATION CHECKLIST (apply to EVERY write/exec/bash operation):

1. Your task workspace (for task-specific output files) is: ${this.workspace}
2. Before any file write, VERIFY the path starts with '${this.workspace}'
3. All NEW files you create (scripts, documents, deliverables) MUST go into: ${this.workspace}

[System: This directive applies even after errors/retries. The session task workspace does NOT change.]

## Task Workspace vs Shared Identity/Memory

Your task workspace '${this.workspace}' is a **project directory** created for THIS specific task/session.
It is used ONLY for storing files generated during this task (scripts, documents, reports, etc.).

Your **identity, soul, and memory** persist across all sessions in the shared workspace:
- Identity: ${configuredWorkspace}/IDENTITY.md
- Soul: ${configuredWorkspace}/SOUL.md
- Memory: ${configuredWorkspace}/memory/

You are NOT a separate clone — you are the same OpenClaw entity across sessions.
When you need to read or update your identity/soul/memory, access them from '${configuredWorkspace}'.
When you create task output files, write them to '${this.workspace}'.

${draftsInstruction}`;
        processedContent = `${workspaceDirective}\n\n${processedContent}`;

        // Initialize workspace file snapshot before sending message,
        // so we can detect new files created during this turn
        this.refreshWorkspaceFileSnapshot();
      }

      // Process file references
      if (data.files && data.files.length > 0) {
        const fileRefs = data.files.map((f) => (f.includes(' ') ? `@"${f}"` : `@${f}`)).join(' ');
        processedContent = `${fileRefs} ${processedContent}`;
      }

      // Process skills - append as metadata comment for Sudoclaw to parse
      if (data.skills && data.skills.length > 0) {
        processedContent = `[Skills: ${data.skills.join(', ')}]\n\n${processedContent}`;
      }

      // Apply prompt timeout from config before sending
      mainLog('OpenClawAgent', 'sendMessage: about to call applyPromptTimeoutFromConfig');
      this.applyPromptTimeoutFromConfig();
      mainLog('OpenClawAgent', 'sendMessage: applyPromptTimeoutFromConfig completed');

      // Breadcrumb: API request
      apiBreadcrumbs.request('chatSend', 'POST', this.conversation_id);

      // Send chat message
      mainLog('OpenClawAgent', `sendMessage: about to call chatSend with sessionKey=${this.connection!.sessionKey}`);
      await this.connection!.chatSend({
        sessionKey: this.connection!.sessionKey!,
        message: processedContent,
      });
      mainLog('OpenClawAgent', 'sendMessage: chatSend completed');

      // Breadcrumb: API response success
      apiBreadcrumbs.responseSuccess('chatSend', 200);

      return { success: true, data: null } as AcpResult;
    } catch (error) {
      cronBusyGuard.setProcessing(this.conversation_id, false);
      this.status = 'finished';

      // Telemetry: end conversation tracking (error)
      const errorMsg = error instanceof Error ? error.message : String(error);
      let errorCode: string | undefined;
      if (errorMsg.includes('timeout') || errorMsg.includes('Timeout') || errorMsg.includes('timed out')) {
        errorCode = 'E002';
        endConversationError(this.conversation_id, 'E002');
      } else if (errorMsg.includes('interrupted') || errorMsg.includes('SSE') || errorMsg.includes('stream')) {
        errorCode = 'E003';
        endConversationError(this.conversation_id, 'E003');
      } else if (errorMsg.includes('parse') || errorMsg.includes('JSON') || errorMsg.includes('invalid response')) {
        errorCode = 'E005';
        endConversationError(this.conversation_id, 'E005');
      } else if (errorMsg.includes('Connection') || errorMsg.includes('Gateway')) {
        errorCode = 'E001';
        endConversationError(this.conversation_id, 'E001');
      } else {
        errorCode = 'E009';
        endConversationError(this.conversation_id, 'E009');
      }

      // Breadcrumb: conversation ended (error)
      conversationBreadcrumbs.error(this.conversation_id, errorCode || 'unknown', errorMsg);

      // Breadcrumb: API response error
      apiBreadcrumbs.responseError('chatSend', errorCode === 'E002' ? 408 : errorCode === 'E001' ? 503 : 500, errorMsg);

      // Post-cleanup on error: move intermediate files from workspace root to .drafts/
      if (this.workspace) {
        cleanupIntermediateFiles(this.workspace).catch((err) => {
          mainError('OpenClawAgent', 'Post-cleanup on error failed:', err);
        });
      }

      if (!this.shouldSuppressTransientGatewayError(errorMsg)) {
        this.emitErrorMessage(`Failed to send Sudoclaw message: ${errorMsg}`);
      }
      throw error;
    }
  }

  async confirm(id: string, callId: string, data: string) {
    super.confirm(id, callId, data);
    await this.bootstrap;

    const pending = this.pendingPermissions.get(callId);
    if (!pending) {
      return;
    }
    this.pendingPermissions.delete(callId);
    pending.resolve({ optionId: data });
  }

  async ensureYoloMode(): Promise<boolean> {
    return !!this.options.yoloMode;
  }

  async stop(): Promise<void> {
    // Telemetry: end conversation tracking (user cancel)
    endConversationUserCancel(this.conversation_id);

    // Breadcrumb: conversation ended (user cancel)
    conversationBreadcrumbs.userCancel(this.conversation_id);

    if (this.connection?.isConnected && this.connection?.sessionKey) {
      try {
        await this.connection.chatAbort({ sessionKey: this.connection.sessionKey });
      } catch (err) {
        mainWarn('OpenClawAgent', 'chatAbort failed:', err);
      }
    }

    // Emit user cancelled message
    this.emitUserCancelledMessage();
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
      msg_id: uuid(),
      data: '请求已被用户终止',
    };

    // Direct emit to bypass any message filtering
    ipcBridge.openclawConversation.responseStream.emit(msg);

    // Also emit to generic conversation stream for channel clients
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

  private async handleImageCommand(args: string): Promise<AcpResult> {
    const responseMsgId = uuid();
    const saveDir = this.workspace || '.';

    ipcBridge.openclawConversation.responseStream.emit({
      type: 'start',
      conversation_id: this.conversation_id,
      msg_id: responseMsgId,
      data: null,
    });

    try {
      // Parse sub-command: analyze, edit, gen/generate
      const analyzeMatch = args.match(/^analyze\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+([\s\S]+)$/);

      if (analyzeMatch) {
        // Image analysis: use chat model + /chat/completions
        const rawPath = analyzeMatch[1] ?? analyzeMatch[2] ?? analyzeMatch[3];
        const srcPath = nodePath.isAbsolute(rawPath) ? rawPath : nodePath.join(saveDir, rawPath);
        const prompt = analyzeMatch[4].trim();

        const creds = readSudorouterCredentials();
        const chatModel = resolveChatModel();
        if (!creds || !chatModel) {
          ipcBridge.openclawConversation.responseStream.emit({
            type: 'content',
            conversation_id: this.conversation_id,
            msg_id: responseMsgId,
            data: '未找到可用的模型配置，请检查 sudoclaw 配置。',
          });
        } else {
          const analysisResult = await callChatCompletionsWithImage(creds.baseUrl, creds.apiKey, chatModel, srcPath, prompt);
          const contentMsg = {
            type: 'content' as const,
            conversation_id: this.conversation_id,
            msg_id: responseMsgId,
            data: analysisResult,
          };
          ipcBridge.openclawConversation.responseStream.emit(contentMsg);
          ipcBridge.conversation.responseStream.emit(contentMsg);
          const tMessage = transformMessage(contentMsg);
          if (tMessage) addOrUpdateMessage(this.conversation_id, tMessage);
        }
      } else {
        // Image generation/edit: use image model
        const config = await resolveImageConfig();
        if (!config) {
          ipcBridge.openclawConversation.responseStream.emit({
            type: 'content',
            conversation_id: this.conversation_id,
            msg_id: responseMsgId,
            data: '未找到可用的图像生成模型配置，请在工具设置中配置图像模型。',
          });
        } else {
          const genMatch = args.match(/^(?:gen|generate)\s+([\s\S]+)$/);
          const editMatch = args.match(/^edit\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s+([\s\S]+)$/);

          let imageUrls: string[];

          if (editMatch) {
            const rawPath = editMatch[1] ?? editMatch[2] ?? editMatch[3];
            const srcPath = nodePath.isAbsolute(rawPath) ? rawPath : nodePath.join(saveDir, rawPath);
            const prompt = editMatch[4].trim();
            const imageUrl = await callImagesEdits(config.baseUrl, config.apiKey, config.model, srcPath, prompt, '1024x1024', 1);
            imageUrls = [imageUrl];
          } else {
            const prompt = genMatch ? genMatch[1].trim() : args;
            const imageUrl = await callImagesGenerations(config.baseUrl, config.apiKey, config.model, prompt, '1024x1024', 1);
            imageUrls = [imageUrl];
          }

          const savedImages = await Promise.all(imageUrls.map((url) => saveImageResult(url, saveDir)));
          const imgContent = savedImages.map(({ imgUrl }) => `![](${imgUrl})`).join('\n');
          const contentMsg = {
            type: 'content' as const,
            conversation_id: this.conversation_id,
            msg_id: responseMsgId,
            data: imgContent,
          };
          ipcBridge.openclawConversation.responseStream.emit(contentMsg);
          ipcBridge.conversation.responseStream.emit(contentMsg);
          const tMessage = transformMessage(contentMsg);
          if (tMessage) addOrUpdateMessage(this.conversation_id, tMessage);

          // Send generated images to channel clients (e.g., Lark) as actual image files
          for (const { imgUrl, relativePath } of savedImages) {
            const fileMessage: IResponseMessage = {
              type: 'file_send',
              conversation_id: this.conversation_id,
              msg_id: uuid(),
              data: {
                filePath: imgUrl,
                fileName: relativePath,
                fileType: 'image' as const,
              },
            };
            this.handleStreamMessage(fileMessage);
          }
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      mainError('[OpenClawAgent]', `Image command failed: ${msg}`);
      ipcBridge.openclawConversation.responseStream.emit({
        type: 'content',
        conversation_id: this.conversation_id,
        msg_id: responseMsgId,
        data: `图像处理失败: ${msg}`,
      });
    }

    ipcBridge.openclawConversation.responseStream.emit({
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: responseMsgId,
      data: null,
    });
    this.status = 'finished';
    cronBusyGuard.setProcessing(this.conversation_id, false);
    return { success: true, data: null };
  }

  kill() {
    // Stop WebSocket connection only — gateway lifecycle is ServiceManager's responsibility.
    if (this.connection) {
      this.connection.stop();
      this.connection = null;
    }

    this.approvalStore.clear();
    this.pendingPermissions.clear();
    this.pendingNavigationTools.clear();
  }

  /** Reconnect WebSocket to the (ServiceManager-owned) gateway. */
  async restartGateway(): Promise<void> {
    if (this.connection) {
      this.connection.stop();
      this.connection = null;
    }
    this.bootstrap = this.connect(this.options);
    await this.bootstrap;
  }

  getDiagnostics() {
    return {
      workspace: this.workspace,
      backend: this.options.backend,
      agentName: this.options.agentName,
      model: this.options.model ?? null,
      gatewayHost: this.options.gateway?.host ?? null,
      gatewayPort: this.options.gateway?.port ?? SUDOCLAW_DEFAULT_PORT,
      conversation_id: this.conversation_id,
      isConnected: this.connection?.isConnected ?? false,
      hasActiveSession: !!this.connection?.sessionKey,
      sessionKey: this.connection?.sessionKey ?? null,
    };
  }

  // ========== Event Handling ==========

  private isFromOtherSession(sessionKey?: string): boolean {
    return !!(sessionKey && this.connection?.sessionKey && sessionKey !== this.connection.sessionKey);
  }

  private handleEvent(evt: EventFrame): void {
    try {
      switch (evt.event) {
        case 'chat':
        case 'chat.event':
          this.handleChatEvent(evt.payload as ChatEvent);
          break;
        case 'agent':
        case 'agent.event':
          this.handleAgentEvent(evt.payload);
          break;
        case 'exec.approval.request':
          this.handleApprovalRequest(evt.payload);
          break;
        case 'shutdown':
          this.handleDisconnect(1001, 'Gateway shutdown');
          break;
        case 'health':
        case 'tick':
          break;
        default:
          break;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      mainError('OpenClawAgent', `Unhandled error in event handler (${evt.event}):`, error);
      // Telemetry: end conversation tracking (internal error)
      endConversationError(this.conversation_id);
      // Breadcrumb: conversation ended (internal error)
      conversationBreadcrumbs.error(this.conversation_id, 'E008', errorMsg);
      // Emit error to UI and force end turn to prevent hanging
      this.emitErrorMessage(`Internal error processing event: ${errorMsg}`);
      this.handleEndTurn();
    }
  }

  private handleChatEvent(event: ChatEvent): void {
    if (this.isFromOtherSession(event.sessionKey)) return;
    switch (event.state) {
      case 'delta': {
        const cumulative = this.extractTextFromMessage(event.message);
        if (!cumulative) return;

        this.agentAssistantFallbackText = '';

        if (!this.currentStreamMsgId) {
          this.currentStreamMsgId = uuid();
          this.accumulatedAssistantText = '';
        }

        let delta: string;
        if (cumulative.length >= this.accumulatedAssistantText.length && cumulative.startsWith(this.accumulatedAssistantText)) {
          delta = cumulative.substring(this.accumulatedAssistantText.length);
          this.accumulatedAssistantText = cumulative;
        } else {
          delta = cumulative;
          this.accumulatedAssistantText += cumulative;
        }

        if (!delta) return;

        // Filter out NO_REPLY — internal agent protocol signal (e.g. memory flush response), not user-facing.
        // Buffer partial prefixes ("N", "NO", "NO_", ...) to handle multi-token splitting by the LLM.
        const trimmed = this.accumulatedAssistantText.trim();
        if ('NO_REPLY'.startsWith(trimmed)) {
          this.noReplyBuffering = true;
          if (trimmed === 'NO_REPLY') {
            this.currentStreamMsgId = null;
            this.accumulatedAssistantText = '';
            this.noReplyBuffering = false;
          }
          return;
        }

        // If we were buffering a NO_REPLY prefix but text diverged, emit full accumulated text
        if (this.noReplyBuffering) {
          this.noReplyBuffering = false;
          delta = this.accumulatedAssistantText;
        }

        this.handleStreamMessage({
          type: 'content',
          conversation_id: this.conversation_id,
          msg_id: this.currentStreamMsgId!,
          data: delta,
        });
        break;
      }

      case 'final': {
        if (event.message) {
          const finalText = this.extractTextFromMessage(event.message);
          // Filter out NO_REPLY and its prefixes — internal agent protocol signal, not user-facing.
          // A standalone NO_REPLY prefix (e.g. "NO") as the entire text content of a turn
          // is an internal protocol artifact, not a meaningful user response.
          const trimmedFinal = finalText?.trim() || '';
          if (trimmedFinal && 'NO_REPLY'.startsWith(trimmedFinal)) {
            this.noReplyBuffering = false;
            this.currentStreamMsgId = null;
            this.accumulatedAssistantText = '';
            this.handleEndTurn();
            break;
          }
          if (finalText && finalText.length > this.accumulatedAssistantText.length) {
            if (!this.currentStreamMsgId) {
              this.currentStreamMsgId = uuid();
              this.accumulatedAssistantText = '';
            }
            const delta = finalText.substring(this.accumulatedAssistantText.length);
            this.accumulatedAssistantText = finalText;
            this.handleStreamMessage({
              type: 'content',
              conversation_id: this.conversation_id,
              msg_id: this.currentStreamMsgId!,
              data: delta,
            });
          }
        }
        if (!this.currentStreamMsgId && this.agentAssistantFallbackText) {
          const fallback = this.agentAssistantFallbackText;
          const fallbackMsgId = uuid();
          this.currentStreamMsgId = fallbackMsgId;
          this.accumulatedAssistantText = fallback;
          this.handleStreamMessage({
            type: 'content',
            conversation_id: this.conversation_id,
            msg_id: fallbackMsgId,
            data: fallback,
          });
        }
        if (!this.currentStreamMsgId && this.connection?.sessionKey) {
          this.fetchAndEmitHistoryFallback(event.runId);
          break;
        }

        this.handleEndTurn();
        break;
      }

      case 'aborted':
        this.handleEndTurn();
        break;

      case 'error':
        mainError(
          'OpenClawAgent',
          '[DIAG] ChatEvent error received:',
          JSON.stringify(
            {
              runId: event.runId,
              sessionKey: event.sessionKey,
              seq: event.seq,
              state: event.state,
              stopReason: event.stopReason,
              errorMessage: event.errorMessage,
              message: event.message,
              usage: event.usage,
            },
            null,
            2
          )
        );
        // Telemetry: end conversation tracking (error)
        endConversationError(this.conversation_id);
        // Breadcrumb: conversation ended (chat error)
        conversationBreadcrumbs.error(this.conversation_id, 'E008', event.errorMessage || 'Chat error');
        const translatedError = translateLLMError(event.errorMessage || 'Unknown error');
        this.emitErrorMessage(translatedError);
        this.handleEndTurn();
        break;

      default:
        mainWarn('OpenClawAgent', 'handleChatEvent: unknown state:', (event as { state: unknown }).state);
    }
  }

  private extractTextFromMessage(message: unknown): string | null {
    if (!message || typeof message !== 'object') return null;
    const m = message as Record<string, unknown>;
    const content = m.content;
    if (typeof content === 'string') return content || null;
    if (Array.isArray(content)) {
      const text = content
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .filter((item) => item.type === 'text')
        .map((item) => (typeof item.text === 'string' ? item.text : ''))
        .join('');
      return text || null;
    }
    if (typeof m.text === 'string') return m.text || null;
    return null;
  }

  private handleAgentEvent(payload: unknown): void {
    const event = payload as { stream: string; data: Record<string, unknown>; runId?: string; sessionKey?: string };
    if (this.isFromOtherSession(event.sessionKey)) return;
    switch (event.stream) {
      case 'thinking':
      case 'thought': {
        if (!event.data) break;
        const delta = (event.data.delta as string) || (event.data.text as string);
        if (!delta) break;
        this.handleSignalMessage({
          type: 'thought',
          conversation_id: this.conversation_id,
          msg_id: uuid(),
          data: { subject: 'Thinking', description: delta },
        });
        break;
      }

      case 'tool':
      case 'tool_call': {
        // If a tool call arrives while buffering a NO_REPLY prefix (e.g. "NO"),
        // the buffered text is an internal protocol artifact, not user-facing content — discard it.
        if (this.noReplyBuffering) {
          this.noReplyBuffering = false;
          this.accumulatedAssistantText = '';
          this.currentStreamMsgId = null;
        }
        if (!event.data) break;
        void this.handleToolCallEvent(event.data as ToolEventData);
        break;
      }

      case 'lifecycle':
        break;

      case 'assistant': {
        if (!event.data) break;
        const text = (event.data.text as string) || '';
        // Filter out NO_REPLY and its prefixes ("N", "NO", "NO_", …) from fallback text
        const trimmedAssistant = text.trim();
        if (text && trimmedAssistant && !'NO_REPLY'.startsWith(trimmedAssistant)) {
          this.agentAssistantFallbackText = text;
        }
        break;
      }

      default:
        mainWarn('OpenClawAgent', `Unhandled agent stream: ${event.stream}`, event);
    }
  }

  private handleApprovalRequest(payload: unknown): void {
    const request = payload as {
      requestId: string;
      toolCall?: {
        toolCallId?: string;
        title?: string;
        kind?: string;
        rawInput?: Record<string, unknown>;
      };
      options?: Array<{
        optionId: string;
        name: string;
        kind: string;
      }>;
    };

    const requestId = request.requestId || uuid();

    this.pendingPermissions.set(requestId, {
      resolve: (_response) => {},
      reject: (error) => {
        mainError('OpenClawAgent', 'Permission error:', error);
      },
    });

    const permissionData = {
      sessionId: this.conversation_id,
      toolCall: request.toolCall ?? { toolCallId: requestId, title: 'Permission Required' as string | undefined, kind: undefined as string | undefined, rawInput: undefined as Record<string, unknown> | undefined },
      options: request.options || [
        { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' },
        { optionId: 'allow_always', name: 'Always Allow', kind: 'allow_always' },
        { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
      ],
    };

    const confirmation: IConfirmation = {
      id: requestId,
      callId: requestId,
      title: permissionData.toolCall.title ?? 'Permission Required',
      description: JSON.stringify(permissionData.toolCall.rawInput ?? {}),
      options: permissionData.options.map((opt) => ({
        label: opt.name,
        value: opt.optionId,
      })),
    };

    this.addConfirmation(confirmation);

    // Timeout - reject pending to avoid silent hang
    setTimeout(() => {
      const pending = this.pendingPermissions.get(requestId);
      if (pending) {
        this.pendingPermissions.delete(requestId);
        pending.reject(new Error('Permission request timed out'));
      }
    }, 70000);
  }

  private handleConnectError(err: Error): void {
    mainError('OpenClawAgent', 'Connection error:', err);
    if (this.isRetryingConnectionError(err.message)) {
      this.emitRetryingConnectionMessage();
      return;
    }

    if (/^Max reconnect attempts \(\d+\) reached$/.test(err.message.trim())) {
      this.emitTerminalConnectionErrorOnce();
      return;
    }

    this.emitTerminalConnectionErrorOnce();
  }

  private handleGatewayHello(): void {
    this.expectReconnectOnClose = false;
    this.hasEmittedTerminalConnectionError = false;
    if (this.connection?.sessionKey) {
      this.emitStatusMessage('session_active');
      return;
    }

    this.emitStatusMessage('connected');
  }

  private handleClose(code: number, reason: string): void {
    const retrying = this.expectReconnectOnClose;
    this.expectReconnectOnClose = false;
    this.handleDisconnect(code, reason, retrying);
  }

  private handleEndTurn(): void {
    // Telemetry: end conversation tracking (success)
    endConversationSuccess(this.conversation_id);

    // Breadcrumb: conversation ended (success)
    conversationBreadcrumbs.end(this.conversation_id, 'success');

    // If still buffering a NO_REPLY prefix at end of turn, discard it silently.
    // A partial NO_REPLY prefix (e.g. "NO") that was never completed or diverged is
    // an internal protocol artifact, not meaningful user-facing content.
    // Previously this buffer was flushed to the user, which caused "NO" to leak
    // into visible messages (see issue #513).

    this.currentStreamMsgId = null;
    this.accumulatedAssistantText = '';
    this.agentAssistantFallbackText = '';
    this.noReplyBuffering = false;

    const msg: IResponseMessage = {
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: null,
    };

    // Clear busy guard
    cronBusyGuard.setProcessing(this.conversation_id, false);

    // Post-cleanup: move intermediate files from workspace root to .drafts/
    if (this.workspace) {
      cleanupIntermediateFiles(this.workspace).catch((err) => {
        mainError('OpenClawAgent', 'Post-cleanup failed:', err);
      });
    }

    // Emit signal events to frontend + channels
    ipcBridge.openclawConversation.responseStream.emit(msg);
    ipcBridge.conversation.responseStream.emit(msg);
    channelEventBus.emitAgentMessage(this.conversation_id, msg);
  }

  private handleDisconnect(code: number, reason: string, retrying: boolean = false): void {
    if (!retrying) {
      this.emitStatusMessage('disconnected');
    }
    const errorMsg = `Gateway disconnected: ${reason}`;
    if (!retrying && !this.hasEmittedTerminalConnectionError && !this.shouldSuppressTransientGatewayClose(code, reason)) {
      this.emitErrorMessage(errorMsg, 'disconnect');
      // Telemetry: end conversation tracking (gateway disconnect)
      endConversationError(this.conversation_id, 'E010');
      // Breadcrumb: conversation ended (disconnect)
      conversationBreadcrumbs.error(this.conversation_id, 'E010', errorMsg);
    }

    // Post-cleanup on disconnect: move intermediate files from workspace root to .drafts/
    if (this.workspace) {
      cleanupIntermediateFiles(this.workspace).catch((err) => {
        mainError('OpenClawAgent', 'Post-cleanup on disconnect failed:', err);
      });
    }

    const finishMsg: IResponseMessage = {
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: null,
    };
    ipcBridge.openclawConversation.responseStream.emit(finishMsg);
    ipcBridge.conversation.responseStream.emit(finishMsg);
    channelEventBus.emitAgentMessage(this.conversation_id, finishMsg);

    this.pendingPermissions.clear();
    this.approvalStore.clear();
    this.pendingNavigationTools.clear();
  }

  private isRetryingConnectionError(message: string): boolean {
    const trimmed = message.trim();
    return this.shouldSuppressTransientGatewayError(trimmed) || /^connect/i.test(trimmed);
  }

  private emitRetryingConnectionMessage(): void {
    if (this.hasEmittedTerminalConnectionError) {
      return;
    }

    this.emitStatusMessage('connecting');
  }

  private emitConnectionRecoveredMessage(): void {
    this.expectReconnectOnClose = false;
    this.hasEmittedTerminalConnectionError = false;
    if (!this.connectionTipMessageId) {
      return;
    }

    this.emitConnectionTipMessage('已连接到 Sudoclaw', 'success');
  }

  private emitTerminalConnectionErrorOnce(): void {
    if (this.hasEmittedTerminalConnectionError) {
      return;
    }

    this.hasEmittedTerminalConnectionError = true;
    this.expectReconnectOnClose = false;
    this.emitStatusMessage('error');
    this.emitConnectionTipMessage('连接失败，请稍后重试', 'error');
  }

  private emitConnectionTipMessage(content: string, type: 'error' | 'success' | 'warning'): void {
    if (!this.connectionTipMessageId) {
      this.connectionTipMessageId = uuid();
    }

    const message: TMessage = {
      id: this.connectionTipMessageId,
      msg_id: this.connectionTipMessageId,
      conversation_id: this.conversation_id,
      type: 'tips',
      position: 'center',
      createdAt: Date.now(),
      content: {
        content,
        type,
      },
    };

    this.emitTMessage(message);
  }

  private shouldSuppressTransientGatewayError(message: string): boolean {
    const trimmed = message.trim();
    return /^Gateway closed \(100\d\):\s*$/.test(trimmed) || trimmed === 'Gateway not connected' || trimmed === 'Connection timeout' || trimmed === 'WebSocket was closed before the connection was established' || /^Gateway closed \(4000\): tick timeout$/.test(trimmed) || /^Request 'connect' timed out after \d+ms$/.test(trimmed) || /^Gateway closed \(1008\): connect failed$/.test(trimmed);
  }

  private shouldSuppressTransientGatewayClose(code: number, reason: string): boolean {
    return code >= 1000 && code < 1010 && reason.trim().length === 0;
  }

  private fetchAndEmitHistoryFallback(runId: string): void {
    const sessionKey = this.connection?.sessionKey;
    if (!sessionKey) {
      this.handleEndTurn();
      return;
    }

    this.connection!.chatHistory(sessionKey, 5)
      .then((result: unknown) => {
        const raw = result as { messages?: unknown[] } | unknown[];
        const messages: unknown[] = Array.isArray(raw) ? raw : ((raw as { messages?: unknown[] })?.messages ?? []);

        const last = [...messages].reverse().find((m: unknown) => {
          const msg = m as { role?: string; runId?: string };
          return msg?.role === 'assistant' && (!runId || !msg.runId || msg.runId === runId);
        }) as { content?: unknown } | undefined;

        const text = this.extractTextFromMessage(last);
        if (text) {
          const msgId = uuid();
          this.currentStreamMsgId = msgId;
          this.accumulatedAssistantText = text;
          this.handleStreamMessage({
            type: 'content',
            conversation_id: this.conversation_id,
            msg_id: msgId,
            data: text,
          });
        }
      })
      .catch((err: unknown) => {
        mainWarn('OpenClawAgent', 'chat.history fallback failed:', err);
      })
      .finally(() => {
        this.handleEndTurn();
      });
  }

  // ========== Stream & Signal Emission (merged from Manager) ==========

  /** Handle stream messages: DB persist + UI emit + channel emit */
  private handleStreamMessage(message: IResponseMessage): void {
    // Normalize Windows backslash paths in content messages before emission
    let msg: IResponseMessage = { ...message, conversation_id: this.conversation_id };
    if (msg.type === 'content' && typeof msg.data === 'string') {
      msg = { ...msg, data: normalizeWindowsImagePaths(msg.data) };
    }

    // Mark as finished when content is output
    const contentTypes = ['content', 'agent_status', 'acp_tool_call', 'plan'];
    if (contentTypes.includes(msg.type)) {
      this.status = 'finished';
    }

    // Persist messages to database
    const tMessage = transformMessage(msg);
    if (tMessage) {
      if (((msg.type === 'content' || msg.type === 'agent_status') && msg.msg_id) || msg.type === 'acp_tool_call' || msg.type === 'plan') {
        addOrUpdateMessage(this.conversation_id, tMessage);
      } else {
        addMessage(this.conversation_id, tMessage);
      }
    }

    // Emit to frontend
    ipcBridge.openclawConversation.responseStream.emit(msg);
    ipcBridge.conversation.responseStream.emit(msg);

    // Emit to Channel global event bus (Telegram/Lark streaming)
    channelEventBus.emitAgentMessage(this.conversation_id, msg);
  }

  /** Handle signal messages (permissions, finish) */
  private handleSignalMessage(message: IResponseMessage): void {
    const msg = { ...message, conversation_id: this.conversation_id };

    // Emit signal events to frontend
    ipcBridge.openclawConversation.responseStream.emit(msg);
    ipcBridge.conversation.responseStream.emit(msg);

    // Forward signals to Channel global event bus
    channelEventBus.emitAgentMessage(this.conversation_id, msg);
  }

  // ========== Message Emission Helpers ==========

  get lastConnectionStatus(): string | null {
    return this._lastConnectionStatus;
  }

  private emitStatusMessage(status: 'connecting' | 'connected' | 'session_active' | 'disconnected' | 'error'): void {
    this._lastConnectionStatus = status;

    if (!this.statusMessageId) {
      this.statusMessageId = uuid();
    }

    const message: TMessage = {
      id: this.statusMessageId!,
      msg_id: this.statusMessageId!,
      conversation_id: this.conversation_id,
      type: 'agent_status',
      position: 'center',
      createdAt: Date.now(),
      content: {
        backend: 'openclaw-gateway',
        status,
      },
    };

    this.emitTMessage(message);
  }

  private emitErrorMessage(error: string, kind: 'generic' | 'disconnect' = 'generic'): void {
    const messageId = kind === 'disconnect' ? (this.disconnectTipMessageId ??= uuid()) : uuid();
    const message: TMessage = {
      id: messageId,
      msg_id: messageId,
      conversation_id: this.conversation_id,
      type: 'tips',
      position: 'center',
      createdAt: Date.now(),
      content: {
        content: error,
        type: 'error',
      },
    };

    this.emitTMessage(message);
  }

  private emitTMessage(message: TMessage): void {
    const finalMsgId = message.msg_id || message.id;
    const responseMessage: IResponseMessage = {
      type: '',
      data: null,
      conversation_id: this.conversation_id,
      msg_id: finalMsgId,
    };

    switch (message.type) {
      case 'text':
        responseMessage.type = 'content';
        responseMessage.data = message.content.content;
        break;
      case 'agent_status':
        responseMessage.type = 'agent_status';
        responseMessage.data = message.content;
        break;
      case 'tips':
        responseMessage.type = 'error';
        responseMessage.data = message.content.content;
        break;
      case 'acp_tool_call':
        responseMessage.type = 'acp_tool_call';
        responseMessage.data = message.content;
        break;
      case 'plan':
        responseMessage.type = 'plan';
        responseMessage.data = message.content;
        break;
      case 'tool_group':
        responseMessage.type = 'tool_group';
        responseMessage.data = message.content;
        break;
      default:
        return;
    }

    this.handleStreamMessage(responseMessage);
  }

  // ========== Persistence ==========

  private saveSessionKey(sessionKey: string): void {
    try {
      const db = getDatabase();
      const result = db.getConversation(this.conversation_id);
      if (result.success && result.data && result.data.type === 'openclaw-gateway') {
        const conversation = result.data;
        const updatedExtra = {
          ...conversation.extra,
          sessionKey,
        };
        db.updateConversation(this.conversation_id, { extra: updatedExtra } as Partial<typeof conversation>);
      }
    } catch (error) {
      mainError('OpenClawAgent', 'Failed to save session key:', error);
    }
  }

  // ========== ai-dev-browser UI bypass helpers ==========

  private isAdbToolCall(data: ToolEventData): boolean {
    const meta = typeof data.meta === 'string' ? data.meta : '';
    const cmd = typeof data.args?.command === 'string' ? (data.args.command as string) : '';
    const haystack = `${meta}\n${cmd}`;
    // sudowork-owned `browser` dispatcher — e.g. `browser page_goto --url …`.
    // The command has no `python` literal, so it must be matched first;
    // the helper POSTs directly to the sidechannel, keeping FIFO alignment.
    // Match also the legacy `aidb` name during the rename transition, and
    // require that the token is followed by either a flag (`--`) or a
    // lowercase tool name (avoids false positives on prose like
    // "open a browser first" in a command meta).
    if (/(?:^|[;\s&|"'`])(?:browser|aidb)(?:\.cmd|\.bat)?\s+(?:--|[a-z_][a-z0-9_]*)/i.test(haystack)) return true;
    // Must look like a Python invocation — this is the first filter so we
    // don't accidentally consume FIFO entries for unrelated commands.
    if (!/\bpython(?:3|\.exe|3\.exe)?\b/i.test(haystack)) return false;
    // Tight match: full reference visible (either module or path form).
    if (/ai_dev_browser[./\\]tools|ai_dev_br/i.test(haystack)) return true;
    // Loose match: openclaw truncates `meta`'s backticked command (often
    // around the 100-char mark). When a long prefix like `$env:PYTHONPATH
    // = "<long path>"; python -m ai_…` eats the budget, the regex above
    // misses. If we see `python` + the ellipsis marker that indicates
    // truncation, treat it as an adb invocation and let the hook-side
    // FIFO sort it out. The hook only POSTs for real ai_dev_browser
    // spawns, so at worst we pop a null entry (no-op) when we guess
    // wrong.
    if (/…/.test(meta)) return true;
    return false;
  }

  private extractResultText(data: ToolEventData): string | null {
    const blocks = data.result?.content;
    if (!Array.isArray(blocks)) return null;
    const parts: string[] = [];
    for (const b of blocks) {
      if (b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string') {
        parts.push(b.text);
      }
    }
    const joined = parts.join('\n').trim();
    return joined.length > 0 ? joined : null;
  }

  private async handleToolCallEvent(toolData: ToolEventData): Promise<void> {
    const phaseToStatus: Record<string, 'pending' | 'in_progress' | 'completed' | 'failed'> = {
      start: 'in_progress',
      update: 'in_progress',
      partialResult: 'in_progress',
    };
    let status: 'pending' | 'in_progress' | 'completed' | 'failed';
    if (toolData.phase === 'result') {
      status = toolData.isError ? 'failed' : 'completed';
      if (status === 'completed' && inferToolFailure(toolData.content, toolData.meta)) {
        status = 'failed';
      }
    } else {
      status = phaseToStatus[toolData.phase ?? ''] ?? ((toolData.status as 'pending' | 'in_progress' | 'completed' | 'failed') || 'pending');
    }

    // When the tool call completes, prefer the real stdout that openclaw
    // already ships inside `data.result.content` over the short `meta`
    // description. For ai-dev-browser invocations (and exec tool calls in
    // general) this makes the UI's Output panel show the actual JSON/text
    // that the tool printed, not "run python, ...". openclaw truncates
    // this at 8 KB which is more than enough for ai-dev-browser's small
    // JSON payloads.
    if (toolData.phase === 'result') {
      const resultText = this.extractResultText(toolData);
      if (resultText) {
        const shouldForceOverride = this.isAdbToolCall(toolData);
        // Always expose the full result text for ai-dev-browser tool calls;
        // for other tools, only fall through when sudowork didn't already
        // receive a structured `content` block.
        if (shouldForceOverride || !Array.isArray(toolData.content) || toolData.content.length === 0) {
          toolData.content = [{ type: 'content', content: { type: 'text', text: resultText } }];
          if (shouldForceOverride) {
            toolData.meta = resultText;
          }
        }
      }

      // Pull the matching stdout capture from the sidechannel and replace
      // openclaw's truncated meta with the real text.
      //
      // Two POST sources feed the sidechannel queue:
      //   1. The hook (`AdbStdoutCapture`) for direct `python -m
      //      ai_dev_browser.tools.*` spawns.
      //   2. The `browser_helper.py` wrapper — for invocations that go
      //      through the `browser` (or legacy `aidb`) dispatcher. The hook
      //      intentionally skips wrapper spawns because attaching a stdout
      //      listener on bash/cmd.exe flips the child pipe into flowing
      //      mode and deadlocks openclaw's paused-mode reader.
      //
      // Correlation: prefer per-call hash match (`waitForCmd`) — both the
      // helper and sudowork compute sha1 over the same normalized command
      // string ("browser <argv>" with collapsed whitespace), so each
      // tool_call event pops exactly its own entry even when the LLM emits
      // parallel browser tool_calls in one turn (lis8 e2e step 23/24
      // observed FIFO swap when payloads of very different sizes raced
      // through the localhost POST). Compound shell commands
      // (`browser A && browser B`) are 1 tool_call event but N helper POSTs
      // so the hash can't possibly match — fall back to global FIFO for
      // those, which is also the path when no entry matches the hash
      // within a short window (e.g. unmatched legacy invocations).
      if (this.isAdbToolCall(toolData)) {
        try {
          const sink = serviceManager.getAdbSidechannel();
          if (sink) {
            const cmdRaw = typeof toolData.args?.command === 'string' ? (toolData.args.command as string) : '';
            const cmdRawTrim = cmdRaw.trim();
            // Compound = the LLM packed multiple shell statements into one
            // exec call. The helper POSTs once per child invocation, but
            // openclaw fires only one `tool_call` event for the whole
            // compound, so a naive single pop misattributes the wrong sub-
            // cmd's stdout to the event (lis8 audit observed 15+ steps
            // showing content from neighbouring sub-cmds). Newline is the
            // most common separator in practice — the LLM tends to write
            // multi-line scripts before `&&`/`;` — so it MUST be in this
            // regex even though it isn't strictly a shell control char.
            const isCompound = /\n|(?:^|[^&|<>])(?:&&|\|\|)|(?:^|[^&|<>]);(?:$|[^;])/.test(cmdRawTrim);
            const collected: string[] = [];
            if (cmdRawTrim && !isCompound) {
              // Single invocation: prefer hash-correlation. Helper's
              // `cmd_norm` is `" ".join(("browser " + " ".join(argv)).split())`
              // — replicate byte-for-byte (collapse whitespace + strip + drop
              // legacy `aidb` prefix in favour of canonical `browser`).
              const cmdNorm = cmdRawTrim.replace(/\s+/g, ' ').replace(/^aidb\b/, 'browser');
              const hash = createHash('sha1').update(cmdNorm).digest('hex');
              const entry = (await sink.waitForCmd(hash, 2_000)) || (await sink.waitForNextAdbEntry(20_000));
              if (entry?.stdoutRaw) collected.push(entry.stdoutRaw);
            } else if (isCompound) {
              // Compound: per-cmd hash can't possibly match (helper hashes
              // each sub-cmd individually, sudowork sees only the combined
              // text). Pop N entries in order — N = number of browser-style
              // invocations across the sub-cmds. Use a generous wait on the
              // first pop (queue may not have caught up to the slowest sub-
              // cmd yet) and a tight wait on the rest so the UI doesn't
              // stall when one sub-cmd silently failed before POSTing.
              const n = countAdbInvocations(cmdRawTrim);
              for (let i = 0; i < n; i++) {
                const e = await sink.waitForNextAdbEntry(i === 0 ? 20_000 : 2_000);
                if (!e) break;
                collected.push(e.stdoutRaw);
              }
            } else {
              const e = await sink.waitForNextAdbEntry(20_000);
              if (e?.stdoutRaw) collected.push(e.stdoutRaw);
            }
            if (collected.length > 0) {
              const merged = collected.length === 1 ? collected[0] : collected.map((text, idx) => `--- sub-cmd ${idx + 1} of ${collected.length} ---\n${text}`).join('\n\n');
              if (merged.length > (this.extractResultText(toolData)?.length ?? 0)) {
                toolData.meta = merged;
                toolData.content = [{ type: 'content', content: { type: 'text', text: merged } }];
                // openclaw feeds tool result to the LLM through a separate in-
                // process channel that ALSO runs through `truncateToolText`
                // (cap 8 KB, marker `…(truncated)…`). Clients can't see what
                // openclaw ships to the LLM, but we can detect the condition
                // from our own sidechannel capture: if the full stdout exceeds
                // the cap, the LLM's copy is truncated even though the UI's
                // copy is intact. Promote the tool call to failed + prepend
                // an explicit warning so the LLM's next turn sees that its
                // own view was cut off rather than silently acting on a
                // partial result. The full text still rides behind the warning
                // for the UI's benefit.
                if (merged.length > OPENCLAW_TOOL_RESULT_CAP_BYTES) {
                  status = 'failed';
                  const warn = `[sudowork] tool output is ${merged.length} bytes (> openclaw's ${OPENCLAW_TOOL_RESULT_CAP_BYTES}-byte tool-result cap). openclaw silently truncates what it ships to the LLM; sudowork is surfacing this as a failure so the LLM doesn't act on a partial view. Re-run with tighter scope, paginate, or write full output to a file and read it back in chunks.\n\n--- full captured output below (${merged.length} bytes) ---\n${merged}`;
                  toolData.meta = warn.slice(0, 200);
                  toolData.content = [{ type: 'content', content: { type: 'text', text: warn } }];
                }
              }
            }
          }
        } catch (err) {
          mainWarn('OpenClawAgent', 'ai-dev-browser sidechannel lookup failed', err);
        }
      }
    }

    const toolName = toolData.name ?? toolData.title ?? '';
    const kind = this.inferToolKind(toolName) ?? (toolData.kind as 'read' | 'edit' | 'execute') ?? 'execute';

    let content: ToolCallUpdate['update']['content'];
    if (toolData.content) {
      content = toolData.content as ToolCallUpdate['update']['content'];
    } else if (toolData.meta) {
      content = [{ type: 'content', content: { type: 'text', text: toolData.meta } }];
    } else if (toolData.args) {
      content = [{ type: 'content', content: { type: 'text', text: JSON.stringify(toolData.args, null, 2) } }];
    }

    const acpUpdate: ToolCallUpdate = {
      sessionId: this.conversation_id,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: toolData.toolCallId || uuid(),
        status,
        title: toolName || 'Tool Call',
        kind,
        rawInput: toolData.args as Record<string, unknown> | undefined,
        content,
      },
    };

    if (NavigationInterceptor.isNavigationTool(acpUpdate.update.title)) {
      const url = NavigationInterceptor.extractUrl(acpUpdate.update);
      if (url) {
        const previewMessage = NavigationInterceptor.createPreviewMessage(url, this.conversation_id);
        this.handleStreamMessage(previewMessage);
      }
    }

    // Intercept file-creation tool calls: send generated files to channel clients (e.g., Lark)
    if (status === 'completed') {
      // Strategy 1: Direct file-creation tools (Write/Edit/Create) — extract path from tool args
      const filePath = this.extractFilePathFromToolCall(toolName, acpUpdate.update.rawInput);
      if (filePath) {
        const fileMessage: IResponseMessage = {
          type: 'file_send',
          conversation_id: this.conversation_id,
          msg_id: uuid(),
          data: {
            filePath,
            fileName: nodePath.basename(filePath),
            fileType: this.classifyFileType(filePath),
          },
        };
        this.handleStreamMessage(fileMessage);
        // Refresh snapshot so Strategy 2 won't re-detect this file
        this.refreshWorkspaceFileSnapshot();
      }

      // Strategy 2: Execute-class tools (Bash/Shell) — scan workspace for new/modified files
      // Covers cases like: Write tool creates .js script -> Bash runs "node xxx.js" -> script writes .docx
      if (kind === 'execute') {
        const newFiles = this.detectNewFilesFromWorkspace();
        for (const newFile of newFiles) {
          const fileMessage: IResponseMessage = {
            type: 'file_send',
            conversation_id: this.conversation_id,
            msg_id: uuid(),
            data: {
              filePath: newFile,
              fileName: nodePath.basename(newFile),
              fileType: this.classifyFileType(newFile),
            },
          };
          this.handleStreamMessage(fileMessage);
        }
        // Refresh snapshot immediately to avoid re-sending same files on next execute tool
        this.refreshWorkspaceFileSnapshot();
      }
    }

    const messages = this.adapter.convertSessionUpdate(acpUpdate);
    for (const message of messages) {
      this.emitTMessage(message);
    }
  }

  // ========== Utilities ==========

  private inferToolKind(name: string): 'read' | 'edit' | 'execute' | null {
    const n = name.toLowerCase();
    if (/read|view|list|search|grep|glob|find|get|fetch/.test(n)) return 'read';
    if (/write|edit|create|delete|patch|update|insert|remove/.test(n)) return 'edit';
    if (/exec|run|bash|shell|terminal/.test(n)) return 'execute';
    return null;
  }

  /**
   * Build or refresh the workspace file snapshot.
   * Scans the workspace root (non-recursive, depth=1) and records each deliverable file's mtime.
   * Files inside .drafts/ directory are excluded.
   */
  private refreshWorkspaceFileSnapshot(): void {
    this.workspaceFileSnapshot.clear();
    if (!this.workspace) return;

    try {
      const entries = fs.readdirSync(this.workspace, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name === '.drafts') continue;

        const ext = nodePath.extname(entry.name).toLowerCase();
        if (!OpenClawAgent.DOCUMENT_EXTENSIONS.has(ext) && !OpenClawAgent.IMAGE_EXTENSIONS.has(ext)) continue;

        const fullPath = nodePath.join(this.workspace, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          this.workspaceFileSnapshot.set(entry.name, stat.mtimeMs);
        } catch {
          // stat failed (file deleted between readdir and stat), skip
        }
      }
    } catch {
      // workspace not readable, skip silently
    }
  }

  /**
   * After an execute-class tool completes, scan workspace for newly created or modified deliverable files.
   * Returns absolute paths of files that are new or have a newer mtime than the snapshot.
   */
  private detectNewFilesFromWorkspace(): string[] {
    if (!this.workspace) return [];
    const newFiles: string[] = [];

    try {
      const entries = fs.readdirSync(this.workspace, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name === '.drafts') continue;

        const ext = nodePath.extname(entry.name).toLowerCase();
        if (!OpenClawAgent.DOCUMENT_EXTENSIONS.has(ext) && !OpenClawAgent.IMAGE_EXTENSIONS.has(ext)) continue;

        const fullPath = nodePath.join(this.workspace, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          const prevMtime = this.workspaceFileSnapshot.get(entry.name);

          // New file (not in snapshot) or modified file (mtime changed)
          if (prevMtime === undefined || stat.mtimeMs > prevMtime) {
            newFiles.push(fullPath);
          }
        } catch {
          // stat failed, skip
        }
      }
    } catch {
      // workspace not readable, skip
    }

    return newFiles;
  }

  /** Document extensions that should trigger file sending to channel clients */
  private static readonly DOCUMENT_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.txt', '.md', '.html']);

  /** Image extensions */
  private static readonly IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.bmp', '.ico', '.svg']);

  /**
   * Extract file path from a tool call if it represents a file-creation operation.
   * Returns null if the tool call is not a file-creation operation or the file doesn't exist.
   */
  private extractFilePathFromToolCall(toolName: string, rawInput?: Record<string, unknown>): string | null {
    if (!rawInput) return null;
    const n = toolName.toLowerCase();
    if (!/write|edit|create/.test(n)) return null;

    const filePath = (rawInput.path || rawInput.file_path || rawInput.filename) as string | undefined;
    if (!filePath || typeof filePath !== 'string') return null;

    const ext = nodePath.extname(filePath).toLowerCase();
    if (!OpenClawAgent.DOCUMENT_EXTENSIONS.has(ext) && !OpenClawAgent.IMAGE_EXTENSIONS.has(ext)) return null;

    // Verify the file actually exists on disk
    try {
      if (!fs.existsSync(filePath)) return null;
    } catch {
      return null;
    }

    return filePath;
  }

  /** Classify a file path as 'image' or 'file' based on its extension */
  private classifyFileType(filePath: string): 'image' | 'file' {
    const ext = nodePath.extname(filePath).toLowerCase();
    return OpenClawAgent.IMAGE_EXTENSIONS.has(ext) ? 'image' : 'file';
  }
}

export default OpenClawAgent;
