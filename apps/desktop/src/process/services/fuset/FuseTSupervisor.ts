/**
 * Probes filesystem driver prerequisites through Sudocode.
 * An explicit user action installs FUSE-T and asks Sudocode to refresh its services.
 * The final driver probe supplies the frontend's mount status.
 */

import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { scodeRuntimeService } from '@process/services/scode/ScodeRuntimeService';
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

/** Minimum surface needed to provision the deferred plugin and restart the cluster. */
interface ClusterControlLike {
  restart(): Promise<void>;
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
    this.cluster = deps.cluster ?? scodeRuntimeService;
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
      await this.cluster.restart();
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
