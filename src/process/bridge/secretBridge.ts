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

  ipcBridge.secret.delete.provider(async ({ namespace, key }) => {
    try {
      const client = getSecretStoreClient();
      const deleted = await client.deleteSecret(namespace, key);
      mainLog('SecretBridge', `Secret deleted [${namespace}/${key}]`);
      return { success: true, data: deleted };
    } catch (err) {
      mainError('SecretBridge', `Failed to delete secret [${namespace}/${key}]:`, err);
      return { success: false, data: false };
    }
  });

  ipcBridge.secret.restore.provider(async ({ namespace, key }) => {
    try {
      const client = getSecretStoreClient();
      const restored = await client.restoreSecret(namespace, key);
      mainLog('SecretBridge', `Secret restored [${namespace}/${key}]`);
      return { success: true, data: restored };
    } catch (err) {
      mainError('SecretBridge', `Failed to restore secret [${namespace}/${key}]:`, err);
      return { success: false, data: false };
    }
  });
}
