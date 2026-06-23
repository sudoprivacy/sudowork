/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * FUSE-T installer service (macOS only)
 *
 * Provisions the FUSE-T userspace driver (https://github.com/macos-fuse-t/fuse-t)
 * required by `nexus-fuse-plugin` on macOS. FUSE-T runs the FUSE protocol over
 * macOS's built-in NFS client (no kext, no reboot, no System Settings approval
 * flow) and exposes the libfuse3 ABI the `fuser` Rust crate already consumes,
 * so the kernel-side plugin source body is unchanged.
 *
 * Why this is a separate service from the eager downloader in
 * `scripts/download-nexus-vfs.js`:
 *
 *   - The eager downloader only copies files (signed dylibs) into
 *     `~/.nexus-vfs/plugins/`. Zero UAC; safe for every Mac user on cold start.
 *
 *   - FUSE-T itself ships as a system `.pkg` and the install requires
 *     `osascript -e 'do shell script "installer -pkg ... -target /"
 *     with administrator privileges'` — i.e. an admin password prompt.
 *     Running that on every cold start would prompt every Mac user
 *     even if they never trigger a FUSE mount, which violates the
 *     "non-opt-in users see no UX change" contract.
 *
 * So this service is **explicitly lazy**: NOT wired into
 * `RuntimeInstaller.ensureAll()`. Callers (the mount entry point in
 * sudocode / nexusd-cluster, or a future renderer "enable cross-machine
 * mount" UI) invoke `ensureInstalled()` themselves right before requesting
 * a FUSE mount. First mount → one admin password prompt → cached.
 * Subsequent mounts → no prompt.
 *
 * Decision artifacts:
 *   - nexi-lab/nexus PR #4409 — FUSE-T over macFUSE rationale
 *     (GPL/kext/reboot tradeoff, NFS attr cache caveat for mtime/size).
 *   - nexi-lab/nexus
 *     `docs/superpowers/specs/2026-06-23-local-plugin-signing-dev-root.md`
 *     — local trust-root signing recipe used until the kernel release
 *     pipeline emits signed macOS dylibs.
 *   - nexi-lab/nexus
 *     `docs/superpowers/specs/2026-06-13-sealed-keystore-dogfood-design.md`
 *     — sealed-keystore dogfood follow-up tracking the missing
 *     `dogfood_keystore_fetch.py` rehydrate path that's blocking the
 *     upstream signed-release pipeline.
 *   - Sudowork issue #915 — this work.
 */

import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

import { mainLog, mainWarn } from '@process/utils/mainLogger';
import runtimeVersions from '@/shared/runtime-versions.json';

const execFileAsync = promisify(execFile);

const TAG = 'FuseTInstallService';

/**
 * FUSE-T install markers, probed in order. The driver moved layouts
 * between major versions:
 *
 *   - FUSE-T 1.2.x ships an FSKit framework at
 *     `/Library/Frameworks/fuse_t.framework` (Apple's kext-free FSKit
 *     replacement; 1.2 is the first release that uses it).
 *   - FUSE-T 1.0 / 1.1 used the older `/Library/Filesystems/fuse-t.fs`
 *     filesystem bundle.
 *
 * Probe both so detection works across a user-driven upgrade or a
 * dev machine that hasn't migrated yet. A hit on either path means
 * FUSE-T is present and the lazy installer should treat
 * `ensureInstalled()` as a no-op.
 */
const FUSE_T_BUNDLE_CANDIDATES = [
  '/Library/Frameworks/fuse_t.framework', // FUSE-T 1.2+ (FSKit)
  '/Library/Filesystems/fuse-t.fs', // FUSE-T 1.0 / 1.1 (legacy bundle)
];

/**
 * pkgutil registry probe. Falls through to here if neither bundle
 * candidate matches — handles future layout changes by asking macOS's
 * installer registry directly instead of pinning to a path. Matches
 * any pkg id under the `org.fuse-t.` namespace so versioned suffixes
 * (`org.fuse-t.fskit.1.2.7`, `org.fuse-t.core.1.2.7`, ...) all count.
 */
const FUSE_T_PKGUTIL_REGEX = '^org\\.fuse-t\\.';

const FUSE_T_VERSION = (runtimeVersions as Record<string, string>)['fuse-t'];

/**
 * Pinned SHA256 sums for each FUSE-T pkg version we will install.
 *
 * The other installers in this codebase (vault, local-connector,
 * nexus-fuse-plugin) refuse to run an extracted dylib whose archive
 * SHA wasn't listed against a pinned table. The FUSE-T pkg deserves
 * the same gate — we're about to hand `installer -pkg` administrator
 * privileges, so the bytes had better match what we audited at PR
 * time.
 *
 * To bump:
 *   1. `gh release view <ver> --repo macos-fuse-t/fuse-t` to confirm
 *      the new release exists.
 *   2. `curl -sL <pkg-url> -o /tmp/fuse-t.pkg && sha256sum /tmp/fuse-t.pkg`.
 *   3. Update `runtime-versions.json` + add the new entry here.
 */
const FUSE_T_PKG_SHA256SUMS: Record<string, string> = {
  '1.2.7': '6a29c747e61a86a405a189efc3de42812d73147135f93a1bb0624c1e7b90e654',
};

/**
 * Download mirrors for the FUSE-T pkg, tried in order. The COS mirror is
 * primary (consistent with the existing node / scode / nexus / vault mirror
 * pattern, and avoids GitHub release rate-limits from inside GFW); the
 * upstream GitHub release is the fallback so the install still works
 * before the COS mirror is populated and on dev machines outside GFW.
 *
 * Filename convention is upstream's `fuse-t-macos-installer-<version>.pkg`,
 * verified empirically against
 * https://github.com/macos-fuse-t/fuse-t/releases/download/1.2.7/fuse-t-macos-installer-1.2.7.pkg.
 * The COS mirrors must serve the same filename so users moving between
 * mirrors don't see different artifacts.
 */
function getDownloadUrls(): string[] {
  const pkgName = `fuse-t-macos-installer-${FUSE_T_VERSION}.pkg`;
  return [`https://sudowork-runtime-1309794936.cos.ap-beijing.myqcloud.com/fuse-t/release/v${FUSE_T_VERSION}/${pkgName}`, `https://sudoclaw-download-1309794936.cos.ap-beijing.myqcloud.com/fuse-t/release/v${FUSE_T_VERSION}/${pkgName}`, `https://github.com/macos-fuse-t/fuse-t/releases/download/${FUSE_T_VERSION}/${pkgName}`];
}

export type FuseTInstallPhase = 'downloading' | 'installing' | 'cleanup';
export type FuseTProgressCallback = (phase: FuseTInstallPhase, percent?: number) => void;

export interface FuseTStatus {
  installed: boolean;
  version?: string;
  bundlePath?: string;
}

export class FuseTInstallService {
  /**
   * Returns whether FUSE-T is currently provisioned on this host.
   * macOS-only; non-macOS platforms always report not installed
   * (and `install()` refuses to run).
   */
  async checkInstalled(): Promise<FuseTStatus> {
    if (process.platform !== 'darwin') {
      return { installed: false };
    }
    // Fast path: probe both known install layouts. No subprocess, just
    // an fs.access per candidate; the loop short-circuits on the first
    // match. Covers the FSKit (1.2+) and legacy filesystem-bundle (1.0
    // / 1.1) cases.
    for (const candidate of FUSE_T_BUNDLE_CANDIDATES) {
      if (await fileExists(candidate)) {
        return { installed: true, bundlePath: candidate, version: FUSE_T_VERSION };
      }
    }
    // Slow path: pkgutil registry. Only runs when neither known layout
    // is on disk — keeps the common case (installed at a known path)
    // off the subprocess hot path while still catching a future FUSE-T
    // release that ships at yet another layout.
    if (await pkgUtilHasFuseT()) {
      return { installed: true, bundlePath: 'pkgutil:org.fuse-t.*', version: FUSE_T_VERSION };
    }
    mainWarn(TAG, `checkInstalled: all probes miss. platform=${process.platform} candidates=[${FUSE_T_BUNDLE_CANDIDATES.join(', ')}] pkgutilRegex=${FUSE_T_PKGUTIL_REGEX}`);
    return { installed: false };
  }

  /**
   * Cache path for the downloaded pkg under `~/.nexus-vfs/downloads/`.
   * Re-uses the same staging dir as the rest of the nexus-vfs installer so
   * housekeeping (e.g. clearing the runtime cache during a re-install) stays
   * in one place.
   */
  private getCachedPkgPath(): string {
    return path.join(os.homedir(), '.nexus-vfs', 'downloads', `fuse-t-${FUSE_T_VERSION}.pkg`);
  }

  /**
   * Install FUSE-T. Idempotent: returns immediately if already provisioned.
   * Prompts for the admin password via `osascript`.
   */
  async ensureInstalled(onProgress?: FuseTProgressCallback): Promise<void> {
    if (process.platform !== 'darwin') {
      throw new Error('FUSE-T is macOS-only; nothing to install on this platform');
    }
    const status = await this.checkInstalled();
    if (status.installed) {
      mainLog(TAG, `FUSE-T already installed at ${status.bundlePath}`);
      return;
    }
    await this.install(onProgress);
  }

  /**
   * Force-install path. Most callers want `ensureInstalled` instead — this
   * variant always downloads + runs the pkg installer regardless of current
   * state. Exposed for explicit re-install flows.
   */
  async install(onProgress?: FuseTProgressCallback): Promise<void> {
    if (process.platform !== 'darwin') {
      throw new Error('FUSE-T is macOS-only; cannot install on this platform');
    }

    const expectedSha = FUSE_T_PKG_SHA256SUMS[FUSE_T_VERSION];
    if (!expectedSha) {
      // Refuse to ship an unverified binary up to `installer -pkg` with
      // administrator privileges. Mirrors the fail-closed gate the
      // `installSignedKernelPlugin` path uses for the dylibs — the
      // FUSE-T pkg deserves at least the same audit floor.
      throw new Error(`No pinned SHA256 for FUSE-T v${FUSE_T_VERSION}; refusing to install an unverified pkg. Bump runtime-versions.json + add the matching entry to FUSE_T_PKG_SHA256SUMS.`);
    }

    const pkgPath = this.getCachedPkgPath();
    fs.mkdirSync(path.dirname(pkgPath), { recursive: true });

    try {
      if (fs.existsSync(pkgPath) && fs.statSync(pkgPath).size > 0 && sha256OfFile(pkgPath) === expectedSha) {
        onProgress?.('downloading', 100);
      } else {
        await this.downloadWithFallback(getDownloadUrls(), pkgPath, (percent) => {
          onProgress?.('downloading', percent);
        });
        const actualSha = sha256OfFile(pkgPath);
        if (actualSha !== expectedSha) {
          // Drop the bad pkg before throwing so a retry hits the
          // download path (a re-pull from a different mirror might
          // succeed if the mismatch was a corrupted byte stream).
          try {
            fs.rmSync(pkgPath);
          } catch {
            /* ignore */
          }
          throw new Error(`FUSE-T pkg SHA256 mismatch for v${FUSE_T_VERSION}: expected ${expectedSha}, got ${actualSha}`);
        }
      }

      onProgress?.('installing');
      // Mirrors PythonRuntimeService.installMac (line 276): osascript
      // wraps the privileged installer call so macOS surfaces a single
      // password prompt instead of failing silently. Escaping the path's
      // single quotes is required because osascript double-evaluates the
      // string (AppleScript layer + shell layer).
      const escapedPkgPath = pkgPath.replace(/'/g, "'\\''");
      const script = `do shell script "installer -pkg '${escapedPkgPath}' -target /" with administrator privileges`;
      await execFileAsync('osascript', ['-e', script]);
    } catch (err) {
      try {
        if (fs.existsSync(pkgPath)) fs.rmSync(pkgPath);
      } catch {
        /* leaving a corrupt pkg behind is worse than ignoring the cleanup failure */
      }
      throw err;
    } finally {
      onProgress?.('cleanup');
    }

    const verified = await this.checkInstalled();
    if (!verified.installed) {
      throw new Error(`FUSE-T install completed but no marker found at any of ${FUSE_T_BUNDLE_CANDIDATES.join(', ')} and pkgutil shows no org.fuse-t.* package — installer may have failed silently`);
    }
    mainLog(TAG, `FUSE-T installed: ${verified.bundlePath} (v${FUSE_T_VERSION})`);
  }

  /**
   * Stream the pkg from the first mirror that answers; fall through to the
   * next URL on network failure or 404. Mirrors the pattern used by the
   * other runtime installers (Python, Node, nexus-vfs).
   */
  private async downloadWithFallback(urls: string[], destPath: string, onPercent: (percent: number) => void): Promise<void> {
    let lastErr: unknown = null;
    for (const url of urls) {
      try {
        mainLog(TAG, `Downloading FUSE-T pkg from ${url}`);
        await downloadFile(url, destPath, onPercent);
        return;
      } catch (err) {
        lastErr = err;
        mainWarn(TAG, `FUSE-T download failed from ${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(`Failed to download FUSE-T pkg from all ${urls.length} mirrors. Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }
}

function sha256OfFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p, fs.constants.F_OK);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // ENOENT is the expected "path absent" signal — keep it quiet.
    // Anything else (EACCES from TCC / sandbox, ELOOP from a broken
    // symlink, etc.) silently dropped a true install on Mac dev's
    // smoke (#915) — log so the next failure surfaces the actual
    // errno instead of looking like a clean "not installed".
    if (code && code !== 'ENOENT') {
      mainWarn(TAG, `fs.access(${p}) failed: ${code} — ${err instanceof Error ? err.message : String(err)}`);
    }
    return false;
  }
}

/**
 * Query macOS's pkgutil registry for any package id under `org.fuse-t.*`.
 * Used as the slow-path fallback when neither `FUSE_T_BUNDLE_CANDIDATES`
 * entry is present on disk — covers any future FUSE-T layout shift,
 * since pkgutil records every receipt the system `installer` writes.
 */
async function pkgUtilHasFuseT(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('pkgutil', ['--pkgs', '--regexp', FUSE_T_PKGUTIL_REGEX]);
    return stdout.trim().length > 0;
  } catch (err) {
    // Non-zero exit (no matches) or missing pkgutil — treat as "not
    // installed" rather than failing the check. The disk-path probe
    // already covers the common case. Log the actual reason though,
    // since silently dropping a real install path tripped #915 once.
    mainWarn(TAG, `pkgutil --pkgs --regexp ${FUSE_T_PKGUTIL_REGEX} failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Plain https/http download with redirect following + progress reporting.
 * Kept local to this module so the FUSE-T installer has no implicit
 * dependency on other runtime installers' internals.
 */
function downloadFile(url: string, dest: string, onPercent: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let redirects = 0;

    const request = (urlStr: string): void => {
      if (redirects++ > 10) {
        reject(new Error('Too many redirects'));
        return;
      }
      const lib = urlStr.startsWith('https:') ? https : http;
      lib
        .get(urlStr, (response) => {
          const code = response.statusCode ?? 0;
          if ((code === 301 || code === 302 || code === 307 || code === 308) && response.headers.location) {
            response.resume();
            request(response.headers.location);
            return;
          }
          if (code === 404) {
            response.resume();
            reject(new Error('NOT_FOUND'));
            return;
          }
          if (code !== 200) {
            response.resume();
            reject(new Error(`HTTP ${code}`));
            return;
          }
          const total = parseInt(response.headers['content-length'] ?? '0', 10);
          let downloaded = 0;
          response.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            if (total > 0) onPercent(Math.floor((downloaded / total) * 100));
          });
          response.pipe(file);
          file.on('finish', () => {
            file.close((err) => (err ? reject(err) : resolve()));
          });
        })
        .on('error', (err) => {
          file.close(() => fs.unlink(dest, () => reject(err)));
        });
    };
    request(url);
  });
}

export const fuseTInstallService = new FuseTInstallService();
