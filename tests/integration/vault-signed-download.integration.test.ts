/**
 * Integration test: vault signed-download + cluster startup regression gate.
 *
 * Real 3-step user journey, not single-call assertions:
 *
 *   1. Run `scripts/download-nexus-vfs.js` against the live COS mirror.
 *      Produces `~/.nexus-vfs/plugins/{libnexus_vault.*,*.sig}` on disk —
 *      side effect feeds step 3.
 *   2. `cargo install` `nexusd-cluster` straight from nexus-vfs `main`.
 *      Need a cluster binary that includes the signature-verify code path
 *      (post #52) — the v0.2.0 binary already shipped via COS predates it
 *      and would happily load an unsigned dylib, giving us a false-green.
 *   3. Boot the freshly-built cluster pointed at the plugin-dir produced
 *      in step 1. The cluster reads each `.dylib`/`.so`/`.dll`, finds its
 *      sibling `.sig`, Ed25519-verifies against `trusted_keys/nexus-team.pub`
 *      embedded at compile time, and only then dlopens it.
 *
 * Asserted on the cluster's startup log:
 *   - `plugin signature verified` — the verify path actually ran and
 *     accepted the CI-produced signature against the embedded trust root.
 *   - `service plugin loaded + registered name="password-vault"` — the
 *     post-verify dlopen + service-registry handoff still works.
 *
 * Failure modes this catches that the file-layout-only version did not:
 *   - cluster binary build is broken on `main`
 *   - ABI version skew between cluster's `nexus-plugin-abi` and the dylib's
 *   - sign step in nexus CI silently produced a non-verifying signature
 *     (would never have been caught by length-only checks)
 *   - any platform-specific dynamic-linker regression that only shows up
 *     at dlopen time
 *
 * Scoped to Linux x86_64 to keep CI cost in check — the verify code path
 * is platform-independent (parse pubkey → Ed25519 verify → dlopen), so
 * proving it works on one runner is enough signal. macOS / Windows
 * coverage is the kernel-team's local E2E gate before tagging.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NEXUS_VFS_HOME = path.join(os.homedir(), '.nexus-vfs');
const PLUGIN_DIR = path.join(NEXUS_VFS_HOME, 'plugins');

// Platform-specific dylib name. Must match `getVaultDylibName` in
// scripts/download-nexus-vfs.js — drift here means a silent test pass, so
// keep this in lock-step.
function dylibName(): string {
  switch (process.platform) {
    case 'linux':
      return 'libnexus_vault.so';
    case 'darwin':
      return 'libnexus_vault.dylib';
    case 'win32':
      return 'nexus_vault.dll';
    default:
      throw new Error(`unsupported test platform: ${process.platform}`);
  }
}

/** State carried across steps — the test's data flow vehicle. */
let dylibPath: string;
let sigPath: string;
let clusterBin: string;
let clusterLog: string;
let clusterProc: ChildProcess | undefined;
let dataDir: string;

describe('vault signed-download + cluster startup', () => {
  beforeAll(() => {
    // ── Step 1: download script populates plugin-dir ───────────────
    // Cold start so the script's full path (download + SHA verify +
    // extract + place files) actually runs. A leftover ready-marker
    // would skip everything and we'd be testing nothing.
    if (fs.existsSync(NEXUS_VFS_HOME)) {
      fs.rmSync(NEXUS_VFS_HOME, { recursive: true, force: true });
    }
    execSync(
      `node "${path.join(REPO_ROOT, 'scripts', 'download-nexus-vfs.js')}" --force`,
      { stdio: 'inherit', timeout: 180_000 },
    );
    dylibPath = path.join(PLUGIN_DIR, dylibName());
    sigPath = path.join(PLUGIN_DIR, `${dylibName()}.sig`);

    // ── Step 2: cargo-install a cluster with the verify code ───────
    // The downloaded v0.2.0 cluster predates signature verification —
    // using it here would silently load an unsigned dylib and the test
    // would falsely pass. cargo-install from nexus-vfs `main` always
    // includes the verify path that we are gating on.
    const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
    execSync(
      `cargo install --quiet --git https://github.com/nexi-lab/nexus-vfs --bin nexusd-cluster nexus-cluster`,
      { stdio: 'inherit', timeout: 900_000 },
    );
    clusterBin = path.join(cargoBin, 'nexusd-cluster');
    if (!fs.existsSync(clusterBin)) {
      throw new Error(`nexusd-cluster not found at ${clusterBin} after cargo install`);
    }
  }, 1_200_000);

  afterAll(() => {
    if (clusterProc && !clusterProc.killed) {
      clusterProc.kill('SIGTERM');
    }
    if (dataDir && fs.existsSync(dataDir)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('Step 1 result — dylib + 64-byte sig landed in plugin-dir', () => {
    // The download script's SHA256 check already aborts on hash mismatch
    // before extraction, so files being here at all means the archive
    // matched the pinned sums. We additionally pin the sig length to
    // SIGNATURE_LENGTH (64) — pinned in `nexus_plugin_abi::signing` — to
    // catch SSOT drift across the sign step + the verify step.
    expect(fs.existsSync(dylibPath), `${dylibPath} missing`).toBe(true);
    expect(fs.statSync(dylibPath).size).toBeGreaterThan(1_000_000);

    expect(fs.existsSync(sigPath), `${sigPath} missing`).toBe(true);
    expect(fs.statSync(sigPath).size).toBe(64);
  });

  it('Step 3 — cluster verifies the sig and loads the plugin at boot', async () => {
    // Step 1's files + step 2's verify-enabled binary are the inputs.
    // The cluster startup is the operation under test; its log is the
    // assertion surface.
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

    // (a) Verify path actually ran and accepted the CI-produced sig
    //     against the kernel's embedded trusted_keys/nexus-team.pub.
    //     This is the load-bearing assertion of the entire 0→1 — if it
    //     passes, the sign side (nexus CI) and the verify side
    //     (nexus-vfs kernel) agree on the format AND on the trust root.
    expect(
      clusterLog,
      `expected "plugin signature verified" in cluster log:\n${clusterLog}`,
    ).toContain('plugin signature verified');

    // (b) Post-verify, the dlopen + ServiceRegistry handoff completed.
    //     Plugin name is the literal string nexus_vault.dll/dylib/so
    //     reports via `nexus_plugin_name` — pinned in services::password_vault.
    expect(
      clusterLog,
      `expected vault service registration in cluster log:\n${clusterLog}`,
    ).toMatch(/service plugin loaded \+ registered.*"password-vault"/);
  }, 60_000);
});
