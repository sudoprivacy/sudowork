/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IChannelPluginConfig, IChannelUser, IChannelPairingRequest, IChannelSession, PluginType, PluginStatus, ChannelPlatform } from '../types';

/**
 * IChannelProvider - Interface for channel data and management operations
 * abstracts difference between local (SQLite) and remote (Moss API) storage/execution.
 */
export interface IChannelProvider {
  // Plugin management
  getPlugins(): Promise<IChannelPluginConfig[]>;
  getPlugin(pluginId: string): Promise<IChannelPluginConfig | null>;
  upsertPlugin(plugin: IChannelPluginConfig): Promise<boolean>;
  updatePluginStatus(pluginId: string, status: PluginStatus, lastConnected?: number): Promise<boolean>;
  updatePluginEnabled(pluginId: string, enabled: boolean, status: PluginStatus): Promise<boolean>;
  deletePlugin(pluginId: string): Promise<boolean>;

  // User management
  getUsers(): Promise<IChannelUser[]>;
  getUserByPlatform(platformUserId: string, platformType: PluginType): Promise<IChannelUser | null>;
  deleteUser(userId: string): Promise<boolean>;
  deleteUsersByPlatform(platformType: string): Promise<number>;

  // Session management
  getSessions(): Promise<IChannelSession[]>;

  // Pairing management
  getPendingPairingRequests(): Promise<IChannelPairingRequest[]>;
  approvePairing(code: string): Promise<boolean>;
  rejectPairing(code: string): Promise<boolean>;

  // Connection testing
  testConnection(pluginId: string, credentials: Record<string, any>): Promise<{ success: boolean; botUsername?: string; error?: string }>;

  // Settings sync
  syncChannelSettings(platform: ChannelPlatform, agent: { backend: string; customAgentId?: string; name?: string }, model?: { id: string; useModel: string }): Promise<{ success: boolean; error?: string }>;
}
