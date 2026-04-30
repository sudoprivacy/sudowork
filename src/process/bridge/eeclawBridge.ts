/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ProcessConfig } from '@process/initStorage';
import { mainWarn } from '@process/utils/mainLogger';

export function initEeclawBridge(): void {
  ipcBridge.eeclaw.verifyServer.provider(async ({ serverUrl }) => {
    try {
      const response = await fetch(`${serverUrl}/healthz`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const data = await response.json();
        return { success: true, data: { ok: !!data.ok } };
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

  ipcBridge.eeclaw.getCloudAssistants.provider(async () => {
    try {
      const serverUrl = await ProcessConfig.get('eeclaw.serverUrl');
      if (!serverUrl) {
        return { success: false, error: 'no_server_url' as const, data: undefined };
      }

      const authStorage = await ProcessConfig.get('eeclaw.authStorage');
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
