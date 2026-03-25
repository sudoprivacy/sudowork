/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

// Re-export transport, gateway, and type utilities.
// The OpenClawAgent class now lives in src/process/task/OpenClawAgent.ts
// (merged with the former OpenClawAgentManager).
export { OpenClawGatewayConnection } from './OpenClawGatewayConnection';
export { OpenClawGatewayManager } from './OpenClawGatewayManager';
export type { OpenClawGatewayConfig } from './types';
