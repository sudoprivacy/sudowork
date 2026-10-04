import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import versions from '../../src/shared/runtime-versions.json';
import plugins from '../../src/shared/runtime-plugins.json';

let root: string;
const providers = vi.hoisted(() => new Map<string, (data?: unknown) => Promise<unknown>>());
const stopNexus = vi.hoisted(() => vi.fn());
const startup = vi.hoisted(() => vi.fn());
const libraryAccess = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ app: { getPath: () => root, getAppPath: () => root, isPackaged: false } }));
vi.mock('fs', async (original) => {
  const actual = await original<typeof import('fs')>();
  return { ...actual, accessSync: (file: fs.PathLike, mode?: number) => (file === '/usr/local/lib/libfuse3.4.dylib' ? libraryAccess() : actual.accessSync(file, mode)) };
});
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/services/serviceManager', () => ({ serviceManager: { stopNexus, startup } }));
vi.mock('@process/services/initStatus', () => ({
  initStatusManager: { clearRetry: vi.fn(), addLog: vi.fn(), subscribe: vi.fn(), setStatus: vi.fn(), getStatus: () => ({ phase: 'ready' }) },
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    init: Object.fromEntries(['getStatus', 'retryStartup', 'reinstallComponent', 'quitApp'].map((name) => [name, { provider: (fn: (data?: unknown) => Promise<unknown>) => providers.set(name, fn) }])),
  },
}));

import { initInitBridge } from '../../src/process/bridge/initBridge';
import { dynamicNexusVfsService } from '../../src/process/services/nexus-vfs/DynamicNexusVfsService';
import { nexusPluginInstallers } from '../../src/process/services/nexus-vfs/VaultPluginInstaller';

function write(relative: string, value: string | Buffer): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

describe('managed Nexus repair on a real filesystem', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-repair-'));
    vi.clearAllMocks();
    libraryAccess.mockImplementation(() => {});
    stopNexus.mockResolvedValue(undefined);
    startup.mockResolvedValue(undefined);
    write('.nexus-vfs/bin/.nexus-vfs-bin-ready', versions['nexusd-cluster']);
    write(`.nexus-vfs/bin/nexusd-cluster${process.platform === 'win32' ? '.exe' : ''}`, 'damaged binary');
    for (const plugin of plugins) {
      const dylib = (plugin.dylib as Record<string, string>)[process.platform];
      if (!dylib) continue;
      write(`.nexus-vfs/plugins/${dylib}`, 'damaged plugin');
      write(`.nexus-vfs/plugins/${dylib}.sig`, Buffer.alloc(64));
      write(`.nexus-vfs/plugins/.${plugin.artifactPrefix}-ready`, (versions as Record<string, string>)[plugin.artifactPrefix]);
    }
    write('.nexus-vfs/data/vault.redb', 'existing user secrets');
    write('.nexus-vfs/identity/identity.json', 'existing node identity');
    write('.nexus/bin/scode', 'standalone CLI');
    write('.nexus-vfs/plugins/custom.txt', 'user file');
    initInitBridge();
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('reinstalls the current runtime and plugins without deleting data or standalone tools', async () => {
    expect(dynamicNexusVfsService.checkInstalledSync()).toBe(true);
    stopNexus.mockImplementation(async () => expect(fs.existsSync(path.join(root, '.nexus-vfs/bin'))).toBe(true));
    startup.mockImplementation(async () => {
      expect(fs.existsSync(path.join(root, '.nexus-vfs/bin'))).toBe(false);
      expect(fs.readdirSync(path.join(root, '.nexus-vfs/plugins'))).toEqual(['custom.txt']);
    });
    expect(await providers.get('reinstallComponent')!({ component: 'nexus' })).toEqual({ success: true });
    expect(stopNexus).toHaveBeenCalledOnce();
    expect(startup).toHaveBeenCalledWith(true);
    for (const [file, value] of [
      ['.nexus-vfs/data/vault.redb', 'existing user secrets'],
      ['.nexus-vfs/identity/identity.json', 'existing node identity'],
      ['.nexus/bin/scode', 'standalone CLI'],
    ]) {
      expect(fs.readFileSync(path.join(root, file), 'utf8')).toBe(value);
    }
  });

  it('leaves files intact when the daemon cannot be stopped', async () => {
    stopNexus.mockRejectedValue(new Error('stop failed'));
    expect(await providers.get('reinstallComponent')!({ component: 'nexus' })).toEqual({ success: false, msg: 'stop failed' });
    expect(dynamicNexusVfsService.checkInstalledSync()).toBe(true);
    expect(startup).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== 'darwin')('defers a stale FUSE plugin without requiring it for core readiness', async () => {
    libraryAccess.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    for (const installer of nexusPluginInstallers) installer.prepareForStartup();
    expect(dynamicNexusVfsService.checkInstalledSync()).toBe(true);
    const names = fs.readdirSync(path.join(root, '.nexus-vfs/plugins'));
    expect(names).not.toContain('libnexus_fuse_plugin.dylib');
    expect(names).toContain('libnexus_vault.dylib');
    expect(names).toContain('libnexus_local_connector.dylib');
    libraryAccess.mockImplementation(() => {});
    expect(dynamicNexusVfsService.checkInstalledSync()).toBe(false);
  });
});
