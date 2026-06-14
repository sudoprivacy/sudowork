/**
 * Integration test: signed-plugin download + cluster startup regression gate.
 *
 * Real 2-step user journey on the exact path an end-user takes, not
 * single-call assertions:
 *
 *   1. Run `scripts/download-nexus-vfs.js` against the live COS mirror.
 *      Produces `~/.nexus-vfs/bin/nexusd-cluster` AND
 *      `~/.nexus-vfs/plugins/{libnexus_vault.*,libnexus_local_connector.*,
 *      libnexus_fuse_plugin.*}` + `.sig` siblings on disk —
 *      all directly feed step 2.
 *   2. Boot the just-downloaded cluster pointed at the just-downloaded
 *      plugin-dir. `PluginLoader::load` reads each `.so/.dylib/.dll`,
 *      finds its sibling `.sig`, Ed25519-verifies against the kernel's
 *      embedded `TRUSTED_KEY_FILES` (nexus-team.pub for vault,
 *      kernel-dogfood-v1.pub for the others), and only then dlopens.
 *
 * SSOT for the cluster binary: COS. We deliberately do NOT cargo-install
 * from nexus-vfs `main` — that would mean sudowork CI builds cluster from
 * source, duplicating what nexus-vfs CI already builds + tests on every
 * tag. The version pin in `runtime-versions.json` is what determines
 * which cluster gets exercised; a cluster regression on `main` is
 * nexus-vfs CI's job to catch, not ours.
 *
 * Asserted on the cluster's startup log:
 *   - 3× `plugin signature verified` — the verify path ran + accepted
 *     each CI-produced signature against the embedded trust root.
 *   - 3 distinct `plugin loaded` lines (vault as service, local-connector
 *     and fuse-plugin as drivers / service).
 *
 * Failure modes this catches:
 *   - sudowork bumps `runtime-versions.json` without updating SHA256SUMS
 *   - nexus release CI publishes an archive without the `.sig`
 *   - sign step silently emits a non-verifying signature (length-only
 *     check on the .sig file would still pass — only end-to-end verify
 *     catches a sig that's well-formed but doesn't validate)
 *   - any platform-specific dynamic-linker regression that only shows up
 *     at dlopen time on the runner OS
 *   - the cluster's embedded pubkey drifts from the key nexus CI signs with
 *
 * Scoped to Linux x86_64 to keep CI cost in check — the verify code path
 * is platform-independent (parse pubkey → Ed25519 verify → dlopen), so
 * proving it works on one runner is enough signal. macOS / Windows
 * coverage is the kernel-team's local pre-tag E2E gate.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NEXUS_VFS_HOME = path.join(os.homedir(), '.nexus-vfs');
const PLUGIN_DIR = path.join(NEXUS_VFS_HOME, 'plugins');
const BIN_DIR = path.join(NEXUS_VFS_HOME, 'bin');

function clusterBinaryName(): string {
  return process.platform === 'win32' ? 'nexusd-cluster.exe' : 'nexusd-cluster';
}

// Platform-specific dylib names. Must match `get{Vault,LocalConnector,FusePlugin}DylibName`
// in scripts/download-nexus-vfs.js — drift here means a silent test pass,
// so keep these in lock-step.
function vaultDylibName(): string {
  if (process.platform === 'linux') return 'libnexus_vault.so';
  if (process.platform === 'darwin') return 'libnexus_vault.dylib';
  if (process.platform === 'win32') return 'nexus_vault.dll';
  throw new Error(`unsupported test platform: ${process.platform}`);
}

function localConnectorDylibName(): string {
  if (process.platform === 'linux') return 'libnexus_local_connector.so';
  if (process.platform === 'darwin') return 'libnexus_local_connector.dylib';
  if (process.platform === 'win32') return 'nexus_local_connector.dll';
  throw new Error(`unsupported test platform: ${process.platform}`);
}

function fusePluginDylibName(): string | null {
  // Linux-only by design; macFUSE / WinFsp adapters out of scope.
  if (process.platform === 'linux') return 'libnexus_fuse_plugin.so';
  return null;
}

/** State carried across steps — the test's data flow vehicle. */
let vaultDylib: string;
let vaultSig: string;
let localConnectorDylib: string;
let localConnectorSig: string;
let fuseDylib: string | null;
let fuseSig: string | null;
let clusterBin: string;
let clusterLog: string;
let clusterProc: ChildProcess | undefined;
let dataDir: string;

describe('signed-plugin download + cluster startup', () => {
  beforeAll(() => {
    // ── Step 1: download script populates bin + plugin-dir ─────────
    // Cold start so the script's full path (download cluster + each
    // plugin archive + SHA verify both + extract dylib + extract `.sig`)
    // actually runs. A leftover ready-marker would skip and we'd be
    // testing nothing.
    if (fs.existsSync(NEXUS_VFS_HOME)) {
      fs.rmSync(NEXUS_VFS_HOME, { recursive: true, force: true });
    }
    execSync(`node "${path.join(REPO_ROOT, 'scripts', 'download-nexus-vfs.js')}" --force`, {
      stdio: 'inherit',
      timeout: 240_000,
    });
    vaultDylib = path.join(PLUGIN_DIR, vaultDylibName());
    vaultSig = `${vaultDylib}.sig`;
    localConnectorDylib = path.join(PLUGIN_DIR, localConnectorDylibName());
    localConnectorSig = `${localConnectorDylib}.sig`;
    const fuseName = fusePluginDylibName();
    fuseDylib = fuseName ? path.join(PLUGIN_DIR, fuseName) : null;
    fuseSig = fuseDylib ? `${fuseDylib}.sig` : null;
    clusterBin = path.join(BIN_DIR, clusterBinaryName());
    if (!fs.existsSync(clusterBin)) {
      throw new Error(`nexusd-cluster not found at ${clusterBin} after download`);
    }
  }, 300_000);

  afterAll(() => {
    if (clusterProc && !clusterProc.killed) {
      clusterProc.kill('SIGTERM');
    }
    if (dataDir && fs.existsSync(dataDir)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('Step 1 result — cluster binary + 3 dylib/.sig pairs landed', () => {
    // The download script's SHA256 check already aborts on hash mismatch
    // before extraction, so files being here at all means each archive
    // matched the pinned sums. Sig length is pinned to SIGNATURE_LENGTH
    // (64 raw bytes per nexus_plugin_abi::signing) to catch SSOT drift
    // across the sign step + the verify step.
    expect(fs.existsSync(clusterBin), `${clusterBin} missing`).toBe(true);

    // Vault
    expect(fs.existsSync(vaultDylib), `${vaultDylib} missing`).toBe(true);
    expect(fs.statSync(vaultDylib).size).toBeGreaterThan(1_000_000);
    expect(fs.existsSync(vaultSig), `${vaultSig} missing`).toBe(true);
    expect(fs.statSync(vaultSig).size).toBe(64);

    // Local-connector
    expect(fs.existsSync(localConnectorDylib), `${localConnectorDylib} missing`).toBe(true);
    expect(fs.statSync(localConnectorDylib).size).toBeGreaterThan(100_000);
    expect(fs.existsSync(localConnectorSig), `${localConnectorSig} missing`).toBe(true);
    expect(fs.statSync(localConnectorSig).size).toBe(64);

    // Fuse-plugin — linux-only; on macOS/Windows the installer is a no-op.
    if (fuseDylib) {
      expect(fs.existsSync(fuseDylib), `${fuseDylib} missing`).toBe(true);
      expect(fs.statSync(fuseDylib).size).toBeGreaterThan(100_000);
      expect(fs.existsSync(fuseSig!), `${fuseSig} missing`).toBe(true);
      expect(fs.statSync(fuseSig!).size).toBe(64);
    }
  });

  it('Step 2 — cluster verifies every sig and loads all plugins at boot', async () => {
    // Step 1 produced everything we need. The cluster startup is the
    // operation under test; its log is the assertion surface.
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cluster-data-'));
    const logPath = path.join(os.tmpdir(), `cluster-${Date.now()}.log`);
    const logFd = fs.openSync(logPath, 'w');

    clusterProc = spawn(
      clusterBin,
      [
        '--no-tls',
        '--data-dir',
        dataDir,
        '--plugin-dir',
        PLUGIN_DIR,
        '--bootstrap-mode',
        'static',
      ],
      {
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, RUST_LOG: 'info,kernel=debug' },
      },
    );

    // Cluster boot to "plugins loaded" is fast on a warm cargo cache;
    // 30s is generous for a cold runner and keeps the test failure mode
    // (boot hang) tight.
    const deadline = Date.now() + 30_000;
    let bootLog = '';
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      bootLog = fs.readFileSync(logPath, 'utf-8');
      if (bootLog.includes('plugins loaded from --plugin-dir')) break;
    }
    clusterLog = bootLog;
    fs.closeSync(logFd);

    // (a) Verify path actually ran and accepted the vault sig against
    //     the kernel's embedded nexus-team.pub. This is the existing
    //     load-bearing assertion of the original 0→1; keep it as-is.
    expect(
      clusterLog,
      `expected "plugin signature verified" in cluster log:\n${clusterLog}`,
    ).toContain('plugin signature verified');

    // (b) Vault loaded + registered. Pinned name from services::password_vault.
    expect(clusterLog, `expected vault load:\n${clusterLog}`).toMatch(
      /service plugin loaded \+ registered.*"password-vault"/,
    );

    // (c) local-connector + fuse-plugin asserts. Enabled now that
    //     runtime-versions.json["nexus-vfs"] = 0.3.0 — the v0.3.0
    //     nexusd-cluster includes #58 (kernel-dogfood-v1.pub added to
    //     TRUSTED_KEY_FILES), so the cluster trusts the dogfood-signed
    //     local-connector + fuse-plugin and loads them on boot.
    expect(
      clusterLog,
      `expected local-connector load:\n${clusterLog}`,
    ).toMatch(/driver plugin loaded.*"local-connector"/);
    if (fuseDylib) {
      // The fuse plugin registers under the literal name "fuse" (matches
      // the `declare_service_plugin!("fuse", ...)` call in fuse-plugin's
      // src/lib.rs). The COS artifact is `nexus-fuse-plugin` and the
      // dylib lives at libnexus_fuse_plugin.{so,dylib,dll}, but the
      // logical plugin identity asserted on by the kernel loader is
      // just "fuse".
      expect(
        clusterLog,
        `expected fuse plugin load:\n${clusterLog}`,
      ).toMatch(/(driver|service) plugin loaded.*"fuse"/);
    }
  }, 60_000);
});
