/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Vault secret metadata as produced by NexusSecretClient — the single source of
 * truth for the `secret.*` IPC wire shape. A pure type so the IPC bridge can
 * describe secrets without depending on the gRPC secret runtime.
 */
export interface SecretMetadata {
  namespace: string;
  key: string;
  description?: string;
  currentVersion: number;
  deleted: boolean;
  createdAt?: number;
  updatedAt?: number;
}
