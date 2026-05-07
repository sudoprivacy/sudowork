/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import WebSocket from 'ws';
import type { IResponseMessage } from '@/common/ipcBridge';
import { uuid } from '@/common/utils';
import { mainLog, mainError } from '@/process/utils/mainLogger';

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
  /** Working directory */
  cwd: string;
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
  private accessToken: string | null = null;
  private state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' = 'idle';
  private reconnectAttempts = 0;
  private isUserAbortSession = false;

  private readonly MAX_RECONNECT_ATTEMPTS = 8;
  private readonly BASE_RECONNECT_DELAY_MS = 1000;
  private readonly MAX_RECONNECT_DELAY_MS = 8000;
  private readonly CONNECTION_TIMEOUT_MS = 30000;

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

    const isResumeMode = !!this.config.wsUrl;

    try {
      this.accessToken = await this.exchangeToken();

      if (isResumeMode) {
        this.sessionId = this.config.sessionId!;
        this.wsUrl = this.config.wsUrl!;
      } else {
        const sessionData = await this.createMossSession();
        this.sessionId = sessionData.session_id;
        this.wsUrl = sessionData.ws_url;
        mainLog('MossWsConnection', `Session created: ${this.sessionId}`);
      }

      await this.openWebSocket();

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

  private async exchangeToken(): Promise<string> {
    if (this.config.authToken && this.config.authToken.startsWith('eyJ')) {
      return this.config.authToken;
    }

    const grantType = this.config.authToken ? 'api_key' : 'password';
    const body = grantType === 'api_key'
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

    const data = await response.json() as { access_token: string };
    return data.access_token;
  }

  private async createMossSession(): Promise<{
    session_id: string;
    ws_url: string;
    work_dir: string;
    runtime: { type: string; configDir?: string };
  }> {
    const body: Record<string, unknown> = {
      cwd: this.config.cwd,
      dangerously_skip_permissions: this.config.dangerouslySkipPermissions ?? false,
      assistant_name: this.config.assistantName,
    };

    if (this.config.runtimeType) {
      body.runtime = { type: this.config.runtimeType };
    }

    const response = await fetch(`${this.config.serverUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(body),
    });

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

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, this.CONNECTION_TIMEOUT_MS);

      this.ws = new WebSocket(this.wsUrl!, {
        headers: { 'Authorization': `Bearer ${this.accessToken}` },
      });

      this.ws.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.ws.on('message', (data) => this.handleMessage(data.toString()));
      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        this.callbacks.onError?.(err);
      });
      this.ws.on('close', (code, reason) => this.handleClose(code, reason.toString()));
    });
  }

  private handleMessage(data: string): void {
    const lines = data.split('\n').filter(line => line.trim());

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

    if (msg.type === 'result') {
      const isUserAbort = this.isUserAbortError(msg);
      if (isUserAbort) {
        this.isUserAbortSession = true;
      }

      if ((msg.is_error || msg.subtype?.startsWith('error_')) && !isUserAbort) {
        const errorMsg = msg.errors?.join('\n') || msg.result || 'Session ended with error';
        mainError('MossWsConnection', `Session error: ${errorMsg}`);
        this.callbacks.onMessage({
          type: 'error',
          msg_id: msg.uuid || uuid(36),
          conversation_id: '',
          data: errorMsg,
        });
      }

      mainLog('MossWsConnection', `Session ended: ${msg.subtype || 'completed'}`);
      this.callbacks.onMessage({
        type: 'finish',
        msg_id: msg.uuid || uuid(36),
        conversation_id: '',
        data: {
          subtype: msg.subtype,
          duration_ms: msg.duration_ms,
          total_cost_usd: msg.total_cost_usd,
          usage: msg.usage,
          num_turns: msg.num_turns,
          isUserAbort,
        },
      });
      return;
    }

    if (msg.type === 'system') {
      if (msg.subtype === 'init') {
        const modelName = msg.model || 'unknown';
        this.callbacks.onMessage({
          type: 'acp_model_info',
          msg_id: uuid(36),
          conversation_id: '',
          data: {
            source: 'models',
            currentModelId: modelName,
            currentModelLabel: modelName,
            canSwitch: false,
            availableModels: [],
          },
        });
      }
      return;
    }

    if (msg.type === 'control_request') {
      this.callbacks.onPermissionRequest(msg.request, msg.request_id);
      return;
    }

    if (msg.type === 'assistant') {
      if (this.isUserAbortSession) return;

      if (msg.error || msg.isApiErrorMessage) {
        const errorMsg = this.extractTextFromContent(msg.message?.content) || msg.error || 'Unknown error';
        mainError('MossWsConnection', `Assistant error: ${errorMsg}`);
        this.callbacks.onMessage({
          type: 'error',
          msg_id: msg.uuid || uuid(36),
          conversation_id: '',
          data: errorMsg,
        });
        return;
      }

      const contentArray = msg.message?.content;
      if (Array.isArray(contentArray)) {
        for (const block of contentArray) {
          if (block?.type === 'thinking') {
            const thinkingContent = block.thinking || block.text || '';
            if (thinkingContent && thinkingContent.trim()) {
              this.callbacks.onMessage({
                type: 'thought',
                msg_id: `${msg.uuid || uuid(36)}-thought`,
                conversation_id: '',
                data: { subject: 'Thinking', description: thinkingContent },
              });
            }
          } else if (block?.type === 'text') {
            const textContent = block.text || '';
            if (textContent && textContent.trim() && !this.isAbortRelatedText(textContent)) {
              this.callbacks.onMessage({
                type: 'content',
                msg_id: msg.uuid || uuid(36),
                conversation_id: '',
                data: textContent,
              });
            }
          } else if (block?.type === 'tool_use') {
            this.callbacks.onMessage({
              type: 'acp_tool_call',
              msg_id: block.id || uuid(36),
              conversation_id: '',
              data: {
                sessionId: this.sessionId || '',
                update: {
                  sessionUpdate: 'tool_call',
                  toolCallId: block.id || uuid(36),
                  status: 'pending',
                  title: block.name,
                  kind: 'execute',
                  rawInput: block.input,
                  content: [],
                },
              },
            });
          }
        }
      } else {
        const content = this.extractTextFromContent(contentArray);
        if (content && content.trim() && !this.isAbortRelatedText(content)) {
          this.callbacks.onMessage({
            type: 'content',
            msg_id: msg.uuid || uuid(36),
            conversation_id: '',
            data: content,
          });
        }
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

    if (msg.type && !['assistant', 'user', 'result', 'system', 'tool_progress', 'tool_use_summary',
        'streamlined_text', 'streamlined_tool_use_summary', 'stream_event', 'rate_limit_event',
        'auth_status', 'prompt_suggestion', 'control_request', 'thinking', 'finish', 'end_turn',
        'tool_use', 'tool_result', 'content', 'text', 'hello'].includes(msg.type)) {
      mainLog('MossWsConnection', `Unknown message type: ${msg.type}`);
      return;
    }

    if (msg.message?.content) {
      const content = this.extractTextFromContent(msg.message.content);
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

  private extractTextFromContent(content: any): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .filter((item: any) => item?.type === 'text')
      .map((item: any) => item.text || '')
      .join('');
  }

  sendMessage(payload: { content: string; files?: string[]; msg_id?: string }): { success: boolean; msg?: string } {
    if (this.state !== 'connected' || !this.ws) {
      return { success: false, msg: 'Not connected' };
    }

    try {
      const mossMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: payload.content }],
        },
        parent_tool_use_id: null as string | null,
        session_id: this.sessionId || '',
        uuid: payload.msg_id || uuid(36),
      };

      this.ws.send(JSON.stringify(mossMessage));
      return { success: true };
    } catch (err) {
      return { success: false, msg: String(err) };
    }
  }

  sendInterrupt(): void {
    if (this.state !== 'connected' || !this.ws) return;
    this.ws.send(JSON.stringify({
      type: 'control_request',
      request_id: uuid(36),
      request: { subtype: 'interrupt' },
    }));
  }

  respondToPermissionRequest(requestId: string, optionId: string): void {
    if (this.state !== 'connected' || !this.ws) return;
    this.ws.send(JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: { behavior: optionId },
      },
    }));
  }

  private handleClose(code: number, reason: string): void {
    const wasConnected = this.state === 'connected';
    this.state = 'closed';
    this.ws = null;

    // Auto-reconnect for unexpected closures during an active session
    if (wasConnected && code !== 1000 && this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
      mainLog('MossWsConnection', `Connection closed unexpectedly (code=${code}), scheduling reconnect (attempt ${this.reconnectAttempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`);
      this.scheduleReconnect();
    } else {
      this.callbacks.onDisconnected?.();
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
      this.connect().catch(err => {
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

  private isUserAbortError(msg: any): boolean {
    if (msg.result_type === 'user') return true;
    const errorMsg = msg.errors?.join('\n') || msg.result || '';
    if (errorMsg.includes('Request was aborted') ||
        errorMsg.includes('AbortError') ||
        errorMsg.includes('aborted by user') ||
        errorMsg.includes('user abort')) return true;
    if (msg.stop_reason === 'abort' || msg.stop_reason === 'user_abort') return true;
    return false;
  }

  private isAbortRelatedText(text: string): boolean {
    const lowerText = text.toLowerCase();
    return lowerText.includes('request interrupted by user') ||
        lowerText.includes('request was aborted') ||
        lowerText.includes('no response requested') ||
        lowerText.includes('aborted by user') ||
        lowerText.includes('interrupted by user');
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getWsUrl(): string | null {
    return this.wsUrl;
  }
}