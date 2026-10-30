import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ root: '', appRoot: '', output: 'scode 0.2.21', bundledVersion: '0.2.21', exec: vi.fn(), extract: vi.fn(), retire: vi.fn() }));
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => fixture.appRoot } }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('child_process', async (original) => ({ ...(await original<typeof import('child_process')>()), execFileSync: fixture.exec }));
vi.mock('../../src/process/services/scode/scodePaths', () => ({
  get SCODE_BIN_HOME() {
    return fixture.root;
  },
}));
vi.mock('../../src/shared/runtime-versions.json', () => ({
  default: {
    get scode() {
      return fixture.bundledVersion;
    },
  },
}));
vi.mock('../../src/process/services/scode/retireScodeService', () => ({ retireScodeService: fixture.retire }));
vi.mock('../../src/shared/scode-platforms.json', () => ({
  default: { platforms: { [`${process.platform}-${process.arch}`]: { os: 'fixture', arch: 'test', ext: '.zip' } } },
}));
vi.mock('../../src/process/services/archiveProgress', () => ({
  listZipEntries: vi.fn(async () => [process.platform === 'win32' ? 'scode.exe' : 'scode']),
  listTarGzEntries: vi.fn(),
  extractZipWithProgress: fixture.extract,
  extractTarGzWithProgress: vi.fn(),
}));

describe('installed scode version', () => {
  beforeEach(() => {
    vi.resetModules();
    fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'scode-installed-version-'));
    fixture.appRoot = path.join(fixture.root, 'app');
    fs.mkdirSync(path.join(fixture.appRoot, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(fixture.appRoot, 'resources', 'v0.2.21-scode-fixture-test.zip'), Buffer.alloc(1024 * 100));
    fixture.output = 'scode 0.2.21';
    fixture.bundledVersion = '0.2.21';
    fixture.retire.mockReset().mockResolvedValue(undefined);
    fixture.exec.mockReset().mockImplementation(() => fixture.output);
    fixture.extract.mockReset().mockImplementation(async (_archive: string, directory: string) => {
      fs.writeFileSync(path.join(directory, process.platform === 'win32' ? 'scode.exe' : 'scode'), 'new executable');
    });
    fs.writeFileSync(path.join(fixture.root, process.platform === 'win32' ? 'scode.exe' : 'scode'), 'fixture');
    fs.writeFileSync(path.join(fixture.root, '.scode-bin-ready'), '0.1.12');
  });
  afterEach(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  it('accepts a manually updated binary despite the stale install receipt', async () => {
    const install = await import('../../src/process/services/scode/ScodeInstallService');
    expect(install.getScodeVersionState()).toEqual({ installedVersion: '0.2.21', bundledVersion: '0.2.21', needsUpgrade: false });
    expect(await install.ensureScodeInstalled()).toBe(true);
    expect(fixture.exec).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(fixture.root, '.scode-bin-ready'), 'utf8')).toBe('0.1.12');
  });

  it('keeps a newer user installation instead of requesting a downgrade', async () => {
    fixture.output = 'scode 0.2.22';
    const install = await import('../../src/process/services/scode/ScodeInstallService');
    expect(install.getScodeVersionState().needsUpgrade).toBe(false);
    expect(await install.ensureScodeInstalled()).toBe(true);
  });

  it('detects an older binary even if the receipt claims the bundled version', async () => {
    fixture.output = 'scode 0.2.19';
    fs.writeFileSync(path.join(fixture.root, '.scode-bin-ready'), '0.2.21');
    const install = await import('../../src/process/services/scode/ScodeInstallService');
    expect(install.getScodeVersionState().needsUpgrade).toBe(true);
    expect(install.getScodePath()).toBeNull();
  });

  it('does not accept a failed or invalid version probe', async () => {
    fixture.exec.mockImplementation(() => {
      throw new Error('process timeout');
    });
    const install = await import('../../src/process/services/scode/ScodeInstallService');
    expect(install.isScodeInstalled()).toBe(false);
    fixture.exec.mockReturnValue('unrelated 0.2.21');
    expect(install.isScodeInstalled()).toBe(false);
  });

  it('invalidates the cache after the executable is replaced or removed', async () => {
    const install = await import('../../src/process/services/scode/ScodeInstallService');
    expect(install.isScodeInstalled()).toBe(true);
    const binary = path.join(fixture.root, process.platform === 'win32' ? 'scode.exe' : 'scode');
    fs.writeFileSync(binary, 'changed executable');
    fixture.output = 'scode 0.2.19';
    expect(install.isScodeInstalled()).toBe(false);
    expect(fixture.exec).toHaveBeenCalledTimes(2);
    fs.unlinkSync(binary);
    expect(install.isScodeInstalled()).toBe(false);
  });

  it('requires the stable build when the same version is only a release candidate', async () => {
    fixture.output = 'scode 0.2.21-rc.1';
    const install = await import('../../src/process/services/scode/ScodeInstallService');
    expect(install.getScodeVersionState().needsUpgrade).toBe(true);
  });

  it('finishes installation after the new binary misses its first version probe', async () => {
    fixture.exec
      .mockImplementationOnce(() => 'scode 0.2.21')
      .mockImplementationOnce(() => {
        throw Object.assign(new Error('cold binary timed out'), { code: 'ETIMEDOUT' });
      });
    const install = await import('../../src/process/services/scode/ScodeInstallService');

    expect(await install.ensureScodeInstalled({ forceReinstall: true })).toBe(true);
    expect(fixture.exec).toHaveBeenCalledTimes(3);
    expect(fs.readFileSync(path.join(fixture.root, '.scode-bin-ready'), 'utf8')).toBe('0.2.21');
    expect(install.isScodeInstalled()).toBe(true);
  });

  it('keeps installation unsuccessful when both version probes fail', async () => {
    fixture.exec
      .mockImplementationOnce(() => 'scode 0.2.21')
      .mockImplementation(() => {
        throw new Error('binary cannot start');
      });
    const install = await import('../../src/process/services/scode/ScodeInstallService');

    expect(await install.ensureScodeInstalled({ forceReinstall: true })).toBe(false);
    expect(fixture.exec).toHaveBeenCalledTimes(3);
    expect(fs.existsSync(path.join(fixture.root, '.scode-bin-ready'))).toBe(false);
  });

  it('rejects an older extracted binary without retrying it into a valid installation', async () => {
    fixture.output = 'scode 0.2.19';
    const install = await import('../../src/process/services/scode/ScodeInstallService');

    expect(await install.ensureScodeInstalled({ forceReinstall: true })).toBe(false);
    expect(fixture.exec).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(path.join(fixture.root, '.scode-bin-ready'))).toBe(false);
  });

  function prepareSharedServiceUpgrade() {
    fixture.output = 'scode 0.2.36';
    fixture.bundledVersion = '0.2.37';
    fs.writeFileSync(path.join(fixture.appRoot, 'resources', 'v0.2.37-scode-fixture-test.zip'), Buffer.alloc(1024 * 100));
    fixture.extract.mockImplementation(async (_archive: string, directory: string) => {
      fixture.output = 'scode 0.2.37';
      fs.writeFileSync(path.join(directory, process.platform === 'win32' ? 'scode.exe' : 'scode'), 'new executable');
    });
  }

  it('retires the idle old service before removing any installation files', async () => {
    prepareSharedServiceUpgrade();
    const binary = path.join(fixture.root, process.platform === 'win32' ? 'scode.exe' : 'scode');
    fixture.retire.mockImplementation(async () => {
      expect(fs.readFileSync(binary, 'utf8')).toBe('fixture');
      expect(fs.readFileSync(path.join(fixture.root, '.scode-bin-ready'), 'utf8')).toBe('0.1.12');
      expect(fixture.extract).not.toHaveBeenCalled();
    });
    const install = await import('../../src/process/services/scode/ScodeInstallService');
    expect(await install.ensureScodeInstalled()).toBe(true);
    expect(fixture.retire).toHaveBeenCalledExactlyOnceWith(binary);
    expect(install.getScodeVersionState().installedVersion).toBe('0.2.37');
  });

  it('preserves the old binary and receipt when the service has active agents', async () => {
    prepareSharedServiceUpgrade();
    fixture.retire.mockRejectedValue(new Error('Agent runtimes are using this service'));
    const install = await import('../../src/process/services/scode/ScodeInstallService');
    expect(await install.ensureScodeInstalled()).toBe(false);
    expect(fixture.extract).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(fixture.root, process.platform === 'win32' ? 'scode.exe' : 'scode'), 'utf8')).toBe('fixture');
    expect(fs.readFileSync(path.join(fixture.root, '.scode-bin-ready'), 'utf8')).toBe('0.1.12');
  });

  it('also retires a current service before an explicit reinstall', async () => {
    prepareSharedServiceUpgrade();
    fixture.output = 'scode 0.2.37';
    const install = await import('../../src/process/services/scode/ScodeInstallService');
    expect(await install.ensureScodeInstalled({ forceReinstall: true })).toBe(true);
    expect(fixture.retire).toHaveBeenCalledOnce();
  });

  it('does not contact a shared service for versions before it existed', async () => {
    fixture.output = 'scode 0.2.19';
    fixture.extract.mockImplementation(async (_archive: string, directory: string) => {
      fixture.output = 'scode 0.2.21';
      fs.writeFileSync(path.join(directory, process.platform === 'win32' ? 'scode.exe' : 'scode'), 'new executable');
    });
    const install = await import('../../src/process/services/scode/ScodeInstallService');
    expect(await install.ensureScodeInstalled()).toBe(true);
    expect(fixture.retire).not.toHaveBeenCalled();
  });
});
