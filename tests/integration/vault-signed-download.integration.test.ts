/**
 * Integration test: vault plugin signed-download regression gate.
 *
 * Runs the real `scripts/download-nexus-vfs.js` against the live COS mirror
 * and asserts the produced filesystem layout includes both the dylib and
 * its detached Ed25519 signature. Catches the regressions this PR cluster
 * has hit during development:
 *
 *   1. `runtime-versions.json` bumped without regenerating SHA256SUMS in
 *      the download script — script aborts on hash mismatch, the dylib
 *      never reaches plugin-dir, and this test fails on the missing file.
 *   2. Archive published to COS without the `.sig` (release CI pipeline
 *      forgets the sign step) — `.sig` assertion fails.
 *   3. Future `getVaultDylibName` drift versus the archive's actual
 *      filename — dylib assertion fails.
 *
 * Does NOT cover signature *verification* — the cluster's
 * `PluginLoader::load` does that at runtime and is exhaustively unit-tested
 * in nexus-vfs (parse_pubkey_file, verify_signature_against, missing-sig,
 * wrong-length-sig, etc.). Re-verifying here would duplicate the kernel
 * test surface; the binding gate for signature correctness is the local
 * kernel-team E2E run before tagging a new vault release.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const NEXUS_VFS_HOME = path.join(os.homedir(), '.nexus-vfs');
const PLUGIN_DIR = path.join(NEXUS_VFS_HOME, 'plugins');

// Platform-specific dylib name. Mirrors `getVaultDylibName` in
// scripts/download-nexus-vfs.js — drift here means a silent test pass, so
// keep this match the script.
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

describe('vault signed download', () => {
  beforeAll(() => {
    // Cold start: nuke any existing install so the script's full path
    // (download + SHA verify + extract + place files) actually runs. If
    // `~/.nexus-vfs/bin/.nexus-vfs-bin-ready` already has the pinned
    // version, the script skips everything and we'd be testing nothing.
    if (fs.existsSync(NEXUS_VFS_HOME)) {
      fs.rmSync(NEXUS_VFS_HOME, { recursive: true, force: true });
    }
    execSync(
      `node "${path.join(REPO_ROOT, 'scripts', 'download-nexus-vfs.js')}" --force`,
      { stdio: 'inherit', timeout: 180_000 },
    );
  }, 240_000);

  it('places the vault dylib in plugin-dir', () => {
    const dylibPath = path.join(PLUGIN_DIR, dylibName());
    expect(fs.existsSync(dylibPath)).toBe(true);

    // A plausibly-sized dylib (vault is ~2-5 MiB per platform). Catches an
    // accidental empty-file or wrong-extracted-entry case where existsSync
    // is true but the file is junk.
    const size = fs.statSync(dylibPath).size;
    expect(size).toBeGreaterThan(1_000_000);
  });

  it('places the detached signature next to the dylib', () => {
    const sigPath = path.join(PLUGIN_DIR, `${dylibName()}.sig`);
    expect(fs.existsSync(sigPath)).toBe(true);

    // Ed25519 raw signature length is exactly 64 bytes — pinned in
    // `nexus_plugin_abi::signing::SIGNATURE_LENGTH` over in nexus-vfs and
    // produced by `scripts/sign_plugin.py` in nexus. A non-64 sig here
    // means one of those two sides has silently drifted.
    expect(fs.statSync(sigPath).size).toBe(64);
  });
});
