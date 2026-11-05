import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const localRequire = createRequire(import.meta.url);
const { getElectronRebuildInvocation } = localRequire('../../scripts/rebuildNativeModules.js') as {
  getElectronRebuildInvocation: (modules: string[], arch: string, version: string) => { command: string; args: string[] };
};

describe('native rebuild CLI compatibility', () => {
  it('uses the installed rebuild package when package manager commands are unavailable', () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'sudowork rebuild CLI 用户-'));
    try {
      writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'local-rebuild-fixture', version: '1.0.0' }));
      const helper = path.resolve(__dirname, '../../scripts/rebuildNativeModules.js');
      const script = 'require(process.argv[1]).rebuildWithElectronRebuild(JSON.parse(process.argv[2]))';
      const options = { platform: process.platform, arch: process.arch, electronVersion: '40.8.5', cwd: fixture };
      const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PATH'));
      const result = spawnSync(process.execPath, ['-e', script, helper, JSON.stringify(options)], {
        cwd: fixture,
        env: { ...env, PATH: '' },
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

  it('accepts the requested Electron version without relying on an installed Electron dependency', () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'sudowork-rebuild-cli-'));
    try {
      writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'empty-rebuild-fixture', version: '1.0.0' }));
      const packageFile = path.resolve(path.dirname(localRequire.resolve('@electron/rebuild')), '../package.json');
      const manifest = JSON.parse(readFileSync(packageFile, 'utf8')) as { bin: Record<string, string> };
      const cli = path.resolve(path.dirname(packageFile), manifest.bin['electron-rebuild']);
      const invocation = getElectronRebuildInvocation(['better-sqlite3'], process.arch, '40.8.5');
      expect(invocation.command).toBe(process.execPath);
      expect(invocation.args[0]).toBe(cli);
      // An empty module tree exercises argument/version resolution without compiling or fetching headers.
      const result = spawnSync(invocation.command, [...invocation.args, '--module-dir', fixture], {
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
