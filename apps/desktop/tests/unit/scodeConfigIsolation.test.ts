/**
 * @license
 * Copyright 2026 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Config/binary isolation between sudowork's embedded (engine) scode and a
 * user-installed standalone scode.
 *
 * Background: sudowork is a UI over sudocode, so it isolates the way two
 * sudocode instances do — one shared config home, per-instance differences
 * layered on as project config. Only the pinned engine BINARY is kept apart.
 * Forking a second config home instead made the same accounts and models
 * exist twice and drift; the copy went stale and ended up with no accounts.
 *
 * These tests lock in the load-bearing guarantees:
 *   1. config resolves to the shared home, the binary to the isolated one;
 *   2. no code outside the SSOT re-derives a home-level scode path;
 *   3. the engine env contract points scode at the shared config home.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/mock-app',
  },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

/** First scode release whose engine reads `SUDOCODE_DISABLE_CRON_TOOLS`. */
const SCODE_MIN_VERSION_WITH_CRON_GATE = '0.1.13';

function isAtLeast(version: string, minimum: string): boolean {
  const parts = (v: string) =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const [actual, floor] = [parts(version), parts(minimum)];
  for (let i = 0; i < Math.max(actual.length, floor.length); i++) {
    const delta = (actual[i] ?? 0) - (floor[i] ?? 0);
    if (delta !== 0) return delta > 0;
  }
  return true;
}

describe('scode config isolation — path SSOT', () => {
  it('shares the config home and isolates only the engine binary', async () => {
    const { SCODE_BIN_HOME, SCODE_CONFIG_HOME, SCODE_CONFIG_PATH, SCODE_SETTINGS_PATH } = await import('../../src/process/services/scode/scodePaths');

    // config lives in the SHARED home — the same one a standalone scode defaults to,
    // so accounts/models are defined once instead of copied into a second home
    expect(SCODE_CONFIG_HOME).toContain(os.homedir());
    expect(SCODE_CONFIG_HOME.endsWith(path.join('.nexus', 'sudocode'))).toBe(true);

    // the binary stays isolated: sudowork pins its own engine version
    expect(SCODE_BIN_HOME.endsWith(path.join('.nexus', 'sudowork', 'sudocode'))).toBe(true);
    expect(SCODE_BIN_HOME).not.toBe(SCODE_CONFIG_HOME);

    // both config files derive from the config home, not the binary home
    expect(SCODE_CONFIG_PATH).toBe(path.join(SCODE_CONFIG_HOME, 'sudocode.json'));
    expect(SCODE_SETTINGS_PATH).toBe(path.join(SCODE_CONFIG_HOME, 'settings.json'));
    expect(SCODE_CONFIG_PATH.startsWith(SCODE_BIN_HOME)).toBe(false);
  });

  it('ScodeInstallService.SCODE_DIR is the BINARY home (no duplicate literal)', async () => {
    const paths = await import('../../src/process/services/scode/scodePaths');
    const install = await import('../../src/process/services/scode/ScodeInstallService');

    // the install service manages the binary, so its dir is the binary home —
    // re-exported from the SSOT, never an independently-computed string
    expect(install.SCODE_DIR).toBe(paths.SCODE_BIN_HOME);
  });
});

describe('scode config isolation — SSOT guard (no-hardcoded-scode-home)', () => {
  it('no file except scodePaths.ts derives a home-level ~/.nexus/sudocode path', () => {
    const srcRoot = path.resolve(__dirname, '..', '..', 'src');
    const ssot = path.join('process', 'services', 'scode', 'scodePaths.ts');

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const rel = path.relative(srcRoot, full);
        if (rel.split(path.sep).join('/') === ssot.split(path.sep).join('/')) continue; // SSOT is allowed
        const lines = fs.readFileSync(full, 'utf-8').split('\n');
        lines.forEach((line, i) => {
          // Home-level constructions always combine homedir() with sudocode on one
          // path.join line. Workspace-level paths use a `workspace`/cwd variable and
          // never homedir(), so they are (correctly) not flagged.
          if (/homedir\s*\(/.test(line) && /sudocode/.test(line)) {
            offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    };
    walk(srcRoot);

    expect(offenders, `home-level scode paths must come from scodePaths.ts, found:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('scode engine env contract', () => {
  it('injects the shared config home AND gates the agent cron tools', async () => {
    const { scodeEngineEnvOverrides } = await import('../../src/process/services/scode/scodeEngineEnv');
    const { SCODE_CONFIG_HOME, SCODE_CONFIG_PATH } = await import('../../src/process/services/scode/scodePaths');

    const env = scodeEngineEnvOverrides();

    // Config is SHARED with a standalone scode — one set of account/model
    // definitions, not two copies that drift.
    expect(env.SUDO_CODE_CONFIG_HOME).toBe(SCODE_CONFIG_HOME);
    expect(env.SUDOCODE_CONFIG_PATH).toBe(SCODE_CONFIG_PATH);

    // sudowork owns scheduling: it runs its own CronService and never ticks
    // scode's crons.json. Without this the agent could create a cron via scode's
    // CronCreate tool that persists but is NEVER fired — an orphan. scode reads
    // exactly this variable to hide its agent-facing cron tools.
    expect(env.SUDOCODE_DISABLE_CRON_TOOLS).toBe('1');
  });

  it('pins an engine version that actually honors the gate', () => {
    // The gate is a contract with the ENGINE BINARY, not just with our own code, so
    // asserting that we inject the variable proves nothing on its own. Released scode
    // 0.1.12 shipped the cron tools while ignoring SUDOCODE_DISABLE_CRON_TOOLS — with
    // that engine pinned, the injection is a silent no-op, the orphan-cron gap stays
    // open, and every other test here still passes. Pin backwards and this fails.
    const versions = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'shared', 'runtime-versions.json'), 'utf-8'));

    expect(isAtLeast(versions.scode, SCODE_MIN_VERSION_WITH_CRON_GATE), `runtime-versions.json pins scode ${versions.scode}, but the cron-tool gate needs >= ${SCODE_MIN_VERSION_WITH_CRON_GATE}`).toBe(true);
  });
});
