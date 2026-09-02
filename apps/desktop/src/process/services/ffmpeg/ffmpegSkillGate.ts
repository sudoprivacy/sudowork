/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Skill-gated ffmpeg provisioning.
 *
 * ffmpeg is downloaded on demand (see FfmpegRuntimeService), not shipped to
 * everyone. This module decides WHEN: a skill "needs ffmpeg" if any of its text
 * files reference `ffmpeg`/`ffprobe` (e.g. the FFmpeg Video Editor skill's
 * SKILL.md teaches the agent to run bare `ffmpeg`). Detecting by content — not a
 * hub-declared field or a hardcoded skill-id allowlist — keeps this
 * self-contained (no cross-repo coupling) and covers any ffmpeg-using skill.
 *
 * Call `maybeProvisionFfmpegForSkill(dir)` from the skill install/enable hooks,
 * and `reconcileFfmpegAtStartup()` once at boot (cheap: an O(1) marker check for
 * the common case where no ffmpeg skill was ever installed).
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDataPath } from '@process/utils';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { ensureFfmpegInstalled, isFfmpegInstalled } from './FfmpegRuntimeService';

/** Sibling of the ffmpeg dir (survives an ffmpeg-dir wipe): "an ffmpeg skill is installed". */
const requiredMarkerPath = (): string => path.join(getDataPath(), '.ffmpeg-required');

const FFMPEG_REF = /\bffmpeg\b|\bffprobe\b/i;
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.sh', '.bash', '.zsh', '.py', '.js', '.mjs', '.cjs', '.ts', '.json', '.yaml', '.yml', '.toml']);
const MAX_FILE_BYTES = 512 * 1024; // skip large/binary files
const MAX_FILES_SCANNED = 400; // bound the walk

/** Whether any text file under `skillDir` references ffmpeg/ffprobe. */
export function skillDirNeedsFfmpeg(skillDir: string): boolean {
  let scanned = 0;
  const walk = (dir: string, depth: number): boolean => {
    if (depth > 5) return false;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (scanned >= MAX_FILES_SCANNED) return false;
      const name = entry.name;
      if (name.startsWith('.') || name === 'node_modules') continue;
      const full = path.join(dir, name);
      if (entry.isDirectory()) {
        if (walk(full, depth + 1)) return true;
        continue;
      }
      if (!TEXT_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
      scanned++;
      try {
        if (fs.statSync(full).size > MAX_FILE_BYTES) continue;
        if (FFMPEG_REF.test(fs.readFileSync(full, 'utf-8'))) return true;
      } catch {
        // ignore unreadable file
      }
    }
    return false;
  };
  return walk(skillDir, 0);
}

/**
 * If `skillDir` needs ffmpeg, record it + provision (download from COS, async).
 * Fire-and-forget: never blocks the skill install/enable flow.
 */
export function maybeProvisionFfmpegForSkill(skillDir: string): void {
  try {
    if (!skillDirNeedsFfmpeg(skillDir)) return;
    try {
      fs.writeFileSync(requiredMarkerPath(), '');
    } catch {
      // marker is a best-effort optimization for startup reconciliation
    }
    if (isFfmpegInstalled()) return;
    mainLog('FfmpegRuntime', `Skill needs ffmpeg (${path.basename(skillDir)}); provisioning`);
    void ensureFfmpegInstalled().catch((err) => mainWarn('FfmpegRuntime', 'skill-gated ffmpeg provisioning failed (non-fatal)', err));
  } catch (err) {
    mainWarn('FfmpegRuntime', 'maybeProvisionFfmpegForSkill failed (non-fatal)', err);
  }
}

/**
 * At boot, re-provision ffmpeg only if a prior install marked it needed AND it's
 * missing (e.g. its dir was wiped). O(1) for everyone who never installed an
 * ffmpeg skill — no per-skill scanning at startup.
 */
export function reconcileFfmpegAtStartup(): void {
  try {
    if (isFfmpegInstalled()) return;
    if (!fs.existsSync(requiredMarkerPath())) return;
    mainLog('FfmpegRuntime', 'ffmpeg marked required but missing; re-provisioning at startup');
    void ensureFfmpegInstalled().catch((err) => mainWarn('FfmpegRuntime', 'startup ffmpeg re-provisioning failed (non-fatal)', err));
  } catch (err) {
    mainWarn('FfmpegRuntime', 'reconcileFfmpegAtStartup failed (non-fatal)', err);
  }
}
