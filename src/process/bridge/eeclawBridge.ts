/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * IPC Bridge handler for enterprise (eeclaw) operations
 */

import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/storage';
import { mainLog, mainError } from '@process/utils/mainLogger';
import type {
  AppMode,
  EeclawAgentConfig,
  EeclawAssistant,
  EeclawConversation,
  EeclawSkill,
  EeclawUserInfo,
} from '@/common/types/eeclawTypes';

/**
 * Fetch from mock server (replaced by real API later)
 */
async function fetchFromServer<T>(serverUrl: string, path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${serverUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Server error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || data.msg || 'Unknown server error');
  }

  return data.data as T;
}

export function initEeclawBridge(): void {
  /**
   * Get current app mode
   */
  ipcBridge.eeclaw.getMode.provider(async () => {
    const mode = await ConfigStorage.get<AppMode>('system.appMode');
    return { success: true, data: { mode: mode ?? 'c' } };
  });

  /**
   * Set app mode
   */
  ipcBridge.eeclaw.setMode.provider(async ({ mode }) => {
    await ConfigStorage.set('system.appMode', mode);
    mainLog('EeclawBridge', `App mode set to: ${mode}`);
    return { success: true };
  });

  /**
   * Login to enterprise server
   */
  ipcBridge.eeclaw.login.provider(async ({ serverUrl, username, password }) => {
    try {
      const userInfo = await fetchFromServer<EeclawUserInfo>(serverUrl, '/api/v1/eeclaw/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      // Store server URL and user info
      await ConfigStorage.set('eeclaw.serverUrl', serverUrl);
      await ConfigStorage.set('eeclaw.userInfo', userInfo);

      // Fetch agent config
      try {
        const agentConfig = await fetchFromServer<EeclawAgentConfig>(serverUrl, '/api/v1/eeclaw/tenant/config');
        await ConfigStorage.set('eeclaw.agentConfig', agentConfig.agent ?? null);
      } catch (error) {
        mainError('EeclawBridge', 'Failed to fetch agent config', error);
      }

      return { success: true, data: userInfo };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mainError('EeclawBridge', 'Login failed', message);
      return { success: false, msg: message };
    }
  });

  /**
   * Get server config
   */
  ipcBridge.eeclaw.getServerConfig.provider(async () => {
    const config = await ConfigStorage.get<EeclawAgentConfig | null>('eeclaw.agentConfig');
    return { success: true, data: config ?? { remoteAgentEnabled: true, localAgentEnabled: false } };
  });

  /**
   * Sync all resources from server
   */
  ipcBridge.eeclaw.syncAll.provider(async () => {
    try {
      const serverUrl = await ConfigStorage.get<string>('eeclaw.serverUrl');
      if (!serverUrl) {
        return { success: false, msg: 'No server URL configured' };
      }

      // Sync skills
      const skills = await fetchFromServer<EeclawSkill[]>(serverUrl, '/api/v1/eeclaw/skills');
      mainLog('EeclawBridge', `Synced ${skills.length} skills`);

      // Sync assistants
      const assistants = await fetchFromServer<EeclawAssistant[]>(serverUrl, '/api/v1/eeclaw/assistants');
      mainLog('EeclawBridge', `Synced ${assistants.length} assistants`);

      // Sync conversations
      const conversations = await fetchFromServer<EeclawConversation[]>(serverUrl, '/api/v1/eeclaw/conversations');
      mainLog('EeclawBridge', `Synced ${conversations.length} conversations`);

      // Update last sync timestamp
      const lastSync = await ConfigStorage.get<Record<string, number>>('eeclaw.lastSync') ?? {};
      await ConfigStorage.set('eeclaw.lastSync', {
        ...lastSync,
        conversations: Date.now(),
        skills: Date.now(),
        assistants: Date.now(),
      });

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mainError('EeclawBridge', 'Sync failed', message);
      return { success: false, msg: message };
    }
  });

  /**
   * Get cloud conversations
   */
  ipcBridge.eeclaw.getCloudConversations.provider(async () => {
    try {
      const serverUrl = await ConfigStorage.get<string>('eeclaw.serverUrl');
      if (!serverUrl) {
        return { success: false, msg: 'No server URL configured' };
      }

      const conversations = await fetchFromServer<EeclawConversation[]>(serverUrl, '/api/v1/eeclaw/conversations');
      return { success: true, data: conversations };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, msg: message };
    }
  });

  /**
   * Get cloud skills
   */
  ipcBridge.eeclaw.getCloudSkills.provider(async () => {
    try {
      const serverUrl = await ConfigStorage.get<string>('eeclaw.serverUrl');
      if (!serverUrl) {
        return { success: false, msg: 'No server URL configured' };
      }

      const skills = await fetchFromServer<EeclawSkill[]>(serverUrl, '/api/v1/eeclaw/skills');
      return { success: true, data: skills };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, msg: message };
    }
  });

  /**
   * Get cloud assistants
   */
  ipcBridge.eeclaw.getCloudAssistants.provider(async () => {
    try {
      const serverUrl = await ConfigStorage.get<string>('eeclaw.serverUrl');
      if (!serverUrl) {
        return { success: false, msg: 'No server URL configured' };
      }

      const assistants = await fetchFromServer<EeclawAssistant[]>(serverUrl, '/api/v1/eeclaw/assistants');
      return { success: true, data: assistants };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, msg: message };
    }
  });
}
