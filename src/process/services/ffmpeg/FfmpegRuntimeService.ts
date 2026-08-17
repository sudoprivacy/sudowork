/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * FFmpeg Runtime Service
 *
 * Extracts and manages a bundled FFmpeg binary so skills that shell out to
 * `ffmpeg` (e.g. the FFmpeg Video Editor skill, which burns subtitles via
 * `ffmpeg -vf subtitles=...`) work out of the box — no user install, no
 * runtime CDN download that half-completes on China networks and yields a
 * non-launchable binary (the "spawn UNKNOWN" teardown symptom).
 *
 * FFmpeg is bundled at build time via `bun run ffmpeg:download`, mirroring
 * how Node.js is provisioned by NodeRuntimeService. The bundled per-platform
 * archive is normalized at build time to contain just the flat `ffmpeg`
 * (+ `ffprobe`) binaries, so extraction here is layout-agnostic.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getDataPath } from '@process/utils';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';
import { extractTarGzWithProgress, type ArchiveProgressCallback } from '../archiveProgress';

/** Directory the bundled FFmpeg is extracted into. */
const getFfmpegDir = (): string => path.join(getDataPath(), 'ffmpeg');

const binaryName = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

/** Absolute path to the bundled `ffmpeg` binary for the current platform. */
export function getFfmpegBinaryPath(): string {
  return path.join(getFfmpegDir(), binaryName('ffmpeg'));
}

/** Absolute path to the bundled `ffprobe` binary (present when the build shipped it). */
export function getFfprobeBinaryPath(): string {
  return path.join(getFfmpegDir(), binaryName('ffprobe'));
}

/**
 * The directory to prepend to a child process's PATH so bare `ffmpeg` /
 * `ffprobe` invocations resolve to the bundled binaries.
 */
export function getFfmpegBinDir(): string | null {
  return isFfmpegInstalled() ? getFfmpegDir() : null;
}

/** Whether the bundled FFmpeg has already been extracted. */
export function isFfmpegInstalled(): boolean {
  return fs.existsSync(getFfmpegBinaryPath());
}

/**
 * Locate the packaged per-platform archive produced by
 * `scripts/download-ffmpeg.js` (`resources/ffmpeg-<platform>-<arch>.<ext>`).
 */
function getBundledResourcePath(): string | null {
  // Single format across platforms — the `tar` lib packs/extracts .tar.gz on
  // Windows too, so we avoid needing a separate zip creator at build time.
  const resourceName = `ffmpeg-${process.platform}-${process.arch}.tar.gz`;

  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, resourceName);
    if (fs.existsSync(packaged)) return packaged;
  }
  // Development: resources/ next to the app.
  const dev = path.join(app.getAppPath(), 'resources', resourceName);
  if (fs.existsSync(dev)) return dev;

  return null;
}

/**
 * Install the bundled FFmpeg from packaged resources.
 * The archive contains the flat binaries at its root, so extraction targets
 * `getFfmpegDir()` directly.
 */
export async function installFfmpeg(onProgress?: ArchiveProgressCallback): Promise<boolean> {
  const ffmpegDir = getFfmpegDir();
  const ffmpegPath = getFfmpegBinaryPath();

  if (fs.existsSync(ffmpegPath)) {
    mainLog('FfmpegRuntime', 'FFmpeg already installed at:', ffmpegPath);
    return true;
  }

  const resourcePath = getBundledResourcePath();
  if (!resourcePath) {
    mainWarn('FfmpegRuntime', 'Bundled FFmpeg resource not found; skills needing ffmpeg will not work');
    return false;
  }

  mainLog('FfmpegRuntime', `Installing FFmpeg from ${resourcePath} to ${ffmpegDir}`);
  fs.mkdirSync(ffmpegDir, { recursive: true });

  try {
    await extractTarGzWithProgress(resourcePath, ffmpegDir, onProgress);

    if (!fs.existsSync(ffmpegPath)) {
      throw new Error(`FFmpeg binary not found at ${ffmpegPath} after extracting ${resourcePath}`);
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
  }
}

/**
 * Ensure FFmpeg is installed (extract if not). Call at app startup, alongside
 * `ensureNodeInstalled`.
 */
export async function ensureFfmpegInstalled(onProgress?: ArchiveProgressCallback): Promise<boolean> {
  if (isFfmpegInstalled()) return true;
  return installFfmpeg(onProgress);
}
