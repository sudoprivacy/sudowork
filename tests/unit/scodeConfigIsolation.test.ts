/**
 * @license
 * Copyright 2026 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Config/binary isolation between sudowork's embedded (engine) scode and a
 * user-installed standalone scode.
 *
 * Background: both products default their config home to `~/.nexus/sudocode`, so
 * installing both on one machine made them stomp each other's `sudocode.json`
 * (models/auth), `settings.json` (settings/MCP) and the binary. sudowork now
 * isolates its engine-scode under `~/.nexus/sudowork/sudocode` (mirroring how
 * Claude Desktop / Claude Code keep separate config homes) and drives scode with
 * `SUDO_CODE_CONFIG_HOME` pointed there.
 *
 * These tests lock in the three load-bearing guarantees:
 *   1. the path SSOT is isolated and self-consistent;
 *   2. first-run migration copies a PRIOR SUDOWORK install's config once, never
 *      clobbers, never auto-imports a standalone scode's config, and is idempotent;
 *   3. no code outside the SSOT re-derives a home-level `~/.nexus/sudocode` path.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const READY_MARKER = '.scode-bin-ready';
const MIGRATION_MARKER = '.sudowork-config-migrated';

describe('scode config isolation — path SSOT', () => {
  it('isolates the engine-scode home under ~/.nexus/sudowork/sudocode', async () => {
    const { SCODE_HOME, LEGACY_SCODE_HOME, SCODE_CONFIG_PATH, SCODE_SETTINGS_PATH } = await import('../../src/process/services/scode/scodePaths');

    // engine home lives under the isolated sudowork/ namespace, not the shared one
    expect(SCODE_HOME).toContain(os.homedir());
    expect(SCODE_HOME.endsWith(path.join('.nexus', 'sudowork', 'sudocode'))).toBe(true);

    // standalone scode's default home (used only as the migration source)
    expect(LEGACY_SCODE_HOME.endsWith(path.join('.nexus', 'sudocode'))).toBe(true);

    // the whole point: the two homes must differ, else there is no isolation
    expect(SCODE_HOME).not.toBe(LEGACY_SCODE_HOME);
    expect(SCODE_HOME.startsWith(LEGACY_SCODE_HOME + path.sep)).toBe(false);

    // config + settings are derived from the isolated home (one relocation, both files)
    expect(SCODE_CONFIG_PATH).toBe(path.join(SCODE_HOME, 'sudocode.json'));
    expect(SCODE_SETTINGS_PATH).toBe(path.join(SCODE_HOME, 'settings.json'));
  });

  it('ScodeInstallService.SCODE_DIR is an alias of the SSOT home (no duplicate literal)', async () => {
    const paths = await import('../../src/process/services/scode/scodePaths');
    const install = await import('../../src/process/services/scode/ScodeInstallService');

    // SCODE_DIR is re-exported from the SSOT, not an independently-computed string.
    expect(install.SCODE_DIR).toBe(paths.SCODE_HOME);
  });
});

describe('scode config isolation — first-run migration', () => {
  let tempRoot: string;
  let home: string; // isolated ~/.nexus/sudowork/sudocode stand-in
  let legacy: string; // shared ~/.nexus/sudocode stand-in

  beforeEach(async () => {
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'sudowork-scode-iso-'));
    home = path.join(tempRoot, 'sudowork', 'sudocode');
    legacy = path.join(tempRoot, 'sudocode');
    await fsp.mkdir(legacy, { recursive: true });
  });

  afterEach(async () => {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  });

  it('copies config from a PRIOR SUDOWORK install and leaves the legacy copy intact', async () => {
    const { migrateLegacyScodeHomeOnce } = await import('../../src/process/services/scode/ScodeInstallService');

    // legacy home was a sudowork install (has sudowork's ready-marker) with real config
    fs.writeFileSync(path.join(legacy, READY_MARKER), '0.1.1');
    fs.writeFileSync(path.join(legacy, 'sudocode.json'), '{"default_model":"gpt"}');
    fs.writeFileSync(path.join(legacy, 'settings.json'), '{"mcp":{}}');
    fs.mkdirSync(path.join(legacy, 'skills', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'skills', 'demo', 'SKILL.md'), '# demo');

    migrateLegacyScodeHomeOnce(home, legacy);

    // config copied into the isolated home (data-flow assertion, not just existence)
    expect(fs.readFileSync(path.join(home, 'sudocode.json'), 'utf-8')).toBe('{"default_model":"gpt"}');
    expect(fs.readFileSync(path.join(home, 'settings.json'), 'utf-8')).toBe('{"mcp":{}}');
    expect(fs.readFileSync(path.join(home, 'skills', 'demo', 'SKILL.md'), 'utf-8')).toBe('# demo');
    // migration is a COPY, not a move — legacy stays usable for a standalone scode
    expect(fs.existsSync(path.join(legacy, 'sudocode.json'))).toBe(true);
    // marker written so it never runs again
    expect(fs.existsSync(path.join(home, MIGRATION_MARKER))).toBe(true);
  });

  it("does NOT auto-import a standalone scode's config (default full isolation)", async () => {
    const { migrateLegacyScodeHomeOnce } = await import('../../src/process/services/scode/ScodeInstallService');

    // legacy home is a STANDALONE scode: has config but NO sudowork ready-marker/binary
    fs.writeFileSync(path.join(legacy, 'sudocode.json'), '{"default_model":"standalone-secret"}');

    migrateLegacyScodeHomeOnce(home, legacy);

    // isolation wins: the standalone config must not leak into the engine home
    expect(fs.existsSync(path.join(home, 'sudocode.json'))).toBe(false);
    // but migration is still marked done so we don't re-scan on every launch
    expect(fs.existsSync(path.join(home, MIGRATION_MARKER))).toBe(true);
  });

  it('does NOT treat a standalone scode (has scode.exe but no sudowork marker) as migratable', async () => {
    const { migrateLegacyScodeHomeOnce } = await import('../../src/process/services/scode/ScodeInstallService');

    // The exact customer scenario: a standalone scode install — scode binary
    // present, real config present, but NO sudowork ready-marker. Detection must
    // key off the sudowork marker, not the (shared) binary, or it would import.
    const exeName = process.platform === 'win32' ? 'scode.exe' : 'scode';
    fs.writeFileSync(path.join(legacy, exeName), 'binary');
    fs.writeFileSync(path.join(legacy, 'sudocode.json'), '{"default_model":"standalone-secret"}');

    migrateLegacyScodeHomeOnce(home, legacy);

    expect(fs.existsSync(path.join(home, 'sudocode.json'))).toBe(false);
    expect(fs.existsSync(path.join(home, MIGRATION_MARKER))).toBe(true);
  });

  it('never clobbers config already present in the isolated home', async () => {
    const { migrateLegacyScodeHomeOnce } = await import('../../src/process/services/scode/ScodeInstallService');

    fs.writeFileSync(path.join(legacy, READY_MARKER), '0.1.1');
    fs.writeFileSync(path.join(legacy, 'sudocode.json'), '{"from":"legacy"}');
    // user already has an isolated config (e.g. re-run after partial migration)
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'sudocode.json'), '{"from":"isolated"}');

    migrateLegacyScodeHomeOnce(home, legacy);

    expect(fs.readFileSync(path.join(home, 'sudocode.json'), 'utf-8')).toBe('{"from":"isolated"}');
  });

  it('is idempotent — a second run does not re-copy after the marker exists', async () => {
    const { migrateLegacyScodeHomeOnce } = await import('../../src/process/services/scode/ScodeInstallService');

    fs.writeFileSync(path.join(legacy, READY_MARKER), '0.1.1');
    fs.writeFileSync(path.join(legacy, 'sudocode.json'), '{"v":1}');

    migrateLegacyScodeHomeOnce(home, legacy);
    // user edits the isolated config after migration; legacy also changes
    fs.writeFileSync(path.join(home, 'sudocode.json'), '{"v":2}');
    fs.writeFileSync(path.join(legacy, 'sudocode.json'), '{"v":99}');

    migrateLegacyScodeHomeOnce(home, legacy);

    // second run is a no-op: user's post-migration edit is preserved
    expect(fs.readFileSync(path.join(home, 'sudocode.json'), 'utf-8')).toBe('{"v":2}');
  });

  it('no-ops when home and legacy are the same path (isolation disabled)', async () => {
    const { migrateLegacyScodeHomeOnce } = await import('../../src/process/services/scode/ScodeInstallService');
    fs.writeFileSync(path.join(legacy, READY_MARKER), '0.1.1');

    migrateLegacyScodeHomeOnce(legacy, legacy);

    // must not write a migration marker into the shared home when nothing to isolate
    expect(fs.existsSync(path.join(legacy, MIGRATION_MARKER))).toBe(false);
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
