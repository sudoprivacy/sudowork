/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDatabase } from '@/process/database';
import type { IChannelPluginConfig, PluginStatus, IChannelUser, PluginType, IChannelPairingRequest, IChannelSession } from '../types';
import { TelegramPlugin } from '../plugins/telegram/TelegramPlugin';
import { LarkPlugin } from '../plugins/lark/LarkPlugin';
import { DingTalkPlugin } from '../plugins/dingtalk/DingTalkPlugin';
import { WeComPlugin } from '../plugins/wecom/WeComPlugin';
import type { IChannelProvider } from './IChannelProvider';

/**
 * LocalChannelProvider - Implementation of IChannelProvider using local SQLite database
 */
export class LocalChannelProvider implements IChannelProvider {
  async getPlugins(): Promise<IChannelPluginConfig[]> {
    const result = getDatabase().getChannelPlugins();
    return result.success ? result.data || [] : [];
  }

  async getPlugin(pluginId: string): Promise<IChannelPluginConfig | null> {
    const result = getDatabase().getChannelPlugin(pluginId);
    return result.success ? result.data || null : null;
  }

  async upsertPlugin(plugin: IChannelPluginConfig): Promise<boolean> {
    const result = getDatabase().upsertChannelPlugin(plugin);
    return result.success;
  }

  async updatePluginStatus(pluginId: string, status: PluginStatus, lastConnected?: number): Promise<boolean> {
    const result = getDatabase().updateChannelPluginStatus(pluginId, status, lastConnected);
    return result.success;
  }

  async updatePluginEnabled(pluginId: string, enabled: boolean, status: PluginStatus): Promise<boolean> {
    const result = getDatabase().updateChannelPluginEnabled(pluginId, enabled, status);
    return result.success;
  }

  async deletePlugin(pluginId: string): Promise<boolean> {
    const result = getDatabase().deleteChannelPlugin(pluginId);
    return result.success;
  }

  async getUsers(): Promise<IChannelUser[]> {
    const result = getDatabase().getChannelUsers();
    return result.success ? result.data || [] : [];
  }

  async getUserByPlatform(platformUserId: string, platformType: PluginType): Promise<IChannelUser | null> {
    const result = getDatabase().getChannelUserByPlatform(platformUserId, platformType);
    return result.success ? result.data || null : null;
  }

  async deleteUser(userId: string): Promise<boolean> {
    const result = getDatabase().deleteChannelUser(userId);
    return result.success;
  }

  async deleteUsersByPlatform(platformType: string): Promise<number> {
    const result = getDatabase().deleteChannelUsersByPlatform(platformType);
    return result.success ? result.data || 0 : 0;
  }

  async getSessions(): Promise<IChannelSession[]> {
    const result = getDatabase().getChannelSessions();
    return result.success ? result.data || [] : [];
  }

  async getPendingPairingRequests(): Promise<IChannelPairingRequest[]> {
    const result = getDatabase().getPendingPairingRequests();
    return result.success ? result.data || [] : [];
  }

  async approvePairing(code: string): Promise<boolean> {
    // Local approval is handled through PairingService which talks to DB
    // This provider method can be a simple pass-through if needed,
    // but PairingService is already a singleton in Sudowork.
    // For consistency with RemoteChannelProvider, we'll keep it in the interface.
    const { getPairingService } = await import('../pairing/PairingService');
    const result = await getPairingService().approvePairing(code);
    return result.success;
  }

  async rejectPairing(code: string): Promise<boolean> {
    const { getPairingService } = await import('../pairing/PairingService');
    const result = await getPairingService().rejectPairing(code);
    return result.success;
  }

  async testConnection(pluginId: string, credentials: Record<string, any>): Promise<{ success: boolean; botUsername?: string; error?: string }> {
    // Logic extracted from ChannelManager.testPlugin
    const pluginType = this.getPluginTypeFromId(pluginId);

    if (pluginType === 'telegram') {
      const result = await TelegramPlugin.testConnection(credentials.token);
      return { success: result.success, botUsername: result.botInfo?.username, error: result.error };
    }

    if (pluginType === 'lark') {
      const result = await LarkPlugin.testConnection(credentials.appId, credentials.appSecret);
      return { success: result.success, botUsername: result.botInfo?.name, error: result.error };
    }

    if (pluginType === 'dingtalk') {
      const result = await DingTalkPlugin.testConnection(credentials.clientId, credentials.clientSecret);
      return { success: result.success, botUsername: result.botInfo?.name, error: result.error };
    }

    if (pluginType === 'wecom') {
      const result = await WeComPlugin.testConnection(credentials.botId, credentials.secret);
      return { success: result.success, botUsername: result.botInfo?.name, error: result.error };
    }

    return { success: true };
  }

  async syncChannelSettings(): Promise<{ success: boolean; error?: string }> {
    // Local mode: no-op, ChannelManager handles session clearing directly
    return { success: true };
  }

  private getPluginTypeFromId(pluginId: string): string {
    if (pluginId.startsWith('telegram')) return 'telegram';
    if (pluginId.startsWith('lark')) return 'lark';
    if (pluginId.startsWith('dingtalk')) return 'dingtalk';
    if (pluginId.startsWith('wechat')) return 'wechat';
    if (pluginId.startsWith('wecom')) return 'wecom';
    if (pluginId.startsWith('zentao')) return 'zentao';
    return pluginId;
  }
}
