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
 * Canonical filesystem-bundle install location, written by the upstream pkg.
 * Presence here is the authoritative "FUSE-T is installed" signal — if the
 * user manually removes the bundle the install state resets.
 */
const FUSE_T_BUNDLE_PATH = '/Library/Filesystems/fuse-t.fs';

const FUSE_T_VERSION = (runtimeVersions as Record<string, string>)['fuse-t'];

/**
 * Download mirrors for the FUSE-T pkg, tried in order. The COS mirror is
 * primary (consistent with the existing node / scode / nexus / vault mirror
 * pattern, and avoids GitHub release rate-limits from inside GFW); the
 * upstream GitHub release is the fallback so the install still works
 * before the COS mirror is populated and on dev machines outside GFW.
 */
function getDownloadUrls(): string[] {
  // Filename convention is upstream's `fuse-t-macos-installer-<version>.pkg`
  // (verified empirically against
  // https://github.com/macos-fuse-t/fuse-t/releases/download/1.2.7/fuse-t-macos-installer-1.2.7.pkg
  // during the Mac smoke checklist on #915). The COS mirrors mirror this
  // exact filename — repointing the kernel team at a renamed artifact would
  // silently regress installs as users move between mirrors.
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
    const bundleExists = await fileExists(FUSE_T_BUNDLE_PATH);
    if (!bundleExists) {
      return { installed: false };
    }
    return {
      installed: true,
      bundlePath: FUSE_T_BUNDLE_PATH,
      version: FUSE_T_VERSION,
    };
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

    const pkgPath = this.getCachedPkgPath();
    fs.mkdirSync(path.dirname(pkgPath), { recursive: true });

    try {
      if (fs.existsSync(pkgPath) && fs.statSync(pkgPath).size > 0) {
        onProgress?.('downloading', 100);
      } else {
        await this.downloadWithFallback(getDownloadUrls(), pkgPath, (percent) => {
          onProgress?.('downloading', percent);
        });
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
      throw new Error(`FUSE-T install completed but ${FUSE_T_BUNDLE_PATH} is missing — installer may have failed silently`);
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

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p, fs.constants.F_OK);
    return true;
  } catch {
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
