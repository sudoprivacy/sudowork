/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

export type AgentConnectionStatus = 'connecting' | 'connected' | 'authenticated' | 'session_active' | 'disconnected' | 'error';

export function resolveGatewayHealthStatus(gatewayRunning: boolean): AgentConnectionStatus {
  return gatewayRunning ? 'connected' : 'disconnected';
}
