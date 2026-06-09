/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '../../common';
import { getNexusSecretClient } from '@common/nexus/nexus-secret-client';
import { cachePut, cacheDelete } from '@common/nexus/secret-cache';
import { mainLog, mainError } from '@process/utils/mainLogger';

export function initSecretBridge(): void {
  ipcBridge.secret.get.provider(async ({ namespace, key }) => {
    try {
      const client = getNexusSecretClient();
      const value = client.getSecret(namespace, key);
      return { success: true, data: value };
    } catch (err) {
      mainError('SecretBridge', `Failed to get secret [${namespace}/${key}]:`, err);
      return { success: false, data: null };
    }
  });

  ipcBridge.secret.put.provider(async ({ namespace, key, value, description }) => {
    try {
      const client = getNexusSecretClient();
      client.putSecret(namespace, key, value, description);
      cachePut(namespace, key, value);
      mainLog('SecretBridge', `Secret saved [${namespace}/${key}]`);
      return { success: true };
    } catch (err) {
      mainError('SecretBridge', `Failed to put secret [${namespace}/${key}]:`, err);
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.secret.list.provider(async ({ namespace }) => {
    try {
      const client = getNexusSecretClient();
      const secrets = client.listSecrets(namespace);
      return { success: true, data: secrets };
    } catch (err) {
      mainError('SecretBridge', `Failed to list secrets [${namespace}]:`, err);
      return { success: false, data: [] };
    }
  });

  ipcBridge.secret.delete.provider(async ({ namespace, key }) => {
    try {
      const client = getNexusSecretClient();
      const deleted = client.deleteSecret(namespace, key);
      cacheDelete(namespace, key);
      mainLog('SecretBridge', `Secret deleted [${namespace}/${key}]`);
      return { success: true, data: deleted };
    } catch (err) {
      mainError('SecretBridge', `Failed to delete secret [${namespace}/${key}]:`, err);
      return { success: false, data: false };
    }
  });

  ipcBridge.secret.restore.provider(async ({ namespace, key }) => {
    try {
      const client = getNexusSecretClient();
      const restored = client.restoreSecret(namespace, key);
      const value = client.getSecret(namespace, key);
      cachePut(namespace, key, value);
      mainLog('SecretBridge', `Secret restored [${namespace}/${key}]`);
      return { success: true, data: restored };
    } catch (err) {
      mainError('SecretBridge', `Failed to restore secret [${namespace}/${key}]:`, err);
      return { success: false, data: false };
    }
  });
}
