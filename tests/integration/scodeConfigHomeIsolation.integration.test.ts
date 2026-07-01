/**
 * @license
 * Copyright 2026 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real cross-repo contract test for sudowork ↔ scode config isolation.
 *
 * sudowork isolates its embedded engine-scode by spawning the scode binary with
 * `SUDO_CODE_CONFIG_HOME` pointed at `~/.nexus/sudowork/sudocode` (see
 * scodePaths.ts + acpConnectors). That only actually isolates anything if the
 * REAL scode binary honours the env var. Rather than trust the contract, this
 * test drives the actual binary:
 *
 *   scode config --output-format json   (a read-only merged-config report)
 *
 * and asserts that the user-scope config files (`scode.json` / `settings.json`)
 * resolve UNDER the home we point the env var at — and, crucially, NOT under the
 * standalone `~/.nexus/sudocode` — proving a standalone scode install and
 * sudowork's engine-scode read different config homes.
 *
 * The binary is resolved from where sudowork installs it (or an explicit
 * SCODE_BIN override); if no binary is available (e.g. a bare CI checkout that
 * skipped `scode:download`) the suite skips rather than failing red. CI wires a
 * download+extract step so it runs for real there.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SCODE_HOME, LEGACY_SCODE_HOME } from '../../src/process/services/scode/scodePaths';

const exeName = process.platform === 'win32' ? 'scode.exe' : 'scode';

/** Resolve a runnable scode binary, or null to skip. */
function resolveScodeBinary(): string | null {
  const candidates = [
    process.env.SCODE_BIN,
    path.join(SCODE_HOME, exeName), // sudowork's isolated install
    path.join(LEGACY_SCODE_HOME, exeName), // standalone / pre-isolation install
  ].filter((p): p is string => !!p);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

type ConfigReport = {
  cwd: string;
  files: Array<{ loaded: boolean; path: string; source: string }>;
  kind: string;
};

function normalize(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

const scodeBin = resolveScodeBinary();
const describeMaybe = scodeBin ? describe : describe.skip;

describeMaybe('scode config-home isolation (real binary)', () => {
  let workspace: string; // clean cwd so repo project-config doesn't add noise

  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'scode-iso-ws-'));
  });

  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  /** Run `scode config --output-format json` with a given config home. */
  function readConfigReport(configHome: string | undefined): ConfigReport {
    const env = { ...process.env };
    if (configHome) {
      env.SUDO_CODE_CONFIG_HOME = configHome;
    } else {
      delete env.SUDO_CODE_CONFIG_HOME;
    }
    const out = execFileSync(scodeBin as string, ['config', '--output-format', 'json'], {
      cwd: workspace,
      env,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    return JSON.parse(out) as ConfigReport;
  }

  it('routes the user-scope config home to SUDO_CODE_CONFIG_HOME (and reads a file placed there)', () => {
    const isoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'scode-iso-home-'));
    // a real settings.json the engine should pick up from the isolated home
    fs.writeFileSync(path.join(isoHome, 'settings.json'), '{}');

    const report = readConfigReport(isoHome);
    const userFiles = report.files.filter((f) => f.source === 'user');
    expect(userFiles.length).toBeGreaterThan(0);

    // every user-scope file resolves UNDER the isolated home we requested...
    for (const f of userFiles) {
      expect(normalize(f.path).startsWith(normalize(isoHome))).toBe(true);
    }
    // ...and NONE leaks to the standalone ~/.nexus/sudocode home
    for (const f of userFiles) {
      expect(normalize(f.path).startsWith(normalize(LEGACY_SCODE_HOME) + '/')).toBe(false);
    }
    // the settings.json we placed in the isolated home was actually loaded (data flow, not just path)
    const loadedSettings = userFiles.find((f) => normalize(f.path).endsWith('/settings.json'));
    expect(loadedSettings?.loaded).toBe(true);

    fs.rmSync(isoHome, { recursive: true, force: true });
  });

  it('two different config homes are fully isolated — neither sees the other', () => {
    const homeA = fs.mkdtempSync(path.join(os.tmpdir(), 'scode-iso-A-'));
    const homeB = fs.mkdtempSync(path.join(os.tmpdir(), 'scode-iso-B-'));

    const userA = readConfigReport(homeA).files.filter((f) => f.source === 'user');
    const userB = readConfigReport(homeB).files.filter((f) => f.source === 'user');

    // A's user config lives under A only; B's under B only — no cross-bleed
    expect(userA.every((f) => normalize(f.path).startsWith(normalize(homeA)))).toBe(true);
    expect(userA.some((f) => normalize(f.path).startsWith(normalize(homeB)))).toBe(false);
    expect(userB.every((f) => normalize(f.path).startsWith(normalize(homeB)))).toBe(true);

    fs.rmSync(homeA, { recursive: true, force: true });
    fs.rmSync(homeB, { recursive: true, force: true });
  });

  it('without the env var, scode falls back to HOME/.nexus/sudocode (the standalone default)', () => {
    // scode's default_config_home() reads $HOME (not os.homedir()); on Windows CI
    // HOME is often unset, so pin it explicitly to make the fallback deterministic
    // and cross-platform. This is the shared home we are moving sudowork OFF of —
    // it must stay the standalone default when SUDO_CODE_CONFIG_HOME is absent.
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'scode-iso-home2-'));
    const env = { ...process.env };
    delete env.SUDO_CODE_CONFIG_HOME;
    env.HOME = fakeHome;
    env.USERPROFILE = fakeHome; // belt-and-braces on Windows

    const out = execFileSync(scodeBin as string, ['config', '--output-format', 'json'], {
      cwd: workspace,
      env,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    const userFiles = (JSON.parse(out) as ConfigReport).files.filter((f) => f.source === 'user');
    const expectedHome = path.join(fakeHome, '.nexus', 'sudocode');
    expect(userFiles.length).toBeGreaterThan(0);
    expect(userFiles.every((f) => normalize(f.path).startsWith(normalize(expectedHome)))).toBe(true);

    fs.rmSync(fakeHome, { recursive: true, force: true });
  });
});
