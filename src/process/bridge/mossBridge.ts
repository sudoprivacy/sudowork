/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { isEnterpriseMode, getEnterpriseConfig } from '@/common/enterpriseDebugConfig';
import { initMossApi, getMossApi, getMossApiServerUrl, resetMossApi, type MossSessionApi, type MossSession } from '../remote/MossSessionApi';
import { mainLog, mainError } from '@process/utils/mainLogger';
import type { IResponseMessage } from '@/common/ipcBridge';
import { uuid } from '@/common/utils';

/**
 * Moss Server IPC Bridge
 *
 * 企业模式下的会话管理通过 Moss Server API 实现
 * 所有会话 CRUD 操作都调用 Moss Server，本地不持久化
 */

/**
 * Ensure Moss API is initialized with enterprise config
 * Returns the API instance or null if initialization fails
 *
 * If server URL has changed since last initialization, resets and re-initializes.
 * 如果服务器 URL 自上次初始化后发生变化，重置并重新初始化。
 */
async function ensureMossApiInitialized(): Promise<MossSessionApi | null> {
  const config = getEnterpriseConfig();

  // Check if server URL has changed since last initialization
  // 检查服务器 URL 自上次初始化后是否发生变化
  const currentServerUrl = getMossApiServerUrl();
  const api = getMossApi();

  if (api && currentServerUrl === config.mossServerUrl) {
    // URL unchanged, return existing instance
    // URL 未变化，返回现有实例
    return api;
  }

  if (api && currentServerUrl !== config.mossServerUrl) {
    // URL changed, reset existing instance
    // URL 变化，重置现有实例
    mainLog('MossBridge', `Server URL changed from ${currentServerUrl} to ${config.mossServerUrl}, resetting Moss API`);
    resetMossApi();
  }

  // Initialize from enterprise config
  if (!config.mossServerUrl) {
    mainError('MossBridge', 'Moss Server URL not configured');
    return null;
  }

  const newApi = initMossApi(config.mossServerUrl);
  if (config.authToken) {
    newApi.setAccessToken(config.authToken);
  }

  return newApi;
}

export function initMossBridge(): void {
  // moss.is-enterprise-mode
  ipcBridge.moss.isEnterpriseMode.provider(async () => {
    return isEnterpriseMode();
  });

  // moss.get-config
  ipcBridge.moss.getConfig.provider(async () => {
    const config = getEnterpriseConfig();
    return {
      serverUrl: config.mossServerUrl,
      hasToken: !!config.authToken,
    };
  });

  // moss.set-auth-token - Set JWT token directly (no conversion needed)
  // moss.set-auth-token - 直接设置 JWT token（无需转换）
  ipcBridge.moss.setAuthToken.provider(async ({ authToken }) => {
    try {
      const config = getEnterpriseConfig();
      if (!config.mossServerUrl) {
        return { success: false, msg: 'Moss Server URL not configured' };
      }

      const api = initMossApi(config.mossServerUrl);
      // Set JWT token directly (from eeclaw auth storage)
      // 直接设置 JWT token（来自 eeclaw auth storage）
      api.setAccessToken(authToken);

      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, msg };
    }
  });

  // moss.list-sessions
  ipcBridge.moss.listSessions.provider(async () => {
    try {
      const api = getMossApi();
      if (!api) {
        return { success: false, msg: 'Moss API not initialized. Call authenticate first.' };
      }

      const sessions = await api.listSessions();

      const mapped = sessions.map((s) => ({
        sessionId: s.sessionId || s.session_id,
        wsUrl: s.wsUrl || s.ws_url || '',
        workDir: s.workDir || s.work_dir || s.cwd,
        assistantName: s.assistantName || s.assistant_name,
        status: s.status,
        createdAt: s.createdAt || s.created_at,
        updatedAt: s.lastActiveAt || s.updatedAt || s.updated_at || s.createdAt || s.created_at,
      }));

      return {
        success: true,
        data: mapped,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, msg };
    }
  });

  // moss.create-session
  ipcBridge.moss.createSession.provider(async ({ cwd, assistantName, dangerouslySkipPermissions, runtimeType }) => {
    try {
      const api = getMossApi();
      if (!api) {
        return { success: false, msg: 'Moss API not initialized. Call authenticate first.' };
      }

      const session = await api.createSession({
        cwd,
        assistantName,
        dangerouslySkipPermissions,
        runtimeType,
      });

      return {
        success: true,
        data: {
          sessionId: session.sessionId || session.session_id,
          wsUrl: session.wsUrl || session.ws_url,
          workDir: session.workDir || session.work_dir,
          assistantName: session.assistantName || session.assistant_name,
          status: session.status,
          createdAt: session.createdAt || session.created_at,
          updatedAt: session.updatedAt || session.updated_at || session.lastActiveAt,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, msg };
    }
  });

  // moss.get-session
  ipcBridge.moss.getSession.provider(async ({ sessionId }) => {
    try {
      const api = getMossApi();
      if (!api) {
        return { success: false, msg: 'Moss API not initialized' };
      }

      const session = await api.getSession(sessionId);
      return {
        success: true,
        data: {
          sessionId: session.sessionId || session.session_id,
          wsUrl: session.wsUrl || session.ws_url,
          workDir: session.workDir || session.work_dir,
          assistantName: session.assistantName || session.assistant_name,
          status: session.status,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, msg };
    }
  });

  // moss.delete-session
  ipcBridge.moss.deleteSession.provider(async ({ sessionId }) => {
    try {
      const api = getMossApi();
      if (!api) {
        return { success: false, msg: 'Moss API not initialized' };
      }

      await api.deleteSession(sessionId);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, msg };
    }
  });

  // moss.update-session
  ipcBridge.moss.updateSession.provider(async ({ sessionId, title }) => {
    try {
      const api = getMossApi();
      if (!api) {
        return { success: false, msg: 'Moss API not initialized' };
      }

      const session = await api.updateSession(sessionId, { title });

      return {
        success: true,
        data: {
          sessionId: session.sessionId || session.session_id,
          wsUrl: session.wsUrl || session.ws_url,
          workDir: session.workDir || session.work_dir,
          assistantName: session.assistantName || session.assistant_name,
          status: session.status,
          createdAt: session.createdAt || session.created_at,
          updatedAt: session.updatedAt || session.updated_at || session.lastActiveAt,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, msg };
    }
  });

  // moss.resume-session
  ipcBridge.moss.resumeSession.provider(async ({ sessionId }) => {
    try {
      const api = getMossApi();
      if (!api) {
        return { success: false, msg: 'Moss API not initialized' };
      }

      mainLog('MossBridge', `Resuming session: ${sessionId}`);

      const result = await api.resumeSession(sessionId);

      mainLog('MossBridge', `Resume API response: ${JSON.stringify(result, null, 2)}`);

      const mappedSession = {
        wsUrl: result.wsUrl,
        session: {
          sessionId: result.session.sessionId || result.session.session_id || sessionId,
          wsUrl: result.wsUrl,
          workDir: result.session.workDir || result.session.work_dir,
          assistantName: result.session.assistantName || result.session.assistant_name,
          status: result.session.status,
          createdAt: result.session.createdAt || result.session.created_at,
          updatedAt: result.session.lastActiveAt || result.session.updatedAt || result.session.updated_at || result.session.createdAt || result.session.created_at,
        },
      };

      mainLog('MossBridge', `Mapped session for frontend: ${JSON.stringify(mappedSession, null, 2)}`);

      return {
        success: true,
        data: mappedSession,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, msg };
    }
  });

  // moss.send-message
  ipcBridge.moss.sendMessage.provider(async ({ sessionId, wsUrl, content, files }) => {
    try {
      const api = getMossApi();
      if (!api) {
        return { success: false, msg: 'Moss API not initialized' };
      }

      // Build message with file references
      let messageContent = content;
      if (files && files.length > 0) {
        const fileRefs = files.map((f) => (f.includes(' ') ? `@"${f}"` : `@${f}`)).join(' ');
        messageContent = `${fileRefs} ${messageContent}`;
      }

      await api.connectAndSend(
        sessionId,
        wsUrl,
        messageContent,
        (msg: IResponseMessage) => {
          // Emit response to frontend
          ipcBridge.moss.responseStream.emit({
            ...msg,
            conversation_id: sessionId,
          });
        },
        () => {
          // On finish
          ipcBridge.moss.responseStream.emit({
            type: 'finish',
            msg_id: uuid(36),
            conversation_id: sessionId,
            data: null,
          });
        },
        (err: Error) => {
          // On error
          ipcBridge.moss.responseStream.emit({
            type: 'error',
            msg_id: uuid(36),
            conversation_id: sessionId,
            data: err.message,
          });
        }
      );

      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, msg };
    }
  });

  // moss.stop
  ipcBridge.moss.stop.provider(async ({ sessionId }) => {
    try {
      const api = getMossApi();
      if (!api) {
        return { success: false, msg: 'Moss API not initialized' };
      }

      api.sendInterrupt(sessionId);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, msg };
    }
  });

  // moss.respond-permission
  ipcBridge.moss.respondPermission.provider(async ({ sessionId, requestId, optionId }) => {
    try {
      const api = getMossApi();
      if (!api) {
        return { success: false, msg: 'Moss API not initialized' };
      }

      api.respondToPermission(sessionId, requestId, optionId);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, msg };
    }
  });

  // moss.get-available-models
  ipcBridge.moss.getAvailableModels.provider(async () => {
    try {
      const api = await ensureMossApiInitialized();
      if (!api) {
        return { success: false, msg: 'Moss API not initialized. Please login first.' };
      }

      const models = await api.getAvailableModels();
      return { success: true, data: models };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, msg };
    }
  });

  // moss.get-user-model
  ipcBridge.moss.getUserModel.provider(async () => {
    try {
      const api = await ensureMossApiInitialized();
      if (!api) {
        return { success: false, msg: 'Moss API not initialized. Please login first.' };
      }

      const preference = await api.getUserModelPreference();
      return { success: true, data: preference };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, msg };
    }
  });

  // moss.set-user-model
  ipcBridge.moss.setUserModel.provider(async ({ modelId }) => {
    try {
      const api = await ensureMossApiInitialized();
      if (!api) {
        return { success: false, msg: 'Moss API not initialized. Please login first.' };
      }

      const preference = await api.setUserModelPreference(modelId);
      return { success: true, data: preference };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, msg };
    }
  });

  // moss.set-model - Set model for current session via WebSocket
  ipcBridge.moss.setModel.provider(async ({ sessionId, modelId }) => {
    try {
      mainLog('MossBridge', `setModel called: sessionId=${sessionId}, modelId=${modelId}`);
      const api = await ensureMossApiInitialized();
      if (!api) {
        mainError('MossBridge', 'setModel failed: Moss API not initialized');
        return { success: false, msg: 'Moss API not initialized. Please login first.' };
      }

      await api.setModelForSession(sessionId, modelId);
      mainLog('MossBridge', `setModel success: sessionId=${sessionId}, modelId=${modelId}`);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      mainError('MossBridge', `setModel error: ${msg}`);
      return { success: false, msg };
    }
  });
}
