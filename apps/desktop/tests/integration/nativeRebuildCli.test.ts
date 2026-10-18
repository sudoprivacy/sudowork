import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const localRequire = createRequire(import.meta.url);
const { getElectronRebuildArgs } = localRequire('../../scripts/rebuildNativeModules.js') as {
  getElectronRebuildArgs: (modules: string[], arch: string, version: string) => string[];
};

describe('native rebuild CLI compatibility', () => {
  it('accepts the requested Electron version without relying on an installed Electron dependency', () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'sudowork-rebuild-cli-'));
    try {
      writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'empty-rebuild-fixture', version: '1.0.0' }));
      const packageFile = path.resolve(path.dirname(localRequire.resolve('@electron/rebuild')), '../package.json');
      const manifest = JSON.parse(readFileSync(packageFile, 'utf8')) as { bin: Record<string, string> };
      const cli = path.resolve(path.dirname(packageFile), manifest.bin['electron-rebuild']);
      const args = getElectronRebuildArgs(['better-sqlite3'], process.arch, '40.8.5');
      // An empty module tree exercises argument/version resolution without compiling or fetching headers.
      const result = spawnSync(process.execPath, [cli, ...args, '--module-dir', fixture], {
        cwd: fixture,
        timeout: 20_000,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr || result.stdout).toBe(0);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);
});
