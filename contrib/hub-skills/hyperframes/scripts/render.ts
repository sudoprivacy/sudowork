#!/usr/bin/env npx tsx
// @ts-nocheck
/**
 * HyperFrames skill wrapper.
 *
 * Provisions everything HyperFrames needs so sudowork requires no system FFmpeg:
 *   1. installs `hyperframes` (CLI) + `ffmpeg-static` into the skill dir on first run
 *   2. resolves the bundled static ffmpeg binary and puts it on PATH (+ FFMPEG_PATH)
 *   3. delegates to the `hyperframes` CLI, passing through all args
 *
 * Usage:
 *   npx tsx render.ts init <dir>     # scaffold a new HTML video project
 *   npx tsx render.ts preview        # live browser preview
 *   npx tsx render.ts render [opts]  # render composition to MP4
 *   npx tsx render.ts --help         # upstream CLI help
 *
 * Chromium for frame capture is auto-downloaded by puppeteer at install time
 * (~150 MB, one time). Requires Node 22+.
 */

import { existsSync } from 'fs';
import { join, dirname, delimiter } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync, spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const isWin = process.platform === 'win32';

function nodeMajor(): number {
  return parseInt(process.versions.node.split('.')[0], 10);
}

function localBin(name: string): string {
  const bin = join(SKILL_ROOT, 'node_modules', '.bin', isWin ? `${name}.cmd` : name);
  return bin;
}

/** Install hyperframes + ffmpeg-static into the skill dir if missing. */
function ensureDeps(): void {
  if (existsSync(localBin('hyperframes'))) {
    try {
      require.resolve('ffmpeg-static');
      require.resolve('ffprobe-static');
      return; // all present
    } catch {
      /* fall through to install */
    }
  }
  console.error('[hyperframes] First run: installing hyperframes + ffmpeg-static (this also pulls a headless Chromium, ~150MB, one time)...');
  // Deps are declared in this skill's package.json, so `npm install` stays scoped
  // to SKILL_ROOT/node_modules and honors the pinned version ranges.
  execSync('npm install', {
    cwd: SKILL_ROOT,
    stdio: 'inherit',
  });
}

/**
 * Return env with the bundled ffmpeg AND ffprobe on PATH so hyperframes' spawned
 * `ffmpeg` / `ffprobe` resolve to ours. ffmpeg-static ships ffmpeg only; ffprobe
 * comes from ffprobe-static (hyperframes' doctor checks for both).
 */
function buildEnv(): NodeJS.ProcessEnv {
  const ffmpegPath: string = require('ffmpeg-static'); // absolute path to the static binary
  if (!ffmpegPath || !existsSync(ffmpegPath)) {
    throw new Error(`ffmpeg-static did not resolve to a real binary (got: ${ffmpegPath})`);
  }
  const ffprobeMod = require('ffprobe-static'); // exports { path } (older builds export a string)
  const ffprobePath: string = typeof ffprobeMod === 'string' ? ffprobeMod : ffprobeMod?.path;
  if (!ffprobePath || !existsSync(ffprobePath)) {
    throw new Error(`ffprobe-static did not resolve to a real binary (got: ${ffprobePath})`);
  }
  const binDir = join(SKILL_ROOT, 'node_modules', '.bin');
  const env = { ...process.env };
  env.PATH = [dirname(ffmpegPath), dirname(ffprobePath), binDir, env.PATH || ''].join(delimiter);
  // Belt-and-suspenders: libraries that read an explicit binary path.
  env.FFMPEG_PATH = ffmpegPath;
  env.FFMPEG_BIN = ffmpegPath;
  env.FFPROBE_PATH = ffprobePath;
  return env;
}

// Subcommands that actually drive a headless browser.
const RENDER_CMDS = new Set(['render', 'preview', 'present', 'snapshot', 'inspect', 'benchmark']);

/** For render-class commands, make sure a Chrome is present (hyperframes fetches it on demand). */
function ensureChrome(env: NodeJS.ProcessEnv): void {
  console.error('[hyperframes] ensuring Chrome for rendering (first time downloads ~150MB)...');
  const r = spawnSync('hyperframes', ['browser', 'ensure'], { stdio: 'inherit', env, shell: isWin });
  if (r.status !== 0) {
    console.error('[hyperframes] "browser ensure" did not succeed; the render may still try to fetch Chrome itself.');
  }
}

function main(): void {
  if (nodeMajor() < 22) {
    console.error(`[hyperframes] Node ${process.versions.node} detected; HyperFrames needs Node 22+. Aborting.`);
    process.exit(1);
  }

  const args = process.argv.slice(2);

  ensureDeps();
  const env = buildEnv();

  if (args.length && RENDER_CMDS.has(args[0])) {
    ensureChrome(env);
  }

  // Delegate to the locally-installed hyperframes CLI (faster + deterministic than npx fetch).
  const result = spawnSync('hyperframes', args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env,
    shell: isWin, // resolve the .cmd shim on Windows
  });

  if (result.error) {
    console.error('[hyperframes] failed to launch:', result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 0);
}

main();
