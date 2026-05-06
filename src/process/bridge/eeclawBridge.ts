/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ProcessConfig } from '@process/initStorage';
import { mainWarn, mainLog } from '@process/utils/mainLogger';
import { setCachedAuthToken, setCachedServerUrl, setCachedAppMode } from '@/common/enterpriseDebugConfig';
import { resetConversationProvider } from '../providers';

export function initEeclawBridge(): void {
  // Set app mode and update main process cache
  // 设置应用模式并更新主进程缓存
  ipcBridge.eeclaw.setAppMode.provider(async ({ mode }) => {
    await ProcessConfig.set('system.appMode', mode);
    setCachedAppMode(mode);
    mainLog('eeclawBridge', `App mode set to: ${mode}`);
  });

  ipcBridge.eeclaw.verifyServer.provider(async ({ serverUrl }) => {
    try {
      const response = await fetch(`${serverUrl}/api/v1/tenant/config`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const json = await response.json();
        if (json.success && json.data) {
          return { success: true, data: json.data };
        }
        return { success: false, error: 'server_error' as const, data: undefined };
      }
      return { success: false, error: 'server_error' as const, data: undefined };
    } catch (error) {
      mainWarn('eeclawBridge', 'verifyServer error:', error);
      return { success: false, error: 'network_error' as const, data: undefined };
    }
  });

  ipcBridge.eeclaw.login.provider(async ({ serverUrl, body, deviceId }) => {
    try {
      const response = await fetch(`${serverUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': deviceId,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: (data?.error || 'login_failed') as string, data: undefined };
      }

      // Save server URL and auth storage to ProcessConfig
      // 将服务器 URL 和认证存储保存到 ProcessConfig
      await ProcessConfig.set('eeclaw.serverUrl', serverUrl);
      await ProcessConfig.set('eeclaw.authStorage', {
        access_token: data.access_token,
        refresh_token: data.refresh_token || '',
        expires_at: Date.now() + (data.expires_in || 3600) * 1000,
        device_id: deviceId,
      });

      // Update enterprise cache for synchronous access
      // 更新企业配置缓存以供同步访问
      setCachedServerUrl(serverUrl);
      setCachedAuthToken(data.access_token);
      setCachedAppMode('e');

      // Reset provider singleton so next call creates RemoteConversationProvider
      // 重置 Provider 单例，下次调用时会创建 RemoteConversationProvider
      resetConversationProvider();

      mainLog('eeclawBridge', 'Login successful, cache updated, provider reset');

      return {
        success: true,
        data: {
          access_token: data.access_token,
          expires_in: data.expires_in,
          user: {
            id: data.user.id,
            name: data.user.name,
            role: data.user.role,
            orgId: data.user.orgId,
          },
        },
      };
    } catch (error) {
      mainWarn('eeclawBridge', 'login error:', error);
      return { success: false, error: 'network_error' as string, data: undefined };
    }
  });

  ipcBridge.eeclaw.getUserProfile.provider(async () => {
    try {
      const serverUrl = ProcessConfig.getSync('eeclaw.serverUrl');
      if (!serverUrl) {
        return { success: false, error: 'no_server_url' as const, data: undefined };
      }

      const authStorage = ProcessConfig.getSync('eeclaw.authStorage');
      if (!authStorage) {
        return { success: false, error: 'token_not_synced' as const, data: undefined };
      }

      const response = await fetch(`${serverUrl}/api/v1/user/profile`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${authStorage.access_token}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 401) {
        return { success: false, error: 'unauthorized' as const, data: undefined };
      }

      if (!response.ok) {
        mainWarn('eeclawBridge', `getUserProfile failed: ${response.status}`);
        return { success: false, error: 'server_error' as const, data: undefined };
      }

      const data = await response.json();
      if (data.success && data.data) {
        return { success: true, data: data.data };
      }
      return { success: false, error: 'server_error' as const, data: undefined };
    } catch (error) {
      mainWarn('eeclawBridge', 'getUserProfile error:', error);
      return { success: false, error: 'network_error' as const, data: undefined };
    }
  });

  ipcBridge.eeclaw.getCloudAssistants.provider(async () => {
    try {
      const serverUrl = ProcessConfig.getSync('eeclaw.serverUrl');
      if (!serverUrl) {
        return { success: false, error: 'no_server_url' as const, data: undefined };
      }

      const authStorage = ProcessConfig.getSync('eeclaw.authStorage');
      if (!authStorage) {
        return { success: false, error: 'token_not_synced' as const, data: undefined };
      }

      const response = await fetch(`${serverUrl}/api/v1/assistants`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authStorage.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 401) {
        return { success: false, error: 'unauthorized' as const, data: undefined };
      }

      if (!response.ok) {
        mainWarn('eeclawBridge', `getCloudAssistants failed: ${response.status}`);
        return { success: false, error: 'server_error' as const, data: undefined };
      }

      const data = await response.json();
      const assistants: Array<{ key: string; name: string }> = data.data ?? data ?? [];
      return { success: true, data: assistants };
    } catch (error) {
      mainWarn('eeclawBridge', 'getCloudAssistants error:', error);
      return { success: false, error: 'network_error' as const, data: undefined };
    }
  });
}
