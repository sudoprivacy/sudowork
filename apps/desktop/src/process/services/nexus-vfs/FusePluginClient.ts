/**
 * Frontend adapter for Nexus filesystem driver status through Sudocode capabilities.
 */

import { mainWarn } from '@process/utils/mainLogger';
import { type FusePluginStatus, type FusePluginStatusResult } from '@common/nexus/fuse-plugin-status';
import { getScodeFilesClient, type ScodeFilesClient } from '@common/scode/filesClient';

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
  private readonly nexus: ScodeFilesClient;

  constructor(nexus: ScodeFilesClient) {
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
      response = await this.nexus.callBinary(`${FUSE_PLUGIN_NAME}.status`, Buffer.alloc(0));
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
    instance = new FusePluginClient(getScodeFilesClient());
  }
  return instance;
}

/** Test-only — drop the singleton so unit tests can rebuild it against a fresh mock. */
export function __resetFusePluginClientForTests(): void {
  instance = null;
}
