/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Remote agent connection over WebSocket.
 *
 * Reuses the ACP JSON-RPC protocol but sends messages over WebSocket instead
 * of spawning a local CLI process. The server handles the actual agent process.
 */

import WebSocket from 'ws';
import type {
  AcpMessage,
  AcpNotification,
  AcpPermissionRequest,
  AcpPromptResponseUsage,
  AcpRequest,
  AcpResponse,
  AcpSessionConfigOption,
  AcpSessionModels,
  AcpSessionUpdate,
} from '@/types/acpTypes';
import { ACP_METHODS, JSONRPC_VERSION } from '@/types/acpTypes';

interface PendingRequest<T = unknown> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeoutId?: NodeJS.Timeout;
  method: string;
}

export interface RemoteConnectionOptions {
  /** Server URL (e.g. "http://localhost:3200") */
  serverUrl: string;
  /** JWT token for authentication */
  token: string;
  /** WebSocket path (default "/ws/eeclaw") */
  wsPath?: string;
}

export class RemoteConnection {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private token: string;
  private wsPath: string;
  private pendingRequests = new Map<number, PendingRequest<unknown>>();
  private nextRequestId = 0;
  private sessionId: string | null = null;
  private isInitialized = false;
  private initializeResponse: AcpResponse | null = null;

  private configOptions: AcpSessionConfigOption[] | null = null;
  private models: AcpSessionModels | null = null;

  private promptTimeoutMs: number = 300000;

  // Event callbacks
  onSessionUpdate: (data: AcpSessionUpdate) => void = () => {};
  onPermissionRequest: (data: AcpPermissionRequest) => Promise<{ optionId: string }> = () =>
    Promise.resolve({ optionId: 'allow' });
  onEndTurn: () => void = () => {};
  onPromptUsage: (usage: AcpPromptResponseUsage) => void = () => {};
  onDisconnect: (error?: Error) => void = () => {};

  constructor(options: RemoteConnectionOptions) {
    this.serverUrl = options.serverUrl;
    this.token = options.token;
    this.wsPath = options.wsPath || '/ws/eeclaw';
  }

  /**
   * Connect to the enterprise server via WebSocket
   */
  async connect(): Promise<void> {
    if (this.ws) {
      await this.disconnect();
    }

    return new Promise((resolve, reject) => {
      const wsUrl = this.serverUrl.replace(/^http/, 'ws') + this.wsPath;
      this.ws = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      this.ws.on('open', () => {
        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as AcpMessage;
          this.handleMessage(message);
        } catch {
          // Ignore parse errors
        }
      });

      this.ws.on('error', (error) => {
        reject(error);
      });

      this.ws.on('close', () => {
        this.handleDisconnect(new Error('WebSocket connection closed'));
      });

      // Set timeout for connection
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
        this.ws?.close();
      }, 10000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
      });
    });
  }

  /**
   * Initialize the ACP protocol with the server
   */
  async initialize(): Promise<AcpResponse> {
    const response = await this.sendRequest<AcpResponse>('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
      },
    });
    this.isInitialized = true;
    this.initializeResponse = response;
    return response;
  }

  /**
   * Create a new session or resume an existing one
   */
  async newSession(cwd: string = '.', options?: { resumeSessionId?: string; forkSession?: boolean }): Promise<AcpResponse & { sessionId?: string }> {
    const response = await this.sendRequest<AcpResponse & { sessionId?: string }>('session/new', {
      cwd,
      mcpServers: [] as unknown[],
      ...(options?.resumeSessionId && { resumeSessionId: options.resumeSessionId }),
      ...(options?.forkSession && { forkSession: options.forkSession }),
    });

    this.sessionId = response.sessionId;
    this.parseSessionCapabilities(response);
    return response;
  }

  /**
   * Load/resume an existing session
   */
  async loadSession(sessionId: string, cwd: string = '.'): Promise<AcpResponse & { sessionId?: string }> {
    const response = await this.sendRequest<AcpResponse & { sessionId?: string }>('session/load', {
      sessionId,
      cwd,
      mcpServers: [] as unknown[],
    });

    this.sessionId = response.sessionId || sessionId;
    this.parseSessionCapabilities(response);
    return response;
  }

  /**
   * Send a prompt to the agent
   */
  async sendPrompt(prompt: string, images?: Array<{ type: 'image'; data: string; mimeType: string }>): Promise<AcpResponse> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    const promptBlocks: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [{ type: 'text', text: prompt }];
    if (images && images.length > 0) {
      for (const img of images) {
        promptBlocks.push({ type: 'image', data: img.data, mimeType: img.mimeType });
      }
    }

    return await this.sendRequest('session/prompt', {
      sessionId: this.sessionId,
      prompt: promptBlocks,
    });
  }

  /**
   * Cancel the current turn
   */
  async cancel(): Promise<void> {
    if (!this.sessionId || !this.ws) {
      return;
    }

    this.sendNotification(ACP_METHODS.SESSION_CANCEL, { sessionId: this.sessionId });
  }

  /**
   * Set session mode
   */
  async setSessionMode(modeId: string): Promise<AcpResponse> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    return this.sendRequest('session/set_mode', {
      sessionId: this.sessionId,
      modeId,
    });
  }

  /**
   * Set model
   */
  async setModel(modelId: string): Promise<AcpResponse> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    const response = await this.sendRequest<AcpResponse>('session/set_model', {
      sessionId: this.sessionId,
      modelId,
    });

    if (this.models) {
      this.models = { ...this.models, currentModelId: modelId };
    }

    return response;
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.resetConnectionState();
  }

  /**
   * Send a JSON-RPC request and wait for response
   */
  private sendRequest<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws) {
      return Promise.reject(new Error('Not connected'));
    }

    const id = this.nextRequestId++;
    const message: AcpRequest = {
      jsonrpc: JSONRPC_VERSION,
      id,
      method,
      ...(params && { params }),
    };

    return new Promise((resolve, reject) => {
      const timeoutDuration = method === 'session/prompt' ? this.promptTimeoutMs : 60000;
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`${method} timed out after ${timeoutDuration / 1000}s`));
      }, timeoutDuration);

      this.pendingRequests.set(id, {
        resolve: (value: T) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
        timeoutId,
        method,
      });

      this.ws!.send(JSON.stringify(message));
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   */
  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.ws) {
      return;
    }

    const message: AcpNotification = {
      jsonrpc: JSONRPC_VERSION,
      method,
      ...(params && { params }),
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Handle incoming JSON-RPC message
   */
  private handleMessage(message: AcpMessage): void {
    try {
      if ('method' in message) {
        // Incoming request/notification
        this.handleIncomingRequest(message as { method: string; params?: unknown; id?: number }).catch(() => {});
      } else if ('id' in message && typeof message.id === 'number' && this.pendingRequests.has(message.id)) {
        const pending = this.pendingRequests.get(message.id)!;
        this.pendingRequests.delete(message.id);

        if ('result' in message) {
          // Check for end_turn and usage data
          const result = message.result as Record<string, unknown> | undefined;
          if (result?.stopReason === 'end_turn' || result?.stopReason === 'cancelled') {
            this.onEndTurn();
          }
          if (result?.usage && typeof result.usage === 'object') {
            const usage = result.usage as AcpPromptResponseUsage;
            if (typeof usage.totalTokens === 'number') {
              this.onPromptUsage(usage);
            }
          }
          pending.resolve(message.result);
        } else if ('error' in message) {
          pending.reject(new Error(message.error?.message || 'Unknown error'));
        }
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Handle incoming request from server
   */
  private async handleIncomingRequest(msg: { method: string; params?: unknown; id?: number }): Promise<void> {
    try {
      let result: unknown = null;

      switch (msg.method) {
        case ACP_METHODS.SESSION_UPDATE:
          result = null;
          // Parse config options from update
          const params = msg.params as Record<string, unknown> | undefined;
          const update = params?.update as Record<string, unknown> | undefined;
          if (update?.sessionUpdate === 'config_option_update') {
            const configOpts = update as { configOptions?: AcpSessionConfigOption[] };
            if (Array.isArray(configOpts.configOptions)) {
              this.configOptions = configOpts.configOptions;
            }
          }
          this.onSessionUpdate(msg.params as AcpSessionUpdate);
          break;

        case ACP_METHODS.REQUEST_PERMISSION: {
          const response = await this.onPermissionRequest(msg.params as AcpPermissionRequest);
          const optionId = response.optionId;
          const outcome = optionId.includes('reject') ? 'rejected' : 'selected';
          result = { outcome: { outcome, optionId } };
          break;
        }

        case ACP_METHODS.READ_TEXT_FILE:
        case ACP_METHODS.WRITE_TEXT_FILE:
          // File operations are handled by the server in remote mode
          // Just acknowledge
          result = null;
          break;

        default:
          // Unknown method
          return;
      }

      // Send response for requests
      if (msg.id !== undefined && msg.id !== null) {
        this.sendResponse({
          jsonrpc: JSONRPC_VERSION,
          id: msg.id,
          result,
        });
      }
    } catch (error) {
      if (msg.id !== undefined && msg.id !== null) {
        this.sendResponse({
          jsonrpc: JSONRPC_VERSION,
          id: msg.id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }

  /**
   * Send a JSON-RPC response back to server
   */
  private sendResponse(response: { jsonrpc: string; id: number; result?: unknown; error?: { code: number; message: string } }): void {
    if (this.ws) {
      this.ws.send(JSON.stringify(response));
    }
  }

  /**
   * Handle unexpected disconnect
   */
  private handleDisconnect(error: Error): void {
    // Reject all pending requests
    for (const [, request] of this.pendingRequests) {
      if (request.timeoutId) {
        clearTimeout(request.timeoutId);
      }
      request.reject(error);
    }
    this.pendingRequests.clear();

    this.resetConnectionState();
    this.onDisconnect(error);
  }

  /**
   * Reset connection state
   */
  private resetConnectionState(): void {
    this.ws = null;
    this.sessionId = null;
    this.isInitialized = false;
    this.initializeResponse = null;
    this.configOptions = null;
    this.models = null;
  }

  /**
   * Parse session capabilities from response
   */
  private parseSessionCapabilities(response: unknown): void {
    const result = response as Record<string, unknown>;
    if (Array.isArray(result.configOptions)) {
      this.configOptions = result.configOptions as AcpSessionConfigOption[];
    }
    const modelsSource = result.models || (result._meta as Record<string, unknown> | undefined)?.models;
    if (modelsSource && typeof modelsSource === 'object') {
      this.models = modelsSource as AcpSessionModels;
    }
  }

  // --- Getters ---

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  get hasActiveSession(): boolean {
    return this.sessionId !== null;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  getInitializeResponse(): AcpResponse | null {
    return this.initializeResponse;
  }

  getConfigOptions(): AcpSessionConfigOption[] | null {
    return this.configOptions;
  }

  getModels(): AcpSessionModels | null {
    return this.models;
  }

  setPromptTimeout(timeoutMs: number): void {
    this.promptTimeoutMs = timeoutMs;
  }

  getPromptTimeout(): number {
    return this.promptTimeoutMs;
  }
}
