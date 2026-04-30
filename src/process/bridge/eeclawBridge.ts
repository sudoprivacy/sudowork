/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ProcessConfig } from '@process/initStorage';
import { mainWarn } from '@process/utils/mainLogger';

export function initEeclawBridge(): void {
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
