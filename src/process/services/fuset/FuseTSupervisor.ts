/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * FuseTSupervisor — closes the lazy FUSE-T install loop.
 *
 * Sudowork PR #916 stood up `FuseTInstallService.ensureInstalled()` +
 * its IPC bridge; the lazy contract was "ready but unreached" because
 * nothing on disk read the fuse plugin's `dispatch("status")` and
 * decided when to invoke the installer. This module is that consumer.
 *
 * Flow on `runLazyInstallProbe()`:
 *
 *   1. Probe `fuse.status` via [[FusePluginClient]].
 *   2. If `mounted` / `unmounted` / `unknown` — return; no install
 *      decision the supervisor can make from those states. (The
 *      cluster being unreachable is `unknown` and intentionally does
 *      NOT trigger an admin-password prompt.)
 *   3. If `fuse-t-missing` — call
 *      `fuseTInstallService.ensureInstalled()`. Surfaces one admin
 *      password prompt (the install service's `osascript` step).
 *   4. After install, restart `nexusd-cluster` so the plugin's
 *      `create` runs again and this time clears
 *      `prereq_missing = Some("fuse-t")`. The plugin doesn't expose
 *      a "re-probe in place" dispatch method (that would require a
 *      new admin-method on the Rust side); restarting the cluster
 *      re-runs `nexus_service_create` and is the smallest change that
 *      ends in `status == "mounted"`. The cluster's own restart cost
 *      is bounded (single-node, no Raft peers to rejoin on a
 *      laptop dev setup) so the latency hit is acceptable for a
 *      one-shot install.
 *   5. Re-probe `fuse.status`; return the final outcome.
 *
 * Triggering is ALWAYS opt-in via `ipcBridge.fuseT.runLazyInstallProbe`.
 * Nothing in this module fires on bridge init, app startup, or as a
 * side-effect of importing it elsewhere; the "no eager
 * `ensureInstalled` call" invariant the integration test guards is
 * preserved.
 */

import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { dynamicNexusVfsService } from '@process/services/nexus-vfs/DynamicNexusVfsService';
import { fuseTInstallService, type FuseTProgressCallback } from '@process/services/fuset/FuseTInstallService';
import { getFusePluginClient, type FusePluginClient, type FusePluginStatus } from '@process/services/nexus-vfs/FusePluginClient';

const TAG = 'FuseTSupervisor';

export type FuseTLazyInstallOutcome = 'already-mounted' | 'unmounted-no-prereq-action' | 'installed-and-mounted' | 'installed-but-not-mounted' | 'plugin-unreachable' | 'platform-unsupported' | 'install-failed';

export interface FuseTLazyInstallResult {
  outcome: FuseTLazyInstallOutcome;
  /** Plugin status before any install ran. */
  initialStatus: FusePluginStatus;
  /** Plugin status after the install attempt + cluster restart (only set when an install ran). */
  finalStatus?: FusePluginStatus;
  /** Raw bytes from the plugin's last `status` reply — kept for diagnostics. */
  rawStatus?: string;
  /** Populated when outcome === `install-failed`. */
  errorMessage?: string;
}

/** Minimum surface the supervisor needs from the install service — keeps tests injectable without faking the whole class. */
interface InstallServiceLike {
  ensureInstalled(onProgress?: FuseTProgressCallback): Promise<void>;
}

/** Minimum surface the supervisor needs from the cluster — restart-only. */
interface ClusterControlLike {
  stop(): Promise<void>;
  start(): Promise<void>;
  readonly isRunning: boolean;
}

export interface FuseTSupervisorDeps {
  pluginClient?: FusePluginClient;
  installService?: InstallServiceLike;
  cluster?: ClusterControlLike;
  /**
   * Allow tests to forward platform without monkey-patching
   * `process.platform`. Defaults to `process.platform` in production.
   */
  platform?: NodeJS.Platform;
  onInstallProgress?: FuseTProgressCallback;
}

export class FuseTSupervisor {
  private readonly pluginClient: FusePluginClient;
  private readonly installService: InstallServiceLike;
  private readonly cluster: ClusterControlLike;
  private readonly platform: NodeJS.Platform;
  private readonly onInstallProgress?: FuseTProgressCallback;

  constructor(deps: FuseTSupervisorDeps = {}) {
    this.pluginClient = deps.pluginClient ?? getFusePluginClient();
    this.installService = deps.installService ?? fuseTInstallService;
    this.cluster = deps.cluster ?? dynamicNexusVfsService;
    this.platform = deps.platform ?? process.platform;
    this.onInstallProgress = deps.onInstallProgress;
  }

  /**
   * Probe the plugin's status, install FUSE-T if missing, restart the
   * cluster, return the resolved outcome.
   *
   * Idempotent across overlapping callers in the sense that a second
   * call once the install has completed will see `mounted` and short
   * circuit. The install service has its own re-entrancy guard
   * (`installState.installing`), so two concurrent calls don't both
   * spawn an installer.
   */
  async runLazyInstallProbe(): Promise<FuseTLazyInstallResult> {
    if (this.platform !== 'darwin') {
      // FUSE-T is macOS-only. Other platforms either don't need
      // FUSE-T (Linux uses libfuse3, Windows uses WinFsp) or
      // simply can't install it. Short-circuit with a clean signal
      // instead of dispatching to a plugin that may not even be
      // running on this OS.
      return { outcome: 'platform-unsupported', initialStatus: 'unknown' };
    }

    const initialProbe = await this.pluginClient.getStatus();
    mainLog(TAG, `initial fuse.status=${initialProbe.status} raw=${JSON.stringify(initialProbe.raw)}`);

    switch (initialProbe.status) {
      case 'mounted':
        return { outcome: 'already-mounted', initialStatus: 'mounted', rawStatus: initialProbe.raw };
      case 'unmounted':
        // Plugin loaded but no mount configured. Installing FUSE-T
        // would not change the outcome — the operator just hasn't
        // set `NEXUS_FUSE_MOUNT_POINT`. Surface that distinctly.
        return { outcome: 'unmounted-no-prereq-action', initialStatus: 'unmounted', rawStatus: initialProbe.raw };
      case 'unknown':
        // Cluster down, plugin missing, ABI-mismatch UNIMPLEMENTED,
        // etc. NEVER auto-trigger an install on `unknown` — that
        // would prompt for an admin password every time the
        // cluster is mid-restart.
        return { outcome: 'plugin-unreachable', initialStatus: 'unknown', rawStatus: initialProbe.raw };
      case 'fuse-t-missing':
        return await this.installAndReprobe(initialProbe.raw);
    }
  }

  private async installAndReprobe(initialRaw: string): Promise<FuseTLazyInstallResult> {
    try {
      mainLog(TAG, 'fuse-t-missing reported; invoking FuseTInstallService.ensureInstalled');
      await this.installService.ensureInstalled(this.onInstallProgress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWarn(TAG, `ensureInstalled failed: ${msg}`);
      return { outcome: 'install-failed', initialStatus: 'fuse-t-missing', rawStatus: initialRaw, errorMessage: msg };
    }

    // Restart the cluster so the plugin's `create` re-runs its
    // `is_fuse_t_installed()` probe with the framework now present.
    // The plugin has no in-place re-probe method (would require a
    // new dispatch verb on the Rust side); restart is the smallest
    // change that ends in `status == "mounted"`.
    try {
      if (this.cluster.isRunning) {
        mainLog(TAG, 'stopping nexusd-cluster to re-run plugin create() with FUSE-T present');
        await this.cluster.stop();
      }
      mainLog(TAG, 'starting nexusd-cluster post-install');
      await this.cluster.start();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mainWarn(TAG, `cluster restart failed post-install: ${msg}`);
      return { outcome: 'install-failed', initialStatus: 'fuse-t-missing', rawStatus: initialRaw, errorMessage: `FUSE-T installed but cluster restart failed: ${msg}` };
    }

    const finalProbe = await this.pluginClient.getStatus();
    mainLog(TAG, `post-install fuse.status=${finalProbe.status} raw=${JSON.stringify(finalProbe.raw)}`);
    if (finalProbe.status === 'mounted') {
      return { outcome: 'installed-and-mounted', initialStatus: 'fuse-t-missing', finalStatus: 'mounted', rawStatus: finalProbe.raw };
    }
    // Install ran cleanly but the plugin didn't end up mounted. Most
    // common cause is `NEXUS_FUSE_MOUNT_POINT` not being set — that's
    // a configuration follow-up, not an install regression. Return a
    // distinct outcome so the caller can surface "FUSE-T provisioned,
    // but no mount happened yet" instead of pretending success.
    return { outcome: 'installed-but-not-mounted', initialStatus: 'fuse-t-missing', finalStatus: finalProbe.status, rawStatus: finalProbe.raw };
  }
}

let instance: FuseTSupervisor | null = null;

export function getFuseTSupervisor(): FuseTSupervisor {
  if (!instance) {
    instance = new FuseTSupervisor();
  }
  return instance;
}

/** Test-only — drop the singleton so unit tests can rebuild it. */
export function __resetFuseTSupervisorForTests(): void {
  instance = null;
}
