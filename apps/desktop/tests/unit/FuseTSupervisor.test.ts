import { describe, it, expect, vi } from 'vitest';

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

// Stub the singleton dependencies — the supervisor accepts injected
// fakes for all of them in tests, but importing the module still
// pulls these in transitively (DynamicNexusVfsService imports electron).
vi.mock('@process/services/nexus-vfs/DynamicNexusVfsService', () => ({
  dynamicNexusVfsService: {
    stop: vi.fn(),
    start: vi.fn(),
    get isRunning() {
      return false;
    },
  },
}));
vi.mock('@process/services/fuset/FuseTInstallService', () => ({
  fuseTInstallService: { ensureInstalled: vi.fn() },
}));
vi.mock('@process/services/nexus-vfs/FusePluginClient', () => ({
  getFusePluginClient: () => ({ getStatus: vi.fn() }),
}));

import { FuseTSupervisor } from '../../src/process/services/fuset/FuseTSupervisor';
import type { FusePluginStatus, FusePluginStatusResult } from '../../src/process/services/nexus-vfs/FusePluginClient';

interface Mocks {
  getStatus: ReturnType<typeof vi.fn>;
  ensureInstalled: ReturnType<typeof vi.fn>;
  clusterStop: ReturnType<typeof vi.fn>;
  clusterStart: ReturnType<typeof vi.fn>;
}

interface BuildOpts {
  statusSequence: FusePluginStatusResult[];
  ensureInstalledImpl?: () => Promise<void>;
  clusterIsRunning?: boolean;
  platform?: NodeJS.Platform;
}

function build(opts: BuildOpts): { supervisor: FuseTSupervisor; mocks: Mocks } {
  const statusQueue = [...opts.statusSequence];
  const getStatus = vi.fn(() => Promise.resolve(statusQueue.shift() ?? { status: 'unknown' as FusePluginStatus, raw: '' }));
  const ensureInstalled = vi.fn(opts.ensureInstalledImpl ?? (() => Promise.resolve()));
  const clusterStop = vi.fn(() => Promise.resolve());
  const clusterStart = vi.fn(() => Promise.resolve());
  const supervisor = new FuseTSupervisor({
    platform: opts.platform ?? 'darwin',
    pluginClient: { getStatus } as never,
    installService: { ensureInstalled },
    cluster: {
      stop: clusterStop,
      start: clusterStart,
      get isRunning() {
        return opts.clusterIsRunning ?? true;
      },
    },
  });
  return { supervisor, mocks: { getStatus, ensureInstalled, clusterStop, clusterStart } };
}

describe('FuseTSupervisor.runLazyInstallProbe', () => {
  it('returns `already-mounted` and does NOT touch the installer when plugin reports mounted', async () => {
    const { supervisor, mocks } = build({ statusSequence: [{ status: 'mounted', raw: 'mounted' }] });
    const result = await supervisor.runLazyInstallProbe();
    expect(result).toEqual({ outcome: 'already-mounted', initialStatus: 'mounted', rawStatus: 'mounted' });
    // Core invariant: never invoke the admin-password-prompting
    // installer on a `mounted` reply. This is what makes the lazy
    // contract safe to call from any UI surface — repeated
    // invocations cost one gRPC roundtrip, not a UAC dialog.
    expect(mocks.ensureInstalled).not.toHaveBeenCalled();
    expect(mocks.clusterStop).not.toHaveBeenCalled();
    expect(mocks.clusterStart).not.toHaveBeenCalled();
  });

  it('returns `unmounted-no-prereq-action` and does NOT install when plugin reports unmounted', async () => {
    const { supervisor, mocks } = build({ statusSequence: [{ status: 'unmounted', raw: 'unmounted' }] });
    const result = await supervisor.runLazyInstallProbe();
    expect(result.outcome).toBe('unmounted-no-prereq-action');
    // `unmounted` means the operator hasn't set
    // `NEXUS_FUSE_MOUNT_POINT`, not that FUSE-T is missing. A FUSE-T
    // install would not change the outcome, so the supervisor must
    // not prompt.
    expect(mocks.ensureInstalled).not.toHaveBeenCalled();
  });

  it('returns `plugin-unreachable` and does NOT install when status is unknown', async () => {
    const { supervisor, mocks } = build({ statusSequence: [{ status: 'unknown', raw: 'UNIMPLEMENTED' }] });
    const result = await supervisor.runLazyInstallProbe();
    expect(result.outcome).toBe('plugin-unreachable');
    expect(result.rawStatus).toBe('UNIMPLEMENTED');
    // `unknown` covers cluster-down + ABI-mismatch UNIMPLEMENTED.
    // Treating this as "install missing" would prompt for an admin
    // password every time the cluster restarts — the supervisor
    // MUST stay silent here.
    expect(mocks.ensureInstalled).not.toHaveBeenCalled();
  });

  it('returns `installed-and-mounted` when fuse-t-missing → install → cluster restart → mounted', async () => {
    const { supervisor, mocks } = build({
      statusSequence: [
        { status: 'fuse-t-missing', raw: 'fuse-t-missing' },
        { status: 'mounted', raw: 'mounted' },
      ],
    });
    const result = await supervisor.runLazyInstallProbe();
    expect(result).toEqual({
      outcome: 'installed-and-mounted',
      initialStatus: 'fuse-t-missing',
      finalStatus: 'mounted',
      rawStatus: 'mounted',
    });
    expect(mocks.ensureInstalled).toHaveBeenCalledTimes(1);
    // Both stop+start must run — the plugin's `create` only re-probes
    // FUSE-T on a fresh `nexus_service_create` invocation, not in
    // place. If the supervisor ever skips the restart, the second
    // probe will still see `fuse-t-missing` even after a successful
    // install.
    expect(mocks.clusterStop).toHaveBeenCalledTimes(1);
    expect(mocks.clusterStart).toHaveBeenCalledTimes(1);
  });

  it('skips cluster.stop() when cluster is not currently running, but still starts it', async () => {
    const { supervisor, mocks } = build({
      statusSequence: [
        { status: 'fuse-t-missing', raw: 'fuse-t-missing' },
        { status: 'mounted', raw: 'mounted' },
      ],
      clusterIsRunning: false,
    });
    await supervisor.runLazyInstallProbe();
    expect(mocks.clusterStop).not.toHaveBeenCalled();
    expect(mocks.clusterStart).toHaveBeenCalledTimes(1);
  });

  it('returns `installed-but-not-mounted` when install succeeds but plugin still does not mount', async () => {
    const { supervisor } = build({
      statusSequence: [
        { status: 'fuse-t-missing', raw: 'fuse-t-missing' },
        { status: 'unmounted', raw: 'unmounted' },
      ],
    });
    const result = await supervisor.runLazyInstallProbe();
    // `unmounted` after a clean install means the operator hasn't
    // set `NEXUS_FUSE_MOUNT_POINT`. The install itself succeeded;
    // surface a distinct outcome instead of pretending the mount
    // is live.
    expect(result.outcome).toBe('installed-but-not-mounted');
    expect(result.finalStatus).toBe('unmounted');
  });

  it('returns `install-failed` with the underlying error when ensureInstalled throws', async () => {
    const { supervisor, mocks } = build({
      statusSequence: [{ status: 'fuse-t-missing', raw: 'fuse-t-missing' }],
      ensureInstalledImpl: () => Promise.reject(new Error('SHA mismatch')),
    });
    const result = await supervisor.runLazyInstallProbe();
    expect(result.outcome).toBe('install-failed');
    expect(result.errorMessage).toContain('SHA mismatch');
    // No cluster restart on install failure — the plugin's state
    // hasn't changed, so a restart would just churn the daemon.
    expect(mocks.clusterStop).not.toHaveBeenCalled();
    expect(mocks.clusterStart).not.toHaveBeenCalled();
  });

  it('returns `install-failed` when cluster restart blows up post-install', async () => {
    const { supervisor, mocks } = build({
      statusSequence: [{ status: 'fuse-t-missing', raw: 'fuse-t-missing' }],
    });
    mocks.clusterStart.mockRejectedValueOnce(new Error('port in use'));
    const result = await supervisor.runLazyInstallProbe();
    expect(result.outcome).toBe('install-failed');
    expect(result.errorMessage).toContain('cluster restart failed');
    expect(result.errorMessage).toContain('port in use');
  });

  it('returns `platform-unsupported` on non-darwin without contacting the cluster', async () => {
    const { supervisor, mocks } = build({
      statusSequence: [],
      platform: 'linux',
    });
    const result = await supervisor.runLazyInstallProbe();
    expect(result.outcome).toBe('platform-unsupported');
    // Linux uses libfuse3 (apt) and Windows uses WinFsp; neither
    // path goes through the FUSE-T installer. Short-circuiting here
    // avoids a probe round-trip on every cross-platform call.
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.ensureInstalled).not.toHaveBeenCalled();
  });
});
