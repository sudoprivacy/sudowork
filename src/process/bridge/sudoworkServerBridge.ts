/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { sudoworkServer } from '@/common/ipcBridge';
import { ProcessConfig } from '../initStorage';

export function initSudoworkServerBridge(): void {
  sudoworkServer.getConfig.provider(async () => {
    return (await ProcessConfig.get('sudowork.server')) || { baseUrl: 'http://localhost:3000' };
  });

  sudoworkServer.updateConfig.provider(async (config) => {
    const current = (await ProcessConfig.get('sudowork.server')) || { baseUrl: 'http://localhost:3000' };
    await ProcessConfig.set('sudowork.server', { ...current, ...config });
  });
}
