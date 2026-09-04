/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getMossServerUrl, getAuthToken } from '@/common/enterpriseDebugConfig';
import type { IChannelPluginConfig, IChannelUser, PluginType, IChannelPairingRequest, IChannelSession, ChannelPlatform } from '../types';
import type { IChannelProvider } from './IChannelProvider';

/**
 * RemoteChannelProvider - Implementation of IChannelProvider talking to Moss Server REST API
 */
export class RemoteChannelProvider implements IChannelProvider {
  private get baseUrl(): string {
    const url = getMossServerUrl();
    if (!url) {
      console.error('[RemoteChannelProvider] Moss Server URL not configured');
      throw new Error('Moss Server URL not configured for Enterprise Mode');
    }
    return `${url.replace(/\/+$/, '')}/api/v1/channels`;
  }

  private get headers(): Record<string, string> {
    const token = getAuthToken();
    if (!token) {
      console.error('[RemoteChannelProvider] Auth token not configured');
    }
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  async getPlugins(): Promise<IChannelPluginConfig[]> {
    const resp = await fetch(`${this.baseUrl}/plugins`, { headers: this.headers });
    if (!resp.ok) throw new Error(`Failed to fetch plugins: ${resp.statusText}`);
    const data = await resp.json();
    // API returns { plugins: [...] } with 'platform' field instead of 'type'
    const plugins = data.plugins || data;
    return plugins.map((p: any) => ({
      id: p.id,
      type: p.platform || p.type,
      name: p.name || p.platform || p.type,
      enabled: p.enabled,
      credentials: p.credentials && Object.keys(p.credentials).length > 0 ? p.credentials : p.config && Object.keys(p.config).length > 0 ? p.config : undefined,
      config: p.config || {},
      status: p.status || 'stopped',
      lastConnected: p.lastConnected,
      createdAt: p.createdAt || Date.now(),
      updatedAt: p.updatedAt || Date.now(),
    }));
  }

  async getPlugin(pluginId: string): Promise<IChannelPluginConfig | null> {
    const resp = await fetch(`${this.baseUrl}/plugins/${pluginId}`, { headers: this.headers });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`Failed to fetch plugin ${pluginId}: ${resp.statusText}`);
    const p = await resp.json();
    // Adapt API response format
    return {
      id: p.id,
      type: p.platform || p.type,
      name: p.name || p.platform || p.type,
      enabled: p.enabled,
      credentials: p.credentials && Object.keys(p.credentials).length > 0 ? p.credentials : p.config && Object.keys(p.config).length > 0 ? p.config : undefined,
      config: p.config || {},
      status: p.status || 'stopped',
      lastConnected: p.lastConnected,
      createdAt: p.createdAt || Date.now(),
      updatedAt: p.updatedAt || Date.now(),
    };
  }

  async upsertPlugin(plugin: IChannelPluginConfig): Promise<boolean> {
    // API expects credentials directly as body (not wrapped in { credentials, config })
    try {
      const resp = await fetch(`${this.baseUrl}/plugins/${plugin.id}/enable`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(plugin.credentials || {}),
      });
      if (!resp.ok) {
        console.error(`[RemoteChannelProvider] upsertPlugin failed: HTTP ${resp.status} ${resp.statusText}`);
        return false;
      }
      const data = await resp.json();
      if (data.ok !== true && data.success !== true) {
        console.error(`[RemoteChannelProvider] upsertPlugin failed: response`, data);
      }
      return data.ok === true || data.success === true;
    } catch (error) {
      console.error('[RemoteChannelProvider] upsertPlugin error:', error);
      return false;
    }
  }

  async updatePluginStatus(): Promise<boolean> {
    // Enterprise mode: plugin status is managed by Moss Server internally.
    // No API endpoint needed — status changes are reflected automatically.
    return true;
  }

  async updatePluginEnabled(pluginId: string, enabled: boolean): Promise<boolean> {
    const action = enabled ? 'enable' : 'disable';

    // When enabling, include existing credentials in the request body to prevent
    // the server from overwriting stored credentials with an empty object.
    let body: string | undefined;
    if (enabled) {
      try {
        const existing = await this.getPlugin(pluginId);
        if (existing?.credentials && Object.keys(existing.credentials).length > 0) {
          body = JSON.stringify(existing.credentials);
        }
      } catch {
        // Best-effort: if we can't fetch existing credentials, proceed without body
      }
    }

    const resp = await fetch(`${this.baseUrl}/plugins/${pluginId}/${action}`, {
      method: 'POST',
      headers: this.headers,
      body,
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.ok === true || data.success === true;
  }

  /** Ask the server to allocate an additional connection; returns its plugin id. */
  async createPlugin(type: PluginType, name?: string): Promise<string | null> {
    const resp = await fetch(`${this.baseUrl}/plugins/create`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, name }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.id ?? null;
  }

  async deletePlugin(pluginId: string): Promise<boolean> {
    const resp = await fetch(`${this.baseUrl}/plugins/${pluginId}/disable`, {
      method: 'POST',
      headers: this.headers,
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.ok === true || data.success === true;
  }

  async getUsers(): Promise<IChannelUser[]> {
    const resp = await fetch(`${this.baseUrl}/users`, { headers: this.headers });
    if (!resp.ok) throw new Error(`Failed to fetch users: ${resp.statusText}`);
    const data = await resp.json();
    // API returns { users: [...] } with camelCase fields
    const users = data.users || data;
    return users.map((u: any) => ({
      id: u.id,
      platformUserId: u.platformUserId || u.platform_user_id,
      platformType: u.platform || u.platformType || u.platform_type,
      displayName: u.platformDisplayName || u.displayName || u.display_name,
      authorizedAt: u.pairedAt || u.authorizedAt || u.authorized_at,
      lastActive: u.lastSeenAt || u.lastActive || u.last_active,
      sessionId: u.sessionId || u.session_id,
    }));
  }

  async getUserByPlatform(platformUserId: string, platformType: PluginType): Promise<IChannelUser | null> {
    // Need an API for this or filter from getUsers
    const users = await this.getUsers();
    return users.find((u) => u.platformUserId === platformUserId && u.platformType === platformType) || null;
  }

  async deleteUser(userId: string): Promise<boolean> {
    const resp = await fetch(`${this.baseUrl}/users/${userId}`, {
      method: 'DELETE',
      headers: this.headers,
    });
    return resp.ok;
  }

  async deleteUsersByPlatform(platformType: string): Promise<number> {
    try {
      const resp = await fetch(`${this.baseUrl}/users?platform=${encodeURIComponent(platformType)}`, {
        method: 'DELETE',
        headers: this.headers,
      });
      if (!resp.ok) return 0;
      const data = await resp.json();
      return data.count || 0;
    } catch (error) {
      console.error('[RemoteChannelProvider] deleteUsersByPlatform error:', error);
      return 0;
    }
  }

  async getSessions(): Promise<IChannelSession[]> {
    const resp = await fetch(`${this.baseUrl}/sessions`, { headers: this.headers });
    if (!resp.ok) throw new Error(`Failed to fetch sessions: ${resp.statusText}`);
    const data = await resp.json();
    // API may return { sessions: [...] } or direct array
    const sessions = data.sessions || data;
    return sessions.map((s: any) => ({
      id: s.id,
      userId: s.userId || s.user_id,
      agentType: s.agentType || s.agent_type,
      conversationId: s.conversationId || s.conversation_id,
      workspace: s.workspace,
      chatId: s.chatId || s.chat_id,
      title: s.title,
      source: s.source,
      status: s.status,
      createdAt: s.createdAt || s.created_at,
      lastActivity: s.lastActivity || s.last_activity,
    }));
  }

  async getPendingPairingRequests(): Promise<IChannelPairingRequest[]> {
    const resp = await fetch(`${this.baseUrl}/pairings/pending`, { headers: this.headers });
    if (!resp.ok) throw new Error(`Failed to fetch pairings: ${resp.statusText}`);
    const data = await resp.json();
    // API returns { pairings: [...] } with camelCase fields
    const pairings = data.pairings || data;
    return pairings.map((p: any) => ({
      code: p.pairingCode || p.code,
      platformUserId: p.platformUserId || p.platform_user_id,
      platformType: p.platform || p.platformType || p.platform_type,
      displayName: p.platformDisplayName || p.displayName || p.display_name,
      requestedAt: p.requestedAt || p.requested_at || Date.now(),
      expiresAt: p.expiresAt || p.expires_at,
      status: p.status || 'pending',
    }));
  }

  async approvePairing(code: string): Promise<boolean> {
    const resp = await fetch(`${this.baseUrl}/pairings/${code}/approve`, {
      method: 'POST',
      headers: this.headers,
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.ok === true || data.success === true;
  }

  async rejectPairing(code: string): Promise<boolean> {
    const resp = await fetch(`${this.baseUrl}/pairings/${code}/reject`, {
      method: 'POST',
      headers: this.headers,
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.ok === true || data.success === true;
  }

  async testConnection(pluginId: string, credentials: Record<string, any>): Promise<{ success: boolean; botUsername?: string; error?: string }> {
    const resp = await fetch(`${this.baseUrl}/plugins/${pluginId}/test`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(credentials),
    });
    if (!resp.ok) return { success: false, error: resp.statusText };
    const data = await resp.json();
    return {
      success: data.ok === true,
      botUsername: data.ok ? data.message : undefined,
      error: data.ok ? undefined : data.message,
    };
  }

  async syncChannelSettings(platform: ChannelPlatform, agent: { backend: string; customAgentId?: string; name?: string }, model?: { id: string; useModel: string }): Promise<{ success: boolean; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/settings/sync`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ platform, agent, model }),
      });
      if (!resp.ok) return { success: false, error: resp.statusText };
      const data = await resp.json();
      return { success: data.ok === true, error: data.ok ? undefined : data.message };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
