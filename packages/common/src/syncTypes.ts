/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Remote → Local sync result types — the wire shape the IPC bridge reports for a
 * sync run. Pure value types so the bridge and the sync runtime share one
 * definition without the bridge depending on that runtime.
 */

export type SyncResult = {
  installed: string[];
  skipped: string[];
  deleted: string[];
  failed: Array<{ id: string; name: string; error: string }>;
};

export type SyncAllResult = {
  skills: { hub: SyncResult; tenant: SyncResult };
  assistants: { hub: SyncResult; tenant: SyncResult };
};
