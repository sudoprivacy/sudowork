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
    // The bridge registers IPC providers + dev-only direct handles — but
    // nothing inside `initFuseTBridge()` should call `ensureInstalled()`
    // eagerly. The handlers only fire when a renderer / worker explicitly
    // invokes the channel. Read the bridge source and assert no top-level
    // call to ensureInstalled.
    const bridge = fs.readFileSync(path.join(REPO_ROOT, 'src/process/bridge/fuseTBridge.ts'), 'utf-8');
    // Strip the two legitimate handler-body shapes (the bridge's
    // provider(async ...) blocks and the dev-only ipcMain.handle(...,
    // async ...) blocks). Any remaining occurrence of `ensureInstalled`
    // or `install(` would be an eager call at init time — the regression
    // we care about.
    const stripped = bridge.replace(/provider\(async[\s\S]*?\}\);/g, '/* provider-body */').replace(/ipcMain\.handle\([^,]+,\s*async[\s\S]*?\}\);/g, '/* dev-handle-body */');
    expect(stripped).not.toMatch(/fuseTInstallService\.ensureInstalled|fuseTInstallService\.install\(/);
  });

  it('dev-only direct IPC handles are gated behind !app.isPackaged', () => {
    // The dev smoke channels (`dev.fuse-t.check-installed` /
    // `dev.fuse-t.ensure-installed`) bypass the bridge.buildProvider
    // subscribe/callback wrapping so a Mac smoke tester can drive the
    // lazy install from the DevTools console. They must NEVER register
    // in packaged builds — that would expose an admin-password prompt
    // trigger to any renderer code.
    const bridge = fs.readFileSync(path.join(REPO_ROOT, 'src/process/bridge/fuseTBridge.ts'), 'utf-8');
    expect(bridge).toMatch(/if \(!app\.isPackaged\)[\s\S]*?ipcMain\.handle\('dev\.fuse-t\.ensure-installed'/);
    expect(bridge).toMatch(/if \(!app\.isPackaged\)[\s\S]*?ipcMain\.handle\('dev\.fuse-t\.check-installed'/);
    expect(bridge).toMatch(/if \(!app\.isPackaged\)[\s\S]*?ipcMain\.handle\('dev\.fuse-t\.probe'/);
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

describe('FUSE-T — eager dylib dispatch in download-nexus-vfs.js', () => {
  // Static-string assertions on the dispatch tables. We grep the JS
  // source rather than importing the script (running it would actually
  // hit the network); the strings are what the kernel team's release
  // pipeline matches against, so any rename here is the regression we
  // want to surface.
  const script = fs.readFileSync(path.join(REPO_ROOT, 'scripts/download-nexus-vfs.js'), 'utf-8');

  it('macOS arm64 + x86_64 fuse-plugin artifact names are exposed', () => {
    expect(script).toContain("'nexus-fuse-plugin-macos-arm64.tar.gz'");
    expect(script).toContain("'nexus-fuse-plugin-macos-x86_64.tar.gz'");
  });

  it('libnexus_fuse_plugin.dylib is wired for darwin', () => {
    expect(script).toContain("'libnexus_fuse_plugin.dylib'");
  });

  it('macOS + Linux fuse-plugin SHA256 sums are filled with 64-hex hashes', () => {
    // Earlier in PR #916 these landed commented-out (fail-closed pending the
    // first cross-platform fuse-vX.Y.Z release). v0.2.0 shipped all three
    // archives, so the verifier now has real sums for every platform we
    // dispatch to. Assert each line is a 64-char hex string — a regression
    // like a placeholder or a truncated copy/paste would otherwise let an
    // unverified dylib pass when CI doesn't actually exercise the macOS
    // download path on Linux runners.
    const expectHexLine = (artifact: string): void => {
      const re = new RegExp(`'${artifact.replace(/[.]/g, '\\.')}':\\s*'([a-f0-9]{64})'`);
      expect(script).toMatch(re);
    };
    expectHexLine('nexus-fuse-plugin-linux-x86_64.tar.gz');
    expectHexLine('nexus-fuse-plugin-macos-arm64.tar.gz');
    expectHexLine('nexus-fuse-plugin-macos-x86_64.tar.gz');
  });

  it('fuse-t + nexus-fuse-plugin version pins live in runtime-versions.json (single source of truth)', () => {
    const versions = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src/shared/runtime-versions.json'), 'utf-8')) as Record<string, string>;
    expect(versions['fuse-t']).toMatch(/^\d+\.\d+\.\d+$/);
    // nexus-fuse-plugin must stay at or above v0.2.0 — that's the first
    // release that ships macOS arm64 + x86_64 dylibs. A regression to
    // 0.1.x would drop the macOS archives the dispatch in
    // download-nexus-vfs.js now references, breaking macOS installs.
    expect(versions['nexus-fuse-plugin']).toMatch(/^0\.(?:[2-9]|\d{2,})\.\d+$/);
  });
});
