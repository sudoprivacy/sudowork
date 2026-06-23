/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Canonical types for the `nexus-fuse-plugin` status surface.
 *
 * Wire format is decided on the Rust side
 * (`nexi-lab/nexus rust/services/fuse-plugin/src/lib.rs:dispatch_fuse`);
 * this file is the TypeScript mirror. Lives in `src/common/` so both
 * the main-process supervisor (`@process/services/nexus-vfs/FusePluginClient`)
 * AND the renderer-visible IPC bridge (`@common/ipcBridge.fuseT`) import
 * the SAME literal union — there is no `IFusePluginStatus` / `FusePluginStatus`
 * pair drifting in parallel.
 *
 * If the Rust plugin grows a new prereq (`"libfuse3-missing"`,
 * `"winfsp-missing"`, …) extend the union here and the supervisor's
 * switch; no other file needs to know.
 */

/**
 * Outcomes of the plugin's `dispatch("status")` admin method.
 *
 *   - `mounted` — FUSE event loop running.
 *   - `unmounted` — plugin loaded but no mount point configured
 *     (`NEXUS_FUSE_MOUNT_POINT` env unset).
 *   - `fuse-t-missing` — macOS-only; FUSE-T `.pkg` not installed yet.
 *     The supervisor's trigger for `fuseTInstallService.ensureInstalled()`.
 *   - `unknown` — cluster down, plugin not loaded, dispatch returned
 *     something we don't recognise. NEVER an install trigger.
 */
export type FusePluginStatus = 'mounted' | 'unmounted' | 'fuse-t-missing' | 'unknown';

export interface FusePluginStatusResult {
  status: FusePluginStatus;
  /** Exact bytes the plugin returned, decoded as UTF-8. Kept for diagnostics when `status` is `unknown`. */
  raw: string;
}
