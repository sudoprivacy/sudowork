/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BUILD_SUDOWORK_SERVER_BASE_URL, normalizeSudoworkServerUrl } from '@sudowork/common/sudoworkServer';
import { sudoworkServer } from '@sudowork/host-bridge/ipcBridge';
import { ProcessConfig } from '../initStorage';

export function initSudoworkServerBridge(): void {
  sudoworkServer.getConfig.provider(async () => {
    return { baseUrl: getAuthServerBaseUrl() };
  });

  sudoworkServer.updateConfig.provider(async (_config) => {
    // No-op: this legacy IPC channel does not own writes to the new
    // `system.sudoworkServerUrl` setting (ModeSetup writes ConfigStorage directly).
    // Kept for backward compatibility with renderer code that may still invoke it.
  });
}

function getAuthServerBaseUrl(): string {
  if (ProcessConfig.getSync('system.appMode') === 'e') {
    const enterpriseUrl = normalizeSudoworkServerUrl(ProcessConfig.getSync('eeclaw.serverUrl'));
    if (enterpriseUrl && isUsableHttpUrl(enterpriseUrl)) return enterpriseUrl;
  }

  return normalizeSudoworkServerUrl(ProcessConfig.getSync('system.sudoworkServerUrl')) ?? BUILD_SUDOWORK_SERVER_BASE_URL;
}

function isUsableHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
