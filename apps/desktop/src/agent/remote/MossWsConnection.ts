/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import WebSocket from 'ws';
import { buildUserMessage, buildAnswerQuestionMessage, buildInterruptMessage, buildSetModelMessage } from '@sudowork/moss-client';
import type { IResponseMessage } from '@sudowork/host-bridge/ipcBridge';
import { mossFrameToResponses, isUserAbortError, extractTextFromContent } from '@sudowork/common/mossResponse';
import { uuid } from '@/common/utils';
import { mainLog, mainError } from '@/process/utils/mainLogger';
import { ProcessConfig } from '@/process/initStorage';
import { getValidToken } from '@/process/bridge/eeclawBridge';

/**
 * Moss Server WebSocket connection config
 * Fully conforms to Moss Server Session API
 */
export interface MossWsConnectionConfig {
  /** Moss Server address (e.g. http://127.0.0.1:43127) */
  serverUrl: string;
  /** Auth token - can be:
   * 1. API Key (moss_sk_xxx...) - will be exchanged for access_token
   * 2. Access Token (JWT) - used directly
   * 3. Empty - requires username/password
   */
  authToken?: string;
  /** Username for password login (when authToken is empty) */
  username?: string;
  /** Password for password login (when authToken is empty) */
  password?: string;
  /** Working directory. When omitted, Moss Server allocates the session workspace. */
  cwd?: string;
  /** Agent name (optional) */
  assistantName?: string;
  /** Skip permission confirmation */
  dangerouslySkipPermissions?: boolean;
  /** Runtime type */
  runtimeType?: 'host' | 'docker';
  /** Resume mode: use existing WebSocket URL */
  wsUrl?: string;
  /** Resume mode: existing session ID */
  sessionId?: string;
  /** Enabled skill names (optional, for non-assistant sessions) */
  enabledSkills?: string[];
}

export interface MossWsCallbacks {
  onMessage: (message: IResponseMessage) => void;
  onPermissionRequest: (request: any, requestId: string) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onReconnecting?: (attempt: number, maxAttempts: number) => void;
  onError?: (error: Error) => void;
}

/**
 * Moss WebSocket connection
 */
export class MossWsConnection {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private wsUrl: string | null = null;
  private workDir: string | null = null;
  private accessToken: string | null = null;
  private state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' = 'idle';
  private reconnectAttempts = 0;
  private isUserAbortSession = false;

  // Pending interrupt requests waiting for confirmation
  private pendingInterrupts = new Map<
    string,
    {
      sentAt: number;
      resolve: (confirmed: boolean) => void;
    }
  >();

  // Pending model switch requests waiting for confirmation
  private pendingModelSwitches = new Map<
    string,
    {
      sentAt: number;
      resolve: (success: boolean) => void;
      modelId: string;
    }
  >();

  private readonly MAX_RECONNECT_ATTEMPTS = 8;
  private readonly BASE_RECONNECT_DELAY_MS = 1000;
  private readonly MAX_RECONNECT_DELAY_MS = 8000;
  private readonly CONNECTION_TIMEOUT_MS = 30000;
  private readonly INTERRUPT_CONFIRMATION_TIMEOUT_MS = 5000;
  private readonly MODEL_SWITCH_TIMEOUT_MS = 30000;

  constructor(
    private config: MossWsConnectionConfig,
    private callbacks: MossWsCallbacks
  ) {}

  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    this.state = 'connecting';
    mainLog('MossWsConnection', `Connecting to ${this.config.serverUrl}`);

    const isResumeMode = !!(this.config.wsUrl || this.wsUrl || this.config.sessionId || this.sessionId);

    try {
      this.accessToken = await this.exchangeToken();

      if (isResumeMode) {
        this.sessionId = this.config.sessionId || this.sessionId!;
        this.wsUrl = this.config.wsUrl || this.wsUrl!;
        mainLog('MossWsConnection', `Resuming session: ${this.sessionId}`);
      } else {
        const sessionData = await this.createMossSession();
        this.sessionId = sessionData.session_id;
        this.wsUrl = sessionData.ws_url;
        this.workDir = sessionData.work_dir;
        // CRITICAL: Persist created session details back to config
        // This ensures reconnects/scheduleReconnect() enter resume mode
        // instead of creating duplicate sessions (the "session storm")
        this.config.wsUrl = sessionData.ws_url;
        this.config.sessionId = sessionData.session_id;
        mainLog('MossWsConnection', `Session created: ${this.sessionId}, workDir: ${this.workDir}`);
      }

      try {
        await this.openWebSocket();
      } catch (wsError) {
        // A 401 on the WS handshake means the access token went bad between
        // exchangeToken and the upgrade (expired or revoked server-side).
        // Force-refresh once and retry before giving up.
        const message = wsError instanceof Error ? wsError.message : String(wsError);
        if (!message.includes('401')) {
          throw wsError;
        }
        mainLog('MossWsConnection', 'WS handshake rejected with 401, force refreshing token and retrying');
        this.accessToken = await this.exchangeToken(true);
        await this.openWebSocket();
      }

      this.state = 'connected';
      this.reconnectAttempts = 0;
      this.callbacks.onConnected?.();
      mainLog('MossWsConnection', 'WebSocket connected');
    } catch (error) {
      this.state = 'idle';
      const err = error instanceof Error ? error : new Error(String(error));
      mainError('MossWsConnection', `Connection failed: ${err.message}`);
      this.callbacks.onError?.(err);
      throw err;
    }
  }

  private async exchangeToken(forceRefresh = false): Promise<string> {
    const isApiKey = !!this.config.authToken && !this.config.authToken.startsWith('eyJ');

    // Enterprise login sessions: always source the freshest token from auth
    // storage. A JWT pinned in config may be expired or revoked (e.g. captured
    // before a logout/re-login), so it is only a fallback when auth storage is
    // unavailable.
    if (!isApiKey) {
      try {
        const token = await getValidToken(forceRefresh);
        if (token) {
          return token;
        }
      } catch (e) {
        mainError('MossWsConnection', 'Failed to get valid token:', e);
        if (this.config.authToken?.startsWith('eyJ')) {
          mainLog('MossWsConnection', 'Falling back to config-provided JWT');
          return this.config.authToken;
        }
        if (!this.config.username && !this.config.password) {
          throw e instanceof Error ? e : new Error(String(e));
        }
      }
    }

    const grantType = this.config.authToken ? 'api_key' : 'password';
    const body =
      grantType === 'api_key'
        ? { grant_type: 'api_key', api_key: this.config.authToken }
        : {
            grant_type: 'password',
            ...(this.config.username ? { username: this.config.username } : {}),
            ...(this.config.password ? { password: this.config.password } : {}),
          };

    const response = await fetch(`${this.config.serverUrl}/api/v1/auth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.authToken ? { 'X-Device-Id': 'moss-ws-connection' } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      mainError('MossWsConnection', `Token exchange failed: ${response.status}`);
      throw new Error(`Failed to exchange token: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { access_token: string };
    return data.access_token;
  }

  private async createMossSession(): Promise<{
    session_id: string;
    ws_url: string;
    work_dir: string;
    runtime: { type: string; configDir?: string };
  }> {
    const body: Record<string, unknown> = {
      dangerously_skip_permissions: this.config.dangerouslySkipPermissions ?? false,
      assistant_name: this.config.assistantName,
      // 新增: 发送启用的 skill 列表（仅当显式指定时）
      enabled_skills: this.config.enabledSkills,
    };
    if (this.config.cwd) {
      body.cwd = this.config.cwd;
    }

    if (this.config.runtimeType) {
      body.runtime = { type: this.config.runtimeType };
    }

    let token = this.accessToken || (await getValidToken());
    let response = await fetch(`${this.config.serverUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      mainLog('MossWsConnection', 'Create session returned 401, force refreshing token and retrying');
      try {
        token = await getValidToken(true);
        this.accessToken = token;
        response = await fetch(`${this.config.serverUrl}/api/v1/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
      } catch (refreshError) {
        mainError('MossWsConnection', 'Token refresh on 401 failed:', refreshError);
      }
    }

    if (!response.ok) {
      const text = await response.text();
      mainError('MossWsConnection', `Create session failed: ${response.status}`);
      throw new Error(`Failed to create Moss session: ${response.status} ${text}`);
    }

    return await response.json();
  }

  private async openWebSocket(): Promise<void> {
    if (!this.wsUrl) {
      throw new Error('No ws_url available');
    }

    // Append refresh_token to wsUrl for server-side token refresh on WS upgrade.
    // OAuth2 sessions hold the IdP's refresh token (or none), which moss cannot
    // verify as a refresh JWT — never put it on the URL.
    let wsUrlWithRefresh = this.wsUrl!;
    try {
      const authStorage = ProcessConfig.getSync('eeclaw.authStorage');
      if (authStorage?.refresh_token && authStorage.session_type !== 'oauth2') {
        const separator = wsUrlWithRefresh.includes('?') ? '&' : '?';
        wsUrlWithRefresh += `${separator}refresh_token=${encodeURIComponent(authStorage.refresh_token)}`;
      }
    } catch {
      /* ignore */
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, this.CONNECTION_TIMEOUT_MS);

      this.ws = new WebSocket(wsUrlWithRefresh, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      this.ws.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.ws.on('message', (data) => this.handleMessage(data.toString()));
      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        this.callbacks.onError?.(err);
        // Settle the connect promise — a handshake failure (e.g. 401/404)
        // must fail fast, not strand connect() awaiting forever.
        reject(err);
      });
      this.ws.on('close', (code) => this.handleClose(code));
    });
  }

  private handleMessage(data: string): void {
    const lines = data.split('\n').filter((line) => line.trim());

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        this.processParsedMessage(parsed);
      } catch {
        this.callbacks.onMessage({
          type: 'content',
          msg_id: uuid(36),
          conversation_id: '',
          data: line,
        });
      }
    }
  }

  private processParsedMessage(msg: any): void {
    if (msg.type === 'hello') {
      if (!this.sessionId && msg.session_id) {
        this.sessionId = msg.session_id;
      }
      return;
    }

    // Handle interrupt confirmation response from server
    if (msg.type === 'control_response') {
      this.handleControlResponse(msg);
      return;
    }

    // Stateless frame mapping (result / system / tool_use / assistant) is owned by
    // the shared @sudowork/common/mossResponse mapper so the desktop and the webui
    // render moss frames identically (DRY). The stateful bits that depend on this
    // connection's lifecycle (user-abort tracking, session id capture, interrupt /
    // permission control frames, plain-text fallback) stay inline below.
    if (msg.type === 'result') {
      // A user-abort result suppresses trailing assistant frames for the rest of
      // this connection; that flag lives on the connection, so track it here.
      if (isUserAbortError(msg)) {
        this.isUserAbortSession = true;
      }
      for (const m of mossFrameToResponses(msg, { sessionId: this.sessionId || '', nextMsgId: () => uuid(36) })) {
        this.callbacks.onMessage(m);
      }
      return;
    }

    if (msg.type === 'system') {
      for (const m of mossFrameToResponses(msg, { sessionId: this.sessionId || '', nextMsgId: () => uuid(36) })) {
        this.callbacks.onMessage(m);
      }
      return;
    }

    if (msg.type === 'control_request') {
      this.callbacks.onPermissionRequest(msg.request, msg.request_id);
      return;
    }

    if (msg.type === 'tool_use') {
      for (const m of mossFrameToResponses(msg, { sessionId: this.sessionId || '', nextMsgId: () => uuid(36) })) {
        this.callbacks.onMessage(m);
      }
      return;
    }

    if (msg.type === 'assistant') {
      if (this.isUserAbortSession) return;
      for (const m of mossFrameToResponses(msg, { sessionId: this.sessionId || '', nextMsgId: () => uuid(36) })) {
        this.callbacks.onMessage(m);
      }
      return;
    }

    if (msg.type === 'user') return;

    if (msg.type === 'tool_progress') {
      this.callbacks.onMessage({
        type: 'acp_tool_call',
        msg_id: msg.tool_use_id || uuid(36),
        conversation_id: '',
        data: {
          sessionId: this.sessionId || '',
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: msg.tool_use_id || uuid(36),
            status: 'in_progress',
            content: [{ type: 'content', content: { type: 'text', text: `Executing... (${msg.elapsed_time_seconds}s)` } }],
          },
        },
      });
      return;
    }

    if (msg.type === 'tool_use_summary') {
      this.callbacks.onMessage({
        type: 'content',
        msg_id: msg.uuid || uuid(36),
        conversation_id: '',
        data: `[Tool Summary] ${msg.summary}`,
      });
      return;
    }

    if (msg.type === 'streamlined_text') {
      if (msg.text && msg.text.trim()) {
        this.callbacks.onMessage({
          type: 'content',
          msg_id: msg.uuid || uuid(36),
          conversation_id: '',
          data: msg.text,
        });
      }
      return;
    }

    if (msg.type === 'streamlined_tool_use_summary') {
      this.callbacks.onMessage({
        type: 'content',
        msg_id: msg.uuid || uuid(36),
        conversation_id: '',
        data: `[Tool Summary] ${msg.tool_summary}`,
      });
      return;
    }

    if (msg.type === 'stream_event') return;
    if (msg.type === 'rate_limit_event') return;
    if (msg.type === 'auth_status') return;
    if (msg.type === 'prompt_suggestion') return;

    if (
      msg.type &&
      ![
        'assistant',
        'user',
        'result',
        'system',
        'tool_progress',
        'tool_use_summary',
        'streamlined_text',
        'streamlined_tool_use_summary',
        'stream_event',
        'rate_limit_event',
        'auth_status',
        'prompt_suggestion',
        'control_request',
        'thinking',
        'finish',
        'end_turn',
        'tool_use',
        'tool_result',
        'content',
        'text',
        'hello',
      ].includes(msg.type)
    ) {
      mainLog('MossWsConnection', `Unknown message type: ${msg.type}`);
      return;
    }

    if (msg.message?.content) {
      const content = extractTextFromContent(msg.message.content);
      if (content && content.trim()) {
        this.callbacks.onMessage({
          type: 'content',
          msg_id: msg.uuid || uuid(36),
          conversation_id: '',
          data: content,
        });
      }
    }
  }

  sendMessage(payload: { content: string; files?: string[]; msg_id?: string; images?: Array<{ type: 'image'; data: string; mimeType: string }> }): { success: boolean; msg?: string } {
    if (this.state !== 'connected' || !this.ws) {
      return { success: false, msg: 'Not connected' };
    }

    try {
      // Shared builder owns the moss user-message shape (image blocks precede
      // text as vision input; see @sudowork/moss-client buildUserMessage).
      const mossMessage = buildUserMessage({
        sessionId: this.sessionId || '',
        text: payload.content,
        images: (payload.images ?? []).map((img) => ({ mediaType: img.mimeType, data: img.data })),
        parentToolUseId: null,
        uuid: payload.msg_id,
      });

      this.ws.send(JSON.stringify(mossMessage));
      return { success: true };
    } catch (err) {
      return { success: false, msg: String(err) };
    }
  }

  sendQuestionAnswer(answer: string, parentToolUseId?: string): { success: boolean; msg?: string } {
    if (this.state !== 'connected' || !this.ws) {
      return { success: false, msg: 'Not connected' };
    }

    try {
      this.ws.send(JSON.stringify(buildAnswerQuestionMessage(this.sessionId || '', parentToolUseId ?? null, answer)));
      return { success: true };
    } catch (err) {
      return { success: false, msg: String(err) };
    }
  }

  sendInterrupt(): void {
    if (this.state !== 'connected' || !this.ws) return;
    this.ws.send(JSON.stringify(buildInterruptMessage()));
  }

  /**
   * Send interrupt and wait for confirmation
   * 发送中断请求并等待确认
   * @returns true if server confirmed interrupt, false if timeout
   */
  async sendInterruptAndWait(): Promise<boolean> {
    if (this.state !== 'connected' || !this.ws) return false;

    const requestId = uuid(36);

    return new Promise((resolve) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingInterrupts.delete(requestId);
        mainLog('MossWsConnection', `Interrupt confirmation timeout for ${requestId}`);
        resolve(false);
      }, this.INTERRUPT_CONFIRMATION_TIMEOUT_MS);

      // Store pending interrupt
      this.pendingInterrupts.set(requestId, {
        sentAt: Date.now(),
        resolve: (confirmed: boolean) => {
          clearTimeout(timeout);
          this.pendingInterrupts.delete(requestId);
          resolve(confirmed);
        },
      });

      // Send interrupt request
      this.ws!.send(JSON.stringify(buildInterruptMessage(requestId)));

      mainLog('MossWsConnection', `Sent interrupt request ${requestId}, waiting for confirmation`);
    });
  }

  respondToPermissionRequest(requestId: string, optionId: string): void {
    if (this.state !== 'connected' || !this.ws) return;
    this.ws.send(
      JSON.stringify({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: { behavior: optionId },
        },
      })
    );
  }

  /**
   * Set model for current session
   * Sends control_request with subtype 'set_model' and waits for confirmation
   */
  setModel(modelId: string): { success: boolean; msg?: string } {
    mainLog('MossWsConnection', `setModel called: modelId=${modelId}, state=${this.state}, ws=${!!this.ws}, readyState=${this.ws?.readyState}`);

    if (this.state !== 'connected' || !this.ws) {
      mainLog('MossWsConnection', `setModel rejected: state=${this.state}, ws=${!!this.ws}`);
      return { success: false, msg: 'Not connected' };
    }

    // Check actual WebSocket state
    if (this.ws.readyState !== WebSocket.OPEN) {
      mainLog('MossWsConnection', `WebSocket not in OPEN state: ${this.ws.readyState} (OPEN=${WebSocket.OPEN}, CLOSING=${WebSocket.CLOSING}, CLOSED=${WebSocket.CLOSED})`);
      this.state = 'closed';
      return { success: false, msg: 'WebSocket connection closed' };
    }

    const requestId = uuid(36);
    const payload = JSON.stringify(buildSetModelMessage(modelId, requestId));

    try {
      this.ws.send(payload);
      mainLog('MossWsConnection', `Model switch request sent: ${modelId}, requestId: ${requestId}`);
      // Return success immediately - the actual confirmation will come via model_changed event
      // The caller can listen for the event or check the result later
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainError('MossWsConnection', `Failed to send model switch: ${msg}`);
      return { success: false, msg };
    }
  }

  private handleClose(code: number): void {
    const wasConnected = this.state === 'connected';
    this.state = 'closed';
    this.ws = null;

    // Reject any pending interrupt confirmations
    for (const [, pending] of this.pendingInterrupts) {
      pending.resolve(false);
    }
    this.pendingInterrupts.clear();

    // Auto-reconnect for unexpected closures during an active session
    if (wasConnected && code !== 1000 && this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
      mainLog('MossWsConnection', `Connection closed unexpectedly (code=${code}), scheduling reconnect (attempt ${this.reconnectAttempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`);
      this.scheduleReconnect();
    } else {
      this.callbacks.onDisconnected?.();
    }
  }

  /**
   * Handle control_response from server (interrupt confirmation)
   */
  private handleControlResponse(msg: any): void {
    const requestId = msg.request_id;
    const pending = this.pendingInterrupts.get(requestId);

    if (pending) {
      mainLog('MossWsConnection', `Received interrupt confirmation for ${requestId}`);
      pending.resolve(true);
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    this.state = 'reconnecting';

    const baseDelay = this.BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);
    const jitter = baseDelay * 0.25 * (2 * Math.random() - 1);
    const delay = Math.min(Math.round(baseDelay + jitter), this.MAX_RECONNECT_DELAY_MS);

    this.callbacks.onReconnecting?.(this.reconnectAttempts, this.MAX_RECONNECT_ATTEMPTS);

    setTimeout(() => {
      this.connect().catch((err) => {
        this.callbacks.onError?.(err);
        if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
          this.scheduleReconnect();
        } else {
          this.callbacks.onDisconnected?.();
        }
      });
    }, delay);
  }

  disconnect(): void {
    this.state = 'closed';
    this.ws?.close();
    this.ws = null;
  }

  isConnected(): boolean {
    // Check both internal state and actual WebSocket state
    if (this.state !== 'connected') {
      return false;
    }
    if (!this.ws) {
      return false;
    }
    return this.ws.readyState === WebSocket.OPEN;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getWsUrl(): string | null {
    return this.wsUrl;
  }

  getWorkDir(): string | null {
    return this.workDir;
  }
}
