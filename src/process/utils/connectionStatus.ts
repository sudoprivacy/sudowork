/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

export type AgentConnectionStatus = 'connecting' | 'connected' | 'authenticated' | 'session_active' | 'disconnected' | 'error';

export function resolveOpenClawConnectionStatus(params: { lastStatus?: string | null; isConnected: boolean; hasActiveSession: boolean }): AgentConnectionStatus | null {
  const { lastStatus, isConnected, hasActiveSession } = params;

  if (isConnected && hasActiveSession) {
    return 'session_active';
  }

  if (isConnected) {
    return 'connected';
  }

  if (lastStatus === 'connecting' || lastStatus === 'error' || lastStatus === 'disconnected') {
    return lastStatus;
  }

  if (lastStatus === 'connected' || lastStatus === 'session_active') {
    return 'disconnected';
  }

  return null;
}

export function resolveOpenClawGatewayHealthStatus(gatewayRunning: boolean): AgentConnectionStatus {
  return gatewayRunning ? 'connected' : 'disconnected';
}
