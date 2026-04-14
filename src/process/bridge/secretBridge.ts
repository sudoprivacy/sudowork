/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '../../common';
import { getSecretStoreClient } from '@common/nexus/secret-store';
import { mainLog, mainError } from '@process/utils/mainLogger';

export function initSecretBridge(): void {
  ipcBridge.secret.get.provider(async ({ namespace, key }) => {
    try {
      const client = getSecretStoreClient();
      const value = await client.getSecret(namespace, key);
      return { success: true, data: value };
    } catch (err) {
      mainError('SecretBridge', `Failed to get secret [${namespace}/${key}]:`, err);
      return { success: false, data: null };
    }
  });

  ipcBridge.secret.put.provider(async ({ namespace, key, value, description }) => {
    try {
      const client = getSecretStoreClient();
      await client.putSecret(namespace, key, value, description);
      mainLog('SecretBridge', `Secret saved [${namespace}/${key}]`);
      return { success: true };
    } catch (err) {
      mainError('SecretBridge', `Failed to put secret [${namespace}/${key}]:`, err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.secret.list.provider(async ({ namespace }) => {
    try {
      const client = getSecretStoreClient();
      const secrets = await client.listSecrets(namespace);
      return { success: true, data: secrets };
    } catch (err) {
      mainError('SecretBridge', `Failed to list secrets [${namespace}]:`, err);
      return { success: false, data: [] };
    }
  });

  ipcBridge.secret.testZentao.provider(async ({ serverUrl, username, password }) => {
    try {
      const result = await testZentaoConnection(serverUrl, username, password);
      return { success: true, data: result };
    } catch (err) {
      mainError('SecretBridge', 'Failed to test Zentao connection:', err);
      return { success: true, data: { success: false, error: err instanceof Error ? err.message : String(err) } };
    }
  });
}

/**
 * Test Zentao API connection.
 *
 * RESTful API v1 (>=16.5): POST {url}/api.php/v1/tokens
 * Legacy API (<16.5): GET {url}/api-getsessionid.json -> POST {url}/user-login.json
 */
async function testZentaoConnection(url: string, username: string, password: string): Promise<{ success: boolean; error?: string }> {
  if (!url || !username || !password) {
    return { success: false, error: 'Server URL, username and password are required' };
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
        return { success: true };
      }
    }

    // If 404, fall back to legacy API
    if (response.status === 404) {
      return testZentaoLegacyConnection(baseUrl, username, password);
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
      return testZentaoLegacyConnection(baseUrl, username, password);
    }
    return { success: false, error: error.message || 'Connection failed' };
  }
}

async function testZentaoLegacyConnection(baseUrl: string, username: string, password: string): Promise<{ success: boolean; error?: string }> {
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
        return { success: true };
      }
    }

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
