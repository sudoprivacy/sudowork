/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * FFmpeg Runtime Service
 *
 * Provisions an ffmpeg/ffprobe binary for skills that shell out to `ffmpeg`
 * (e.g. the FFmpeg Video Editor skill, which burns subtitles via
 * `ffmpeg -vf subtitles=...`).
 *
 * ffmpeg is NOT bundled in the installer (few users need it — provisioning is
 * skill-gated). Instead it is downloaded ON DEMAND from the sudowork runtime
 * COS mirror (Beijing — reachable in China, unlike the BtbN/GitHub source that
 * half-completes on China networks and yields the "spawn UNKNOWN" symptom) the
 * first time an ffmpeg-needing skill is installed/enabled. The exact build +
 * per-platform SHA256 are pinned in `src/shared/ffmpeg-runtime.json`; the
 * download is verified against that SHA before it is trusted. Mirror the pinned
 * build to COS with `.github/workflows/mirror-ffmpeg-to-cos.yml`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { getDataPath } from '@process/utils';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import ffmpegRuntime from '@/shared/ffmpeg-runtime.json';
import { extractTarGzWithProgress, type ArchiveProgressCallback } from '../archiveProgress';
import { downloadArchive } from './downloadArchive';

/** Directory the downloaded FFmpeg is extracted into. */
const getFfmpegDir = (): string => path.join(getDataPath(), 'ffmpeg');

const binaryName = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

/** `<os>-<arch>` key, matching the pin in ffmpeg-runtime.json. */
const platformKey = (): string => `${process.platform}-${process.arch}`;

/** Absolute path to the provisioned `ffmpeg` binary for the current platform. */
export function getFfmpegBinaryPath(): string {
  return path.join(getFfmpegDir(), binaryName('ffmpeg'));
}

/** Absolute path to the provisioned `ffprobe` binary (present when the build shipped it). */
export function getFfprobeBinaryPath(): string {
  return path.join(getFfmpegDir(), binaryName('ffprobe'));
}

/**
 * The directory to prepend to a child process's PATH so bare `ffmpeg` /
 * `ffprobe` invocations resolve to the provisioned binaries. Returns null when
 * ffmpeg has not been provisioned (the common case — most users never install
 * an ffmpeg-needing skill), so PATH injection self-disables.
 */
export function getFfmpegBinDir(): string | null {
  // Best-effort: this runs while building the ACP spawn env, which may execute
  // in contexts where the userData path can't be resolved (e.g. tests). Never
  // throw — just skip the ffmpeg PATH injection when it can't be determined.
  try {
    return isFfmpegInstalled() ? getFfmpegDir() : null;
  } catch {
    return null;
  }
}

/** Whether ffmpeg has already been downloaded + extracted. */
export function isFfmpegInstalled(): boolean {
  return fs.existsSync(getFfmpegBinaryPath());
}

function pinnedSha256(key: string): string | undefined {
  const sha = (ffmpegRuntime.cos?.sha256 as Record<string, string> | undefined)?.[key];
  return sha || undefined;
}

/** COS URL for the pinned flat tar.gz of `key`, or null if unpinned (e.g. macOS). */
function cosArchiveUrl(key: string): string | null {
  const baseUrl = ffmpegRuntime.cos?.baseUrl;
  if (!baseUrl || !pinnedSha256(key)) return null;
  return `${baseUrl}/ffmpeg/${ffmpegRuntime.tag}/ffmpeg-${key}.tar.gz`;
}

function sha256OfFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Download + install ffmpeg from the runtime COS mirror. Verifies the download
 * against the pinned SHA256 before extracting. No-op (returns true) if already
 * installed; returns false (never throws) on any failure so callers can treat
 * provisioning as best-effort.
 */
export async function installFfmpeg(onProgress?: ArchiveProgressCallback): Promise<boolean> {
  if (isFfmpegInstalled()) {
    mainLog('FfmpegRuntime', 'FFmpeg already installed at:', getFfmpegBinaryPath());
    return true;
  }

  const key = platformKey();
  const url = cosArchiveUrl(key);
  const expectedSha = pinnedSha256(key);
  if (!url || !expectedSha) {
    // No source pinned for this platform (e.g. macOS — pending evermeet/osxexperts).
    mainWarn('FfmpegRuntime', `No FFmpeg source pinned for '${key}'; skills needing ffmpeg will not work`);
    return false;
  }

  const ffmpegDir = getFfmpegDir();
  const ffmpegPath = getFfmpegBinaryPath();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-dl-'));
  const archivePath = path.join(tmp, `ffmpeg-${key}.tar.gz`);

  try {
    mainLog('FfmpegRuntime', `Downloading FFmpeg from ${url}`);
    await downloadArchive(url, archivePath, onProgress);

    const actualSha = sha256OfFile(archivePath);
    if (actualSha !== expectedSha) {
      throw new Error(`SHA256 mismatch for ffmpeg-${key}.tar.gz: expected ${expectedSha}, got ${actualSha}`);
    }

    fs.mkdirSync(ffmpegDir, { recursive: true });
    await extractTarGzWithProgress(archivePath, ffmpegDir, onProgress);

    if (!fs.existsSync(ffmpegPath)) {
      throw new Error(`FFmpeg binary not found at ${ffmpegPath} after extracting the download`);
    }
    if (process.platform !== 'win32') {
      fs.chmodSync(ffmpegPath, 0o755);
      const ffprobePath = getFfprobeBinaryPath();
      if (fs.existsSync(ffprobePath)) fs.chmodSync(ffprobePath, 0o755);
    }

    mainLog('FfmpegRuntime', 'FFmpeg installed successfully at', ffmpegPath);
    return true;
  } catch (err) {
    mainError('FfmpegRuntime', 'FFmpeg installation failed:', err);
    return false;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Ensure ffmpeg is provisioned (download if not). Call this when a skill that
 * needs ffmpeg is installed/enabled — NOT unconditionally at boot.
 */
export async function ensureFfmpegInstalled(onProgress?: ArchiveProgressCallback): Promise<boolean> {
  if (isFfmpegInstalled()) return true;
  return installFfmpeg(onProgress);
}
