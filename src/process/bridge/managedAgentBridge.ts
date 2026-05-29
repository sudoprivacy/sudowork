/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '../../common';
import { ManagedAgentClient } from '../../common/nexus/managed-agent-client';
import { dynamicNexusService } from '../services/nexus/DynamicNexusService';
import { mainLog, mainError } from '@process/utils/mainLogger';

let client: ManagedAgentClient | null = null;

function getClient(): ManagedAgentClient {
  if (!client) {
    const endpoint = `http://localhost:${dynamicNexusService.grpcPort}`;
    mainLog('ManagedAgentBridge', `Connecting to nexusd gRPC at ${endpoint}`);
    client = new ManagedAgentClient(endpoint);
  }
  return client;
}

export function initManagedAgentBridge(): void {
  ipcBridge.managedAgent.startSession.provider(async (params) => {
    try {
      const result = await getClient().startSession(params);
      mainLog('ManagedAgentBridge', `Session started: ${result.sessionId}`);
      return { success: true, data: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainError('ManagedAgentBridge', 'startSession failed:', err);
      return { success: false, msg };
    }
  });

  ipcBridge.managedAgent.cancelSession.provider(async (params) => {
    try {
      const result = await getClient().cancelSession(params);
      mainLog('ManagedAgentBridge', `Session ${params.sessionId} cancel: ${result.cancelled}`);
      return { success: true, data: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainError('ManagedAgentBridge', 'cancelSession failed:', err);
      return { success: false, msg };
    }
  });

  ipcBridge.managedAgent.getSession.provider(async (params) => {
    try {
      const result = await getClient().getSession(params);
      return { success: true, data: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainError('ManagedAgentBridge', 'getSession failed:', err);
      return { success: false, msg };
    }
  });
}
