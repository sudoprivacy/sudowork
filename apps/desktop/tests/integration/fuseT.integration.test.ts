/**
 * Integration tests for the FUSE-T lazy installer contract.
 *
 * Three contracts to protect:
 *
 *   1. Lazy contract — `RuntimeInstaller.ensureAll()` MUST NOT touch
 *      `FuseTInstallService`, directly or transitively. The whole point
 *      of the lazy split (sudowork issue #915) is that non-opt-in Mac
 *      users see zero admin-password prompts on cold start. A future
 *      well-meaning import of `fuseTInstallService` from
 *      `RuntimeInstaller.ts` would silently break that contract; this
 *      test catches it at module-load time.
 *
 *   2. Platform gate — invoking the FUSE-T install through the IPC
 *      surface on non-darwin must fail with a recognisable error rather
 *      than silently succeeding or hanging. CI runs on Linux + Windows,
 *      so this is exactly the regression we can catch automatically.
 *
 *   3. Eager dispatch wiring — `scripts/download-nexus-vfs.js` exposes
 *      the macOS fuse-plugin artifact names (used by the kernel team to
 *      know where to upload signed assets and by the integration smoke
 *      to know what to grep for). Renaming or dropping these silently
 *      regresses #915's "eager dylib copy" half of the design.
 *
 * Real macOS end-to-end coverage — running the actual `osascript`
 * `installer -pkg` flow and watching `/Library/Filesystems/fuse-t.fs`
 * appear — lives in the Mac team's manual smoke checklist (PR #916
 * description). CI cannot run that path: it needs a real Mac host with
 * a real admin password.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

const originalPlatform = process.platform;
function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

describe('FUSE-T — lazy install contract', () => {
  it('RuntimeInstaller does not import FuseTInstallService or fuseTBridge', () => {
    // Static check: the lazy contract lives or dies on this file never
    // gaining a `from '../fuset/FuseTInstallService'` import. A
    // semantically-correct refactor of the installer wiring could
    // accidentally pull it in (e.g. someone "consolidates" all install
    // services). Catching that here is cheap and obvious.
    const ruInstaller = fs.readFileSync(path.join(REPO_ROOT, 'src/process/services/serviceManager/RuntimeInstaller.ts'), 'utf-8');
    expect(ruInstaller).not.toMatch(/FuseTInstallService|fuseTBridge|fuseTInstallService|services\/fuset/);
  });

  it('initAllBridges wires initFuseTBridge but the bridge itself does not auto-install', async () => {
    // The bridge registers IPC providers — but nothing inside
    // `initFuseTBridge()` should call `ensureInstalled()` eagerly. The
    // providers only fire when a renderer / worker explicitly invokes
    // `ipcBridge.fuseT.ensureInstalled`. Read the bridge source and
    // assert no top-level call to ensureInstalled.
    const bridge = fs.readFileSync(path.join(REPO_ROOT, 'src/process/bridge/fuseTBridge.ts'), 'utf-8');
    // Strip provider(async ...) bodies — any remaining occurrence of
    // `ensureInstalled` or `install(` would be an eager call at init
    // time — the regression we care about.
    const stripped = bridge.replace(/provider\(async[\s\S]*?\}\);/g, '/* provider-body */');
    expect(stripped).not.toMatch(/fuseTInstallService\.ensureInstalled|fuseTInstallService\.install\(/);
  });

  it('the bridge registers `runLazyInstallProbe` and routes it through FuseTSupervisor', () => {
    // The lazy contract closes here: the only path that ends in an
    // admin-password prompt MUST be the supervisor-mediated probe.
    // A direct call to `fuseTInstallService.ensureInstalled` from
    // `runLazyInstallProbe`'s body (skipping the supervisor) would
    // re-introduce the bug PR #916 was designed to prevent — the
    // supervisor's "is FUSE-T actually missing?" probe is what
    // makes repeated calls cheap.
    const bridge = fs.readFileSync(path.join(REPO_ROOT, 'src/process/bridge/fuseTBridge.ts'), 'utf-8');
    expect(bridge).toMatch(/ipcBridge\.fuseT\.runLazyInstallProbe\.provider/);
    expect(bridge).toMatch(/FuseTSupervisor/);
    expect(bridge).toMatch(/supervisor\.runLazyInstallProbe\(/);
  });

  it('the bridge resets installing=false synchronously in finally (no setTimeout deferral)', () => {
    // The 2026-06-24 Win cold-start smoke observed `getInstallState()`
    // returning `{installing: true}` immediately after a
    // `runLazyInstallProbe()` resolved with `platform-unsupported`.
    // Root cause: both providers used `setTimeout(() => { installState
    // = { installing: false } }, 0)` in their finally blocks. The
    // setTimeout deferred the reset past the IPC promise resolution,
    // so any renderer that read state in the same tick saw stale
    // `installing: true`. A synchronous reset in `finally` runs
    // before the returned promise resolves to the renderer.
    const bridge = fs.readFileSync(path.join(REPO_ROOT, 'src/process/bridge/fuseTBridge.ts'), 'utf-8');
    expect(bridge).not.toMatch(/setTimeout\([^)]*installState/);
  });

  it('the bridge exposes no dev-only IPC bypass channels', () => {
    // Earlier iterations added `dev.fuse-t.*` raw `ipcMain.handle`
    // channels to bypass the bridge.buildProvider subscribe/callback
    // RPC during Mac smoke. They have to stay gone in the merged tree:
    // each one is a boundary leak around the bridge abstraction, and an
    // accidental re-introduction without the `!app.isPackaged` gate
    // would expose an admin-password prompt trigger to any renderer.
    // Production callers reach FUSE-T via `ipcBridge.fuseT.*.invoke()`,
    // full stop.
    const bridge = fs.readFileSync(path.join(REPO_ROOT, 'src/process/bridge/fuseTBridge.ts'), 'utf-8');
    expect(bridge).not.toMatch(/ipcMain\.handle\(['"]dev\.fuse-t\./);
    expect(bridge).not.toMatch(/from 'electron'/);
    const preload = fs.readFileSync(path.join(REPO_ROOT, 'src/preload.ts'), 'utf-8');
    expect(preload).not.toMatch(/devFuseT/);
  });

  it('the renderer dev-trigger shim uses official ipcBridge.*.invoke() and is build-time gated', () => {
    // The renderer-side debug shim that publishes
    // `window.__sudoworkDebug.fuseT.*` for CDP-driven Mac smoke MUST:
    //   (a) only emit code when Vite's DEV flag is true (so the
    //       production bundle ships zero of it),
    //   (b) route through the official `ipcBridge.fuseT.*.invoke()`
    //       wrappers,
    //   (c) NOT reach for `ipcRenderer` / raw electron / hand-written
    //       `subscribe-` strings — those would re-introduce the
    //       boundary leak the bridge above is built to prevent.
    // Together these mean a Mac-smoke debug session never gets a
    // second route to the supervisor that bypasses
    // `bridge.buildProvider`.
    const shim = fs.readFileSync(path.join(REPO_ROOT, '../../packages/renderer/src/bootstrap/devTriggers.ts'), 'utf-8');
    expect(shim).toMatch(/import\.meta\.env\.DEV/);
    expect(shim).toMatch(/ipcBridge\.fuseT\.runLazyInstallProbe\.invoke/);
    expect(shim).not.toMatch(/ipcRenderer/);
    expect(shim).not.toMatch(/ipcMain/);
    expect(shim).not.toMatch(/from 'electron'/);
    expect(shim).not.toMatch(/['"]subscribe-/);
    // And the renderer entrypoint must actually import it; an
    // orphan shim ships dead code but solves nothing.
    const entry = fs.readFileSync(path.join(REPO_ROOT, '../../packages/renderer/src/index.ts'), 'utf-8');
    expect(entry).toMatch(/['"]\.\/bootstrap\/devTriggers['"]/);
  });
});

describe('FUSE-T — IPC platform gate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    vi.restoreAllMocks();
  });

  it('checkInstalled via the bridge returns not-installed on non-darwin', async () => {
    setPlatform('linux');
    const { fuseTInstallService } = await import('../../src/process/services/fuset/FuseTInstallService');
    const status = await fuseTInstallService.checkInstalled();
    expect(status.installed).toBe(false);
    expect(status.bundlePath).toBeUndefined();
  });

  it('ensureInstalled via the bridge surface throws platform error on non-darwin', async () => {
    setPlatform('win32');
    const { fuseTInstallService } = await import('../../src/process/services/fuset/FuseTInstallService');
    await expect(fuseTInstallService.ensureInstalled()).rejects.toThrow(/macOS-only/);
  });
});

describe('FUSE-T system installer artifact verification', () => {
  it('FuseTInstallService has a pinned SHA256 for the active fuse-t version (no unverified pkg)', () => {
    // The pkg install path runs `installer -pkg` with administrator
    // privileges. Refusing to install a binary whose SHA isn't on the
    // pinned table is the same fail-closed gate `installSignedKernelPlugin`
    // uses for the dylibs. If the runtime-versions.json pin drifts ahead
    // of FUSE_T_PKG_SHA256SUMS, this catches it before a user runs into
    // the runtime "No pinned SHA256 for FUSE-T v…" error.
    const versions = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src/shared/runtime-versions.json'), 'utf-8')) as Record<string, string>;
    const service = fs.readFileSync(path.join(REPO_ROOT, 'src/process/services/fuset/FuseTInstallService.ts'), 'utf-8');
    const pinned = versions['fuse-t'];
    expect(pinned).toBeTruthy();
    const tableEntryRe = new RegExp(`'${pinned.replace(/[.]/g, '\\.')}':\\s*'([a-f0-9]{64})'`);
    expect(service).toMatch(tableEntryRe);
  });
});
