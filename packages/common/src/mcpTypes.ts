/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpBackendAll } from './acpTypes.js';

/**
 * MCP源类型 - 包括所有ACP后端和Sudowork内置
 * MCP source type — all ACP backends plus the Sudowork builtin. A pure union so
 * the IPC bridge can reference it without reaching into the main-process MCP runtime.
 */
export type McpSource = AcpBackendAll | 'sudowork';
