/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * FusePluginClient — typed wrapper over the `nexus-fuse-plugin`
 * dispatch surface served by `nexusd-cluster` on port 12022.
 *
 * The plugin exposes a single `dispatch(method, payload)` C-ABI entry
 * point (registered as service plugin `"fuse"` via
 * `declare_service_plugin!`). Routing convention on the cluster's
 * generic Call RPC: `"<plugin-name>.<method>"`, mirroring how
 * `NexusSecretClient` reaches vault via `password-vault.<method>`.
 *
 * Today this client uses option **(b)** from the supervisor PR plan:
 * reuse the existing v2 dispatch surface with raw UTF-8 byte payloads
 * (the plugin's first-cut admin surface). The trade-off vs option
 * (a) — adding a typed `nexus.fuse.v1.FusePluginService` gRPC service
 * to the plugin's `nexus_plugin_grpc_services` table — is documented
 * in the FUSE-T supervisor PR plan; option (a) is the migration
 * target once the `dispatch("status")` vocabulary grows beyond
 * `<prereq>-missing` / `mounted` / `unmounted`. The string surface
 * is fine as the wire format until then, because the supervisor
 * already only matches on the `<prereq>-missing` shape (not on a
 * structured field), and adding a new prereq is a single-line
 * change on both sides.
 */

import { mainWarn } from '@process/utils/mainLogger';
import { type FusePluginStatus, type FusePluginStatusResult } from '@common/nexus/fuse-plugin-status';
import { getNexusRpcClient, type Nexus } from '@common/nexus/nexus-vfs-client';

export type { FusePluginStatus, FusePluginStatusResult } from '@common/nexus/fuse-plugin-status';

const TAG = 'FusePluginClient';

/**
 * Plugin name as declared in `nexi-lab/nexus`
 * `rust/services/fuse-plugin/src/lib.rs:409` —
 * `declare_service_plugin!("fuse", FusePlugin, { ... })`. Don't
 * inline this string at call sites; if the plugin ever re-declares
 * itself we want one place to update.
 */
const FUSE_PLUGIN_NAME = 'fuse';

export class FusePluginClient {
  private readonly nexus: Nexus;

  constructor(nexus: Nexus) {
    this.nexus = nexus;
  }

  /**
   * Probe the plugin's `status` method.
   *
   * Errors from the underlying gRPC call (cluster down, plugin not
   * loaded, ABI-mismatch UNIMPLEMENTED) are collapsed to
   * `status: 'unknown'` with the raw error message captured. The
   * supervisor must not treat an unreachable cluster as a missing
   * prereq — that would prompt for an admin password every time the
   * cluster is restarting.
   */
  async getStatus(): Promise<FusePluginStatusResult> {
    let response: Buffer;
    try {
      response = this.nexus.callBinary(`${FUSE_PLUGIN_NAME}.status`, Buffer.alloc(0));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWarn(TAG, `getStatus dispatch failed: ${msg}`);
      return { status: 'unknown', raw: msg };
    }
    const raw = response.toString('utf-8').trim();
    return { status: parseStatus(raw), raw };
  }
}

function parseStatus(raw: string): FusePluginStatus {
  switch (raw) {
    case 'mounted':
    case 'unmounted':
    case 'fuse-t-missing':
      return raw;
    default:
      return 'unknown';
  }
}

let instance: FusePluginClient | null = null;

export function getFusePluginClient(): FusePluginClient {
  if (!instance) {
    instance = new FusePluginClient(getNexusRpcClient());
  }
  return instance;
}

/** Test-only — drop the singleton so unit tests can rebuild it against a fresh mock. */
export function __resetFusePluginClientForTests(): void {
  instance = null;
}
