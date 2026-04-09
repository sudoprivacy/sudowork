/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BasePlugin } from '../BasePlugin';
import type { IChannelPluginConfig, IUnifiedIncomingMessage, IUnifiedOutgoingMessage, PluginType } from '../../types';

export class ZentaoPlugin extends BasePlugin {
  readonly type: PluginType = 'zentao';

  private serverUrl = '';
  private username = '';
  private password = '';

  protected async onInitialize(config: IChannelPluginConfig): Promise<void> {
    const credentials = config.credentials;
    if (!credentials) {
      throw new Error('Zentao credentials are required');
    }
    this.serverUrl = (credentials.serverUrl as string) || '';
    this.username = (credentials.zentaoUsername as string) || '';
    this.password = (credentials.zentaoPassword as string) || '';
  }

  protected async onStart(): Promise<void> {
    // Zentao is not a messaging platform — no persistent connection needed.
    // Just verify credentials are present.
    if (!this.serverUrl || !this.username || !this.password) {
      throw new Error('Zentao credentials are missing');
    }
  }

  protected async onStop(): Promise<void> {
    this.serverUrl = '';
    this.username = '';
    this.password = '';
  }

  async sendMessage(_chatId: string, _message: IUnifiedOutgoingMessage): Promise<string> {
    // Zentao is not a messaging platform
    return '';
  }

  async editMessage(_chatId: string, _messageId: string, _message: IUnifiedOutgoingMessage): Promise<void> {
    // Zentao is not a messaging platform
  }

  getActiveUserCount(): number {
    return 0;
  }

  getBotInfo(): { username?: string; displayName?: string } | null {
    return { displayName: 'Zentao' };
  }

  /**
   * Test Zentao API connection.
   *
   * RESTful API v1 (>=16.5): POST {url}/api.php/v1/tokens
   *   Body: { "account": username, "password": password }
   *   Returns: { "token": "xxx" }
   *
   * Legacy API (<16.5): GET {url}/api-getsessionid.json -> POST {url}/user-login.json
   */
  static async testConnection(
    url?: string,
    username?: string,
    password?: string
  ): Promise<{ success: boolean; botInfo?: { name?: string; username?: string }; error?: string }> {
    if (!url || !username || !password) {
      return { success: false, error: 'Server URL, username and password are required for Zentao' };
    }

    const baseUrl = url.replace(/\/+$/, '');

    // Try RESTful API v1 first (Zentao >= 16.5)
    try {
      const response = await fetch(`${baseUrl}/api.php/v1/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: username, password }),
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.token) {
          return { success: true, botInfo: { name: 'Zentao' } };
        }
      }

      // If 404, fall back to legacy API
      if (response.status === 404) {
        return ZentaoPlugin.testLegacyConnection(baseUrl, username, password);
      }

      // Other error — parse JSON to resolve Unicode escapes into readable text
      const errorText = await response.text().catch(() => '');
      let readableError = errorText;
      try {
        const parsed = JSON.parse(errorText);
        readableError =
          typeof parsed === 'string'
            ? parsed
            : Object.values(parsed as Record<string, unknown>)
                .filter((v) => typeof v === 'string')
                .join(', ') || errorText;
      } catch {
        // not JSON, keep original text
      }
      return { success: false, error: `Zentao API error (${response.status}): ${readableError}` };
    } catch (error: any) {
      // If network error and URL looks like it could be old version, try legacy
      if (error.name === 'TypeError') {
        return ZentaoPlugin.testLegacyConnection(baseUrl, username, password);
      }
      return { success: false, error: error.message || 'Connection failed' };
    }
  }

  private static async testLegacyConnection(
    baseUrl: string,
    username: string,
    password: string
  ): Promise<{ success: boolean; botInfo?: { name?: string }; error?: string }> {
    try {
      // Step 1: Get session ID
      const sessionRes = await fetch(`${baseUrl}/api-getsessionid.json`, {
        signal: AbortSignal.timeout(15000),
      });

      if (!sessionRes.ok) {
        return { success: false, error: `Legacy API session request failed (${sessionRes.status})` };
      }

      // Step 2: Login
      const loginRes = await fetch(`${baseUrl}/user-login.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ account: username, password }),
        signal: AbortSignal.timeout(15000),
      });

      if (loginRes.ok) {
        const data = await loginRes.json();
        if (data.locate || data.user) {
          return { success: true, botInfo: { name: 'Zentao' } };
        }
      }

      // Parse error body for readable message
      const loginErrorText = await loginRes.text().catch(() => '');
      let readableLoginError = loginErrorText;
      try {
        const parsed = JSON.parse(loginErrorText);
        readableLoginError =
          typeof parsed === 'string'
            ? parsed
            : Object.values(parsed as Record<string, unknown>)
                .filter((v) => typeof v === 'string')
                .join(', ') || loginErrorText;
      } catch {
        // not JSON
      }
      return { success: false, error: `Legacy API login failed: ${readableLoginError}` };
    } catch (error: any) {
      return { success: false, error: error.message || 'Legacy API connection failed' };
    }
  }
}
