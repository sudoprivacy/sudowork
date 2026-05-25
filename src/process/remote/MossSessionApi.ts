/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mainLog, mainError } from '@process/utils/mainLogger';
import { getValidToken } from '@process/bridge/eeclawBridge';
import { ProcessConfig } from '@process/initStorage';
import WebSocket from 'ws';
import { uuid } from '@/common/utils';
import type { IResponseMessage } from '@/common/ipcBridge';

/**
 * Moss Server Session API client
 *
 * 企业模式下会话管理全部通过 Moss Server API 实现
 * 本地不持久化任何会话数据
 */
export class MossSessionApi {
  private serverUrl: string;
  private accessToken: string | null = null;
  private wsConnections: Map<string, WebSocket> = new Map();
  /** Flag to indicate this session was aborted by user */
  private userAbortSessions: Set<string> = new Set();

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  /**
   * Set access token directly (JWT from eeclaw auth storage)
   * Directly setting the access token. For automatic refresh, use ensureAuthenticated() instead.
   *
   * @param accessToken - JWT access token from enterprise login
   */
  setAccessToken(accessToken: string): void {
    this.accessToken = accessToken;
  }

  /**
   * Ensure access token is valid, refreshing if necessary
   * Returns a valid access token, refreshing if expired (within 5 min buffer).
   */
  async ensureAuthenticated(): Promise<string> {
    if (this.accessToken) {
      const authStorage = ProcessConfig.getSync('eeclaw.authStorage');
      if (authStorage?.expires_at && authStorage.expires_at > Date.now() + 5 * 60 * 1000) {
        return this.accessToken;
      }
    }

    const token = await getValidToken();
    this.accessToken = token;
    return token;
  }

  /**
   * Force refresh the access token, ignoring cache.
   * Used when a 401 response indicates the current token is invalid on the server.
   */
  async forceRefreshToken(): Promise<string> {
    mainLog('MossSessionApi', 'Force refreshing token due to 401');
    this.accessToken = null;
    const token = await getValidToken(true);
    this.accessToken = token;
    return token;
  }

  /**
   * Fetch with automatic 401 retry: if the first request returns 401,
   * force-refresh the token and retry once.
   */
  private async fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
    const token = await this.ensureAuthenticated();
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);

    let response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
      mainLog('MossSessionApi', `Request to ${url} returned 401, attempting token refresh and retry`);
      try {
        const newToken = await this.forceRefreshToken();
        const retryHeaders = new Headers(options.headers);
        retryHeaders.set('Authorization', `Bearer ${newToken}`);
        response = await fetch(url, { ...options, headers: retryHeaders });
      } catch (refreshError) {
        mainError('MossSessionApi', 'Token refresh on 401 failed:', refreshError);
      }
    }

    return response;
  }

  /**
   * Get all sessions from Moss Server
   * GET /api/v1/sessions
   *
   * WARNING: This API is NOT for sudowork client session list.
   * Session list metadata is maintained locally in client SQLite.
   * 警告：此 API 不用于 sudowork 客户端会话列表。
   * 会话列表元数据维护在本地客户端 SQLite。
   *
   * This method is kept for future administrative/debugging purposes only.
   * 此方法仅保留用于未来的管理/调试目的。
   */
  async listSessions(): Promise<MossSession[]> {
    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/sessions`, {
      method: 'GET',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to list sessions: ${response.status} ${text}`);
    }

    const data = await response.json();
    return data.sessions || [];
  }

  /**
   * Create a new session on Moss Server
   * POST /api/v1/sessions
   */
  async createSession(params: { cwd?: string; assistantName?: string; dangerouslySkipPermissions?: boolean; runtimeType?: 'host' | 'docker' }): Promise<MossSession> {
    mainLog('MossSessionApi', `Creating session: cwd=${params.cwd}, assistant=${params.assistantName || 'default'}`);

    const body: Record<string, unknown> = {
      cwd: params.cwd || process.cwd(),
      dangerously_skip_permissions: params.dangerouslySkipPermissions ?? false,
      assistant_name: params.assistantName,
    };

    if (params.runtimeType) {
      body.runtime = { type: params.runtimeType };
    }

    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to create session: ${response.status} ${text}`);
    }

    const session = (await response.json()) as MossSession;
    mainLog('MossSessionApi', `Session created: ${session.session_id}`);
    return session;
  }

  /**
   * Get session details
   * GET /api/v1/sessions/{sessionId}
   */
  async getSession(sessionId: string): Promise<MossSession> {
    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/sessions/${sessionId}`, {
      method: 'GET',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get session: ${response.status} ${text}`);
    }

    const data = await response.json();
    // API returns {"session": {...}, "ws_url": "..."} - extract the session object
    // API 返回 {"session": {...}, "ws_url": "..."} - 提取 session 对象
    return (data.session || data) as MossSession;
  }

  /**
   * Delete a session
   * DELETE /api/v1/sessions/{sessionId}
   */
  async deleteSession(sessionId: string): Promise<void> {
    mainLog('MossSessionApi', `Deleting session: ${sessionId}`);

    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/sessions/${sessionId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to delete session: ${response.status} ${text}`);
    }

    // Close WebSocket if exists
    const ws = this.wsConnections.get(sessionId);
    if (ws) {
      ws.close();
      this.wsConnections.delete(sessionId);
    }

    mainLog('MossSessionApi', `Session deleted: ${sessionId}`);
  }

  /**
   * Update session metadata (e.g., title)
   * PATCH /api/v1/sessions/{sessionId}
   */
  async updateSession(sessionId: string, updates: { title?: string }): Promise<MossSession> {
    mainLog('MossSessionApi', `Updating session: ${sessionId}, updates: ${JSON.stringify(updates)}`);

    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to update session: ${response.status} ${text}`);
    }

    const session = (await response.json()) as MossSession;
    mainLog('MossSessionApi', `Session updated: ${sessionId}`);
    return session;
  }

  /**
   * Get session context (history messages, summary, usage)
   * GET /api/v1/sessions/{sessionId}/context
   */
  async getSessionContext(sessionId: string): Promise<{
    session: MossSession;
    usage?: {
      totalTokens?: number;
      inputTokens?: number;
      outputTokens?: number;
      totalCost?: number;
      turnCount?: number;
    };
    context?: {
      customTitle?: string;
      tag?: string;
      summary?: string;
      messages: any[];
    };
  }> {
    mainLog('MossSessionApi', `Getting session context: ${sessionId}`);

    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/sessions/${sessionId}/context`, {
      method: 'GET',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get session context: ${response.status} ${text}`);
    }

    const data = await response.json();
    mainLog('MossSessionApi', `Session context loaded for ${sessionId}, messages: ${data.context?.messages?.length || 0}`);
    return data;
  }

  /**
   * Terminate a running session
   * POST /api/v1/sessions/{sessionId}/terminate
   */
  async terminateSession(sessionId: string): Promise<void> {
    mainLog('MossSessionApi', `Terminating session: ${sessionId}`);

    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/sessions/${sessionId}/terminate`, {
      method: 'POST',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to terminate session: ${response.status} ${text}`);
    }

    // Close WebSocket if exists
    const ws = this.wsConnections.get(sessionId);
    if (ws) {
      ws.close();
      this.wsConnections.delete(sessionId);
    }

    mainLog('MossSessionApi', `Session terminated: ${sessionId}`);
  }

  /**
   * Resume an existing session to get WebSocket URL
   * POST /api/v1/sessions/{sessionId}/resume
   */
  async resumeSession(sessionId: string): Promise<{ wsUrl: string; session: MossSession }> {
    mainLog('MossSessionApi', `Resuming session: ${sessionId}`);

    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/sessions/${sessionId}/resume`, {
      method: 'POST',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to resume session: ${response.status} ${text}`);
    }

    const data = await response.json();
    mainLog('MossSessionApi', `Resume response: ${JSON.stringify(data, null, 2)}`);

    const wsUrl = data.ws_url || data.wsUrl || '';
    if (!wsUrl) {
      throw new Error(`Resume response missing ws_url for session ${sessionId}`);
    }

    return {
      wsUrl,
      session: data.session || {},
    };
  }

  /**
   * Connect to session WebSocket and send message
   * Returns a promise that resolves when connection is established
   */
  async connectAndSend(sessionId: string, wsUrl: string, message: string, onMessage: (msg: IResponseMessage) => void, onFinish: () => void, onError: (err: Error) => void): Promise<void> {
    const token = await this.ensureAuthenticated();
    mainLog('MossSessionApi', `Connecting to WebSocket: ${wsUrl}`);

    // Append refresh_token to wsUrl for server-side token refresh on WS upgrade
    let wsUrlWithRefresh = wsUrl;
    try {
      const authStorage = ProcessConfig.getSync('eeclaw.authStorage');
      if (authStorage?.refresh_token) {
        const separator = wsUrlWithRefresh.includes('?') ? '&' : '?';
        wsUrlWithRefresh += `${separator}refresh_token=${encodeURIComponent(authStorage.refresh_token)}`;
      }
    } catch {
      /* ignore */
    }

    const ws = new WebSocket(wsUrlWithRefresh, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    this.wsConnections.set(sessionId, ws);

    ws.on('open', () => {
      mainLog('MossSessionApi', `WebSocket connected for session ${sessionId}`);

      // Send user message
      const mossMessage = {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: message }],
        },
        parent_tool_use_id: null as string | null,
        session_id: sessionId,
        uuid: uuid(36),
      };
      ws.send(JSON.stringify(mossMessage));
      mainLog('MossSessionApi', `Message sent to session ${sessionId}`);
    });

    ws.on('message', (data) => {
      const lines = data
        .toString()
        .split('\n')
        .filter((line) => line.trim());
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          this.processMessage(parsed, onMessage, onFinish);
        } catch {
          // Non-JSON content
          onMessage({
            type: 'content',
            msg_id: uuid(36),
            conversation_id: sessionId,
            data: line,
          });
        }
      }
    });

    ws.on('error', (err) => {
      mainError('MossSessionApi', `WebSocket error: ${err.message}`);
      onError(err);
    });

    ws.on('close', (code, reason) => {
      mainLog('MossSessionApi', `WebSocket closed: code=${code}, reason=${reason}`);
      this.wsConnections.delete(sessionId);
      onFinish();
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 30000);

      ws.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Send interrupt to stop current operation
   */
  sendInterrupt(sessionId: string): void {
    const ws = this.wsConnections.get(sessionId);
    if (!ws) return;

    ws.send(
      JSON.stringify({
        type: 'control_request',
        request_id: uuid(36),
        request: { subtype: 'interrupt' },
      })
    );
    mainLog('MossSessionApi', `Interrupt sent to session ${sessionId}`);
  }

  /**
   * Respond to permission request
   */
  respondToPermission(sessionId: string, requestId: string, optionId: string): void {
    const ws = this.wsConnections.get(sessionId);
    if (!ws) return;

    ws.send(
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

  // ==================== Model Management ====================

  /**
   * Get available models from Moss Server
   * GET /api/v1/models/available
   */
  async getAvailableModels(): Promise<Array<{ id: string; name: string; ratio: number }>> {
    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/models/available`, {
      method: 'GET',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get available models: ${response.status} ${text}`);
    }

    const data = await response.json();
    return data.data || [];
  }

  /**
   * Get user's model preference
   * GET /api/v1/users/{userId}/model
   */
  // 返回类型：用户偏好 + 系统默认模型
  // 保持返回类型声明不变，或者改成更完整的结构
  async getUserModelPreference(): Promise<{
    modelId: string;
    updatedAt: number;
    systemDefaultModel: string; // 把默认模型也加进来
  } | null> {
    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/users/me/model`, {
      method: 'GET',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get user model preference: ${response.status} ${text}`);
    }

    const res = await response.json();
    // 把用户偏好和系统默认模型合并成一个对象返回
    if (res.data) {
      return {
        ...res.data,
        systemDefaultModel: res.systemDefaultModel || '',
      };
    } else {
      // 用户没设置偏好时，返回默认模型
      return {
        modelId: '',
        updatedAt: 0,
        systemDefaultModel: res.systemDefaultModel || '',
      };
    }
  }

  /**
   * Set user's model preference
   * PUT /api/v1/users/{userId}/model
   */
  async setUserModelPreference(modelId: string): Promise<{ modelId: string; updatedAt: number }> {
    const response = await this.fetchWithRetry(`${this.serverUrl}/api/v1/users/me/model`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ modelId }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to set user model preference: ${response.status} ${text}`);
    }

    const data = await response.json();
    return data.data;
  }

  /**
   * Set model for current session via WebSocket
   * Sends control_request with subtype 'set_model'
   * If WebSocket is not connected, it will reconnect
   */
  async setModelForSession(sessionId: string, modelId: string): Promise<void> {
    mainLog('MossSessionApi', `setModelForSession called: sessionId=${sessionId}, modelId=${modelId}`);

    let ws = this.wsConnections.get(sessionId);

    // If WebSocket is not connected, try to reconnect
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      mainLog('MossSessionApi', `WebSocket not connected for session ${sessionId}, reconnecting...`);

      // Get session info to get wsUrl
      try {
        const sessionInfo = await this.resumeSession(sessionId);
        const wsUrl = sessionInfo.wsUrl;

        // Establish a new WebSocket connection (without sending a message)
        const token = await this.ensureAuthenticated();
        let wsUrlWithRefresh = wsUrl;
        try {
          const authStorage = ProcessConfig.getSync('eeclaw.authStorage');
          if (authStorage?.refresh_token) {
            const separator = wsUrlWithRefresh.includes('?') ? '&' : '?';
            wsUrlWithRefresh += `${separator}refresh_token=${encodeURIComponent(authStorage.refresh_token)}`;
          }
        } catch {
          /* ignore */
        }

        ws = new WebSocket(wsUrlWithRefresh, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        this.wsConnections.set(sessionId, ws);

        // Wait for connection to open
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('WebSocket connection timeout'));
          }, 10000);

          ws!.on('open', () => {
            clearTimeout(timeout);
            mainLog('MossSessionApi', `WebSocket reconnected for session ${sessionId}`);
            resolve();
          });

          ws!.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        // Set up close handler
        ws.on('close', (code, reason) => {
          mainLog('MossSessionApi', `WebSocket closed: code=${code}, reason=${reason}`);
          this.wsConnections.delete(sessionId);
        });
      } catch (err) {
        mainError('MossSessionApi', `Failed to reconnect WebSocket for session ${sessionId}: ${err}`);
        throw new Error(`Failed to reconnect WebSocket for session ${sessionId}`);
      }
    }

    const message = JSON.stringify({
      type: 'control_request',
      request_id: uuid(36),
      request: {
        subtype: 'set_model',
        model_id: modelId,
      },
    });

    mainLog('MossSessionApi', `Sending model switch message: ${message}`);
    ws.send(message);
    mainLog('MossSessionApi', `Model switch request sent for session ${sessionId}: ${modelId}`);
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(sessionId: string): void {
    const ws = this.wsConnections.get(sessionId);
    if (ws) {
      ws.close();
      this.wsConnections.delete(sessionId);
    }
  }

  /**
   * Process Moss Server message and convert to IResponseMessage
   * Based on Moss WebSocket Protocol: /moss/docs/websocket-protocol.md
   */
  private processMessage(msg: any, onMessage: (msg: IResponseMessage) => void, onFinish: () => void): void {
    // 1. result - 会话结束标记（最重要）
    if (msg.type === 'result') {
      mainLog('MossSessionApi', `Session ended with result: ${msg.subtype || 'unknown'}, result_type=${msg.result_type || 'unknown'}`);

      // Check if this is a user-initiated abort/cancel
      // 检查是否是用户主动中止/取消
      const isUserAbort = this.isUserAbortError(msg);
      const sessionId = msg.session_id || '';
      if (isUserAbort) {
        mainLog('MossSessionApi', 'Session aborted by user - skipping error message');
        // Mark this session as user-aborted to filter subsequent messages
        // 标记此会话为用户中止，用于过滤后续消息
        this.userAbortSessions.add(sessionId);
      }

      // Handle error results (but skip user abort errors)
      // 处理错误结果（但跳过用户中止错误）
      if ((msg.is_error || msg.subtype?.startsWith('error_')) && !isUserAbort) {
        const errorMsg = msg.errors?.join('\n') || msg.result || 'Session ended with error';
        mainError('MossSessionApi', `Session error: ${errorMsg}`);
        onMessage({
          type: 'error',
          msg_id: msg.uuid || uuid(36),
          conversation_id: '',
          data: errorMsg,
        });
      }

      // result 消息表示会话结束，调用 onFinish
      onFinish();
      return;
    }

    // 2. system - 系统消息（不显示给用户）
    if (msg.type === 'system') {
      mainLog('MossSessionApi', `System message: ${msg.subtype || 'unknown'}`);
      // init message contains model, cwd, tools, etc.
      // 发送模型信息到前端
      if (msg.subtype === 'init') {
        const modelName = msg.model || 'unknown';
        onMessage({
          type: 'acp_model_info',
          msg_id: uuid(36),
          conversation_id: msg.session_id || '',
          data: {
            source: 'models',
            currentModelId: modelName,
            currentModelLabel: modelName,
            canSwitch: false,
            availableModels: [],
          },
        });
      }
      // model_changed - 模型切换完成通知
      if (msg.subtype === 'model_changed') {
        const modelName = msg.model || 'unknown';
        const sessionId = msg.session_id || '';
        mainLog('MossSessionApi', `Model changed to: ${modelName} for session: ${sessionId}`);
        // Emit model_changed event to frontend via IPC
        // 通过 IPC 发送 model_changed 事件到前端
        const { ipcBridge } = require('@/common');
        ipcBridge.moss.modelChanged.emit({
          sessionId,
          model: modelName,
        });
        // Also send acp_model_info update
        onMessage({
          type: 'acp_model_info',
          msg_id: uuid(36),
          conversation_id: sessionId,
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

    // 3. control_request - 权限请求或中断
    if (msg.type === 'control_request') {
      if (msg.request?.subtype === 'interrupt') {
        mainLog('MossSessionApi', `Interrupt received from server for session: ${msg.session_id || ''}`);
        onFinish();
        return;
      }
      onMessage({
        type: 'acp_permission',
        msg_id: msg.request_id,
        conversation_id: '',
        data: {
          id: msg.request_id,
          callId: msg.request_id,
          title: msg.request?.title || msg.request?.tool_name || 'Permission Required',
          description: JSON.stringify(msg.request?.rawInput || msg.request?.input || {}),
          options: msg.request?.options?.map((opt: any) => ({
            label: opt.name || opt,
            value: opt.optionId || opt,
          })) || [
            { label: 'Allow', value: 'allow_once' },
            { label: 'Always Allow', value: 'allow_always' },
            { label: 'Reject', value: 'reject_once' },
          ],
        },
      });
      return;
    }

    // 4. assistant - Assistant 响应消息
    if (msg.type === 'assistant') {
      const sessionId = msg.session_id || '';
      // Skip assistant messages after user abort to prevent showing interrupt messages
      // 用户中止后跳过 assistant 消息，防止显示中止相关消息
      if (this.userAbortSessions.has(sessionId)) {
        mainLog('MossSessionApi', 'Skipping assistant message after user abort');
        return;
      }

      // Check for error
      if (msg.error || msg.isApiErrorMessage) {
        const errorMsg = this.extractTextFromContent(msg.message?.content) || msg.error || 'Unknown error';
        mainError('MossSessionApi', `Assistant error: ${errorMsg}`);
        onMessage({
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
              onMessage({
                type: 'thought',
                msg_id: `${msg.uuid || uuid(36)}-thought`,
                conversation_id: '',
                data: { subject: 'Thinking', description: thinkingContent },
              });
            }
          } else if (block?.type === 'text') {
            const textContent = block.text || '';
            // Skip abort-related text messages
            // 跳过中止相关的文本消息
            if (textContent && textContent.trim() && !this.isAbortRelatedText(textContent)) {
              onMessage({
                type: 'content',
                msg_id: msg.uuid || uuid(36),
                conversation_id: '',
                data: textContent,
              });
            }
          } else if (block?.type === 'tool_use') {
            onMessage({
              type: 'acp_tool_call',
              msg_id: block.id || uuid(36),
              conversation_id: '',
              data: {
                sessionId: msg.session_id || '',
                update: {
                  sessionUpdate: 'tool_call',
                  toolCallId: block.id || uuid(36),
                  status: 'pending',
                  title: block.name,
                  kind: 'execute', // Default kind for Moss tool calls
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
          onMessage({
            type: 'content',
            msg_id: msg.uuid || uuid(36),
            conversation_id: '',
            data: content,
          });
        }
      }
      return;
    }

    // 5. user - 用户消息回显
    if (msg.type === 'user') {
      return;
    }

    // 6. tool_progress - 工具执行进度
    if (msg.type === 'tool_progress') {
      mainLog('MossSessionApi', `Tool progress: ${msg.tool_name} (${msg.elapsed_time_seconds}s)`);
      // Update existing tool call with running status
      // Structure as ToolCallUpdateStatus to match frontend expectations
      onMessage({
        type: 'acp_tool_call',
        msg_id: msg.tool_use_id || uuid(36),
        conversation_id: '',
        data: {
          sessionId: msg.session_id || '',
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

    // 7. tool_use_summary - 工具调用摘要
    if (msg.type === 'tool_use_summary') {
      onMessage({
        type: 'content',
        msg_id: msg.uuid || uuid(36),
        conversation_id: '',
        data: `[Tool Summary] ${msg.summary}`,
      });
      return;
    }

    // 8. streamlined_text - 简化文本输出
    if (msg.type === 'streamlined_text') {
      if (msg.text && msg.text.trim()) {
        onMessage({
          type: 'content',
          msg_id: msg.uuid || uuid(36),
          conversation_id: '',
          data: msg.text,
        });
      }
      return;
    }

    // 9. streamlined_tool_use_summary - 简化工具摘要
    if (msg.type === 'streamlined_tool_use_summary') {
      onMessage({
        type: 'content',
        msg_id: msg.uuid || uuid(36),
        conversation_id: '',
        data: `[Tool Summary] ${msg.tool_summary}`,
      });
      return;
    }

    // 10. stream_event - 流式事件
    if (msg.type === 'stream_event') {
      return;
    }

    // 11. rate_limit_event - Rate limit 信息
    if (msg.type === 'rate_limit_event') {
      mainLog('MossSessionApi', `Rate limit: ${msg.rate_limit_info?.status}`);
      return;
    }

    // 12. auth_status - 认证状态
    if (msg.type === 'auth_status') {
      mainLog('MossSessionApi', `Auth status: ${msg.isAuthenticating ? 'authenticating' : 'authenticated'}`);
      return;
    }

    // 13. prompt_suggestion - Prompt 建议
    if (msg.type === 'prompt_suggestion') {
      mainLog('MossSessionApi', `Prompt suggestion: ${msg.suggestion}`);
      return;
    }

    // Legacy/unknown types
    if (msg.type && !['assistant', 'user', 'result', 'system', 'tool_progress', 'tool_use_summary', 'streamlined_text', 'streamlined_tool_use_summary', 'stream_event', 'rate_limit_event', 'auth_status', 'prompt_suggestion', 'control_request', 'thinking', 'finish', 'end_turn', 'tool_use', 'tool_result', 'content', 'text'].includes(msg.type)) {
      mainLog('MossSessionApi', `Unknown message type: ${msg.type}, skipping`);
      return;
    }

    // Default fallback
    if (msg.message?.content) {
      const content = this.extractTextFromContent(msg.message.content);
      if (content && content.trim()) {
        onMessage({
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

  /**
   * Check if the result message indicates a user-initiated abort/cancel
   * 检查 result 消息是否表示用户主动中止/取消
   */
  private isUserAbortError(msg: any): boolean {
    // Check result_type field
    if (msg.result_type === 'user') {
      return true;
    }

    // Check error message for abort indicators
    const errorMsg = msg.errors?.join('\n') || msg.result || '';
    if (errorMsg.includes('Request was aborted') || errorMsg.includes('AbortError') || errorMsg.includes('aborted by user') || errorMsg.includes('user abort')) {
      return true;
    }

    return false;
  }

  /**
   * Check if text content is related to abort/interrupt messages
   * 检查文本内容是否是中止/中断相关的消息
   */
  private isAbortRelatedText(text: string): boolean {
    const lowerText = text.toLowerCase();
    // Common abort/interrupt messages from Moss Server
    // Moss Server 常见的中止/中断消息
    if (lowerText.includes('request interrupted by user') || lowerText.includes('request was aborted') || lowerText.includes('no response requested') || lowerText.includes('aborted by user') || lowerText.includes('interrupted by user')) {
      return true;
    }
    return false;
  }
}

/**
 * Moss Server Session object
 * Note: Moss Server API returns camelCase fields
 */
export interface MossSession {
  /** Primary session ID field (camelCase from API) */
  sessionId?: string;
  /** Alternative session ID field (snake_case) */
  session_id?: string;
  /** WebSocket URL for session */
  ws_url?: string;
  wsUrl?: string;
  /** Working directory */
  work_dir?: string;
  workDir?: string;
  cwd?: string;
  /** Assistant name */
  assistant_name?: string;
  assistantName?: string;
  /** Runtime configuration */
  runtime?: {
    type: string;
    configDir?: string;
    dockerImage?: string;
    dockerMode?: string;
  };
  /** Creation timestamp */
  created_at?: number;
  createdAt?: number;
  /** Last active timestamp */
  lastActiveAt?: number;
  last_active_at?: number;
  /** Update timestamp */
  updated_at?: number;
  updatedAt?: number;
  /** Ended timestamp */
  endedAt?: number;
  ended_at?: number;
  /** Session status */
  status?: 'active' | 'idle' | 'ended' | 'terminated';
  desiredState?: string;
  /** User info */
  userId?: string;
  orgId?: string;
  role?: string;
  scopes?: string[];
}

/**
 * Global Moss API instance for enterprise mode
 */
let mossApiInstance: MossSessionApi | null = null;
let mossApiServerUrl: string | null = null;

export function getMossApi(): MossSessionApi | null {
  return mossApiInstance;
}

/**
 * Reset Moss API instance (call when server URL changes)
 * 重置 Moss API 实例（当服务器 URL 变化时调用）
 */
export function resetMossApi(): void {
  mossApiInstance = null;
  mossApiServerUrl = null;
}

export function initMossApi(serverUrl: string): MossSessionApi {
  mossApiInstance = new MossSessionApi(serverUrl);
  mossApiServerUrl = serverUrl;
  return mossApiInstance;
}

/**
 * Get current Moss API server URL
 * 获取当前 Moss API 服务器 URL
 */
export function getMossApiServerUrl(): string | null {
  return mossApiServerUrl;
}
