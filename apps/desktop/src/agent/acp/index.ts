/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

// Re-export transport, adapter, and type utilities.
// The AcpAgent class now lives in src/process/task/AcpAgent.ts
// (merged with the former AcpAgentManager).
export { AcpConnection } from './AcpConnection';
export { AcpAdapter } from './AcpAdapter';
export { AcpApprovalStore, createAcpApprovalKey } from './ApprovalStore';
export type { AcpTransport, AcpTransportEvents } from './transport';
export { StdioAcpTransport, GrpcAcpTransport } from './transport';
