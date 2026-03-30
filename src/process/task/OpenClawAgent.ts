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
  private statusMessageId: string | null = null;
  private _lastConnectionStatus: string | null = null;
  private disconnectTipMessageId: string | null = null;
  private isFirstMessage: boolean = true;

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

      // Create and configure connection
      this.connection = new OpenClawGatewayConnection({
        url: `ws://${connectHost}:${connectPort}`,
        stateDir: stateDir ?? undefined,
        token,
        password,
        onEvent: (evt) => this.handleEvent(evt),
        onHelloOk: (_hello: HelloOk) => {},
        onConnectError: (err) => this.handleConnectError(err),
        onClose: (code, reason) => this.handleClose(code, reason),
        onTokenMismatch: !useExternal
          ? async () => {
              const { serviceManager } = await import('@process/services/serviceManager');
              await serviceManager.restartOpenClaw();
            }
          : undefined,
      });

      this.connection.start();

      // Wait for connection
      await this.waitForConnection();
      this.emitStatusMessage('connected');

      // Resolve session
      await this.resolveSession();
      this.emitStatusMessage('session_active');
    } catch (error) {
      this.emitStatusMessage('error');
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.emitErrorMessage(`Failed to start Sudoclaw agent: ${errorMsg}`);
      throw error;
    }
  }

  private async waitForConnection(timeoutMs = 30000): Promise<void> {
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
        return;
      } catch (err) {
        console.warn('[OpenClawAgent] Failed to resume session, using default:', err);
      }
    }

    const defaultKey = this.conversation_id;
    try {
      const resetResult = await this.connection.sessionsReset({ key: defaultKey, reason: 'new' });
      this.connection.sessionKey = resetResult.key;
    } catch (err) {
      console.warn('[OpenClawAgent] Failed to reset session, trying plain resolve:', err);
      try {
        const result = await this.connection.sessionsResolve({ key: defaultKey });
        this.connection.sessionKey = result.key;
      } catch (resolveErr) {
        console.warn('[OpenClawAgent] Failed to resolve default session, falling back:', resolveErr);
        this.connection.sessionKey = defaultKey;
      }
    }

    if (this.connection.sessionKey !== resumeKey) {
      this.saveSessionKey(this.connection.sessionKey!);
    }
  }

  // ========== Public API (BaseAgent contract) ==========

  async sendMessage(data: { content: string; agentContent?: string; files?: string[]; msg_id?: string; skills?: string[] }) {
    cronBusyGuard.setProcessing(this.conversation_id, true);
    this.status = 'running';
    try {
      await this.bootstrap;

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
      }

      // Reset streaming state
      this.currentStreamMsgId = null;
      this.accumulatedAssistantText = '';
      this.agentAssistantFallbackText = '';
      this.adapter.resetMessageTracking();

      // On the first message, prepend a workspace directive so the agent uses the
      // per-conversation workspace dir for all file operations and bash commands.
      let processedContent = data.agentContent || data.content;
      if (this.isFirstMessage && this.workspace) {
        this.isFirstMessage = false;
        const configuredWorkspace = getSudoclawWorkspaceRoot();
        processedContent = `[System: Very important — DO NOT use configured workspace '${configuredWorkspace}'! ` + `Your working directory for this session ONLY is '${this.workspace}'. ` + `All file operations, bash commands, and output (when calling write() tool) should use this session working directory unless the user explicitly specifies otherwise. ` + `For write(), unless user explicitly specifies an output location, double check that it's not mistakenly output to '${configuredWorkspace}', otherwise move it to the session directory.]\n\n` + processedContent;
      } else {
        this.isFirstMessage = false;
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

      // Send chat message
      await this.connection!.chatSend({
        sessionKey: this.connection!.sessionKey!,
        message: processedContent,
        skills: data.skills,
      });

      return { success: true, data: null } as AcpResult;
    } catch (error) {
      cronBusyGuard.setProcessing(this.conversation_id, false);
      this.status = 'finished';

      const errorMsg = error instanceof Error ? error.message : String(error);
      this.emitErrorMessage(`Failed to send Sudoclaw message: ${errorMsg}`);
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
    if (this.connection?.isConnected && this.connection?.sessionKey) {
      try {
        await this.connection.chatAbort({ sessionKey: this.connection.sessionKey });
      } catch (err) {
        console.warn('[OpenClawAgent] chatAbort failed:', err);
      }
    }
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
        this.handleDisconnect('Gateway shutdown');
        break;
      case 'health':
      case 'tick':
        break;
      default:
        break;
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
        this.emitErrorMessage(event.errorMessage || 'Unknown error');
        this.handleEndTurn();
        break;

      default:
        console.warn('[OpenClawAgent] handleChatEvent: unknown state:', (event as { state: unknown }).state);
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
        if (!event.data) break;
        const toolData = event.data as {
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
        };

        const phaseToStatus: Record<string, 'pending' | 'in_progress' | 'completed' | 'failed'> = {
          start: 'in_progress',
          update: 'in_progress',
          partialResult: 'in_progress',
        };
        let status: 'pending' | 'in_progress' | 'completed' | 'failed';
        if (toolData.phase === 'result') {
          status = toolData.isError ? 'failed' : 'completed';
        } else {
          status = phaseToStatus[toolData.phase ?? ''] ?? ((toolData.status as 'pending' | 'in_progress' | 'completed' | 'failed') || 'pending');
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

        const messages = this.adapter.convertSessionUpdate(acpUpdate);
        for (const message of messages) {
          this.emitTMessage(message);
        }
        break;
      }

      case 'lifecycle':
        break;

      case 'assistant': {
        if (!event.data) break;
        const text = (event.data.text as string) || '';
        if (text) {
          this.agentAssistantFallbackText = text;
        }
        break;
      }

      default:
        console.warn('[OpenClawAgent] Unhandled agent stream:', event.stream, event);
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
        console.error('[OpenClawAgent] Permission error:', error);
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
    console.error('[OpenClawAgent] Connection error:', err);
    this.emitErrorMessage(`Connection error: ${err.message}`);
  }

  private handleClose(_code: number, reason: string): void {
    this.handleDisconnect(reason);
  }

  private handleEndTurn(): void {
    this.currentStreamMsgId = null;
    this.accumulatedAssistantText = '';
    this.agentAssistantFallbackText = '';

    const msg: IResponseMessage = {
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: null,
    };

    // Clear busy guard
    cronBusyGuard.setProcessing(this.conversation_id, false);

    // Emit signal events to frontend + channels
    ipcBridge.openclawConversation.responseStream.emit(msg);
    ipcBridge.conversation.responseStream.emit(msg);
    channelEventBus.emitAgentMessage(this.conversation_id, msg);
  }

  private handleDisconnect(reason: string): void {
    this.emitStatusMessage('disconnected');
    this.emitErrorMessage(`Gateway disconnected: ${reason}`, 'disconnect');

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
        console.warn('[OpenClawAgent] chat.history fallback failed:', err);
      })
      .finally(() => {
        this.handleEndTurn();
      });
  }

  // ========== Stream & Signal Emission (merged from Manager) ==========

  /** Replace openclaw with sudoclaw in user-facing message content */
  private sanitizeDisplayText(msg: IResponseMessage): void {
    if (msg.type === 'error' && typeof msg.data === 'string') {
      (msg as { data: string }).data = msg.data.replace(/\bopenclaw\b/g, 'sudoclaw');
    } else if ((msg.type === 'content' || msg.type === 'user_content') && msg.data) {
      const d = msg.data as string | { content?: string };
      if (typeof d === 'string') {
        (msg as { data: string }).data = d.replace(/\bopenclaw\b/g, 'sudoclaw');
      } else if (d && typeof (d as { content?: string }).content === 'string') {
        (d as { content: string }).content = (d as { content: string }).content.replace(/\bopenclaw\b/g, 'sudoclaw');
      }
    }
  }

  /** Handle stream messages: DB persist + UI emit + channel emit */
  private handleStreamMessage(message: IResponseMessage): void {
    const msg = { ...message, conversation_id: this.conversation_id };
    this.sanitizeDisplayText(msg);

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
      console.error('[OpenClawAgent] Failed to save session key:', error);
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
}

export default OpenClawAgent;
