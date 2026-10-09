/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Opt-in ACP performance logging (`ACP_PERF=1`). Lives in its own electron-free
 * module so the transport/reader layer can gate perf logs without importing the
 * electron-tainted acpConnectors just for this flag.
 */
export const ACP_PERF_LOG = process.env.ACP_PERF === '1';
