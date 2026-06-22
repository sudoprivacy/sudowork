import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

const originalPlatform = process.platform;
function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

describe('FuseTInstallService', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    vi.restoreAllMocks();
  });

  it('checkInstalled returns not-installed on non-darwin platforms (windows)', async () => {
    setPlatform('win32');
    const { FuseTInstallService } = await import('../../src/process/services/fuset/FuseTInstallService');
    const svc = new FuseTInstallService();
    const status = await svc.checkInstalled();
    expect(status.installed).toBe(false);
    expect(status.bundlePath).toBeUndefined();
  });

  it('checkInstalled returns not-installed on non-darwin platforms (linux)', async () => {
    setPlatform('linux');
    const { FuseTInstallService } = await import('../../src/process/services/fuset/FuseTInstallService');
    const svc = new FuseTInstallService();
    const status = await svc.checkInstalled();
    expect(status.installed).toBe(false);
  });

  it('checkInstalled reports installed when the FUSE-T bundle exists on darwin', async () => {
    setPlatform('darwin');
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        promises: { ...actual.promises, access: vi.fn().mockResolvedValue(undefined) },
      };
    });
    const { FuseTInstallService } = await import('../../src/process/services/fuset/FuseTInstallService');
    const svc = new FuseTInstallService();
    const status = await svc.checkInstalled();
    expect(status.installed).toBe(true);
    expect(status.bundlePath).toBe('/Library/Filesystems/fuse-t.fs');
    expect(status.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('checkInstalled reports not-installed when the bundle is absent on darwin', async () => {
    setPlatform('darwin');
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        promises: { ...actual.promises, access: vi.fn().mockRejectedValue(new Error('ENOENT')) },
      };
    });
    const { FuseTInstallService } = await import('../../src/process/services/fuset/FuseTInstallService');
    const svc = new FuseTInstallService();
    const status = await svc.checkInstalled();
    expect(status.installed).toBe(false);
  });

  it('ensureInstalled is a no-op when FUSE-T is already provisioned', async () => {
    setPlatform('darwin');
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        promises: { ...actual.promises, access: vi.fn().mockResolvedValue(undefined) },
      };
    });
    const execFileSpy = vi.fn((_cmd: string, _args: string[], cb: (e: Error | null) => void) => cb(null));
    vi.doMock('child_process', async () => {
      const actual = await vi.importActual<typeof import('child_process')>('child_process');
      return { ...actual, execFile: execFileSpy };
    });
    const { FuseTInstallService } = await import('../../src/process/services/fuset/FuseTInstallService');
    const svc = new FuseTInstallService();
    await svc.ensureInstalled();
    // No osascript spawn — bundle already present, install short-circuits.
    expect(execFileSpy).not.toHaveBeenCalled();
  });

  it('ensureInstalled refuses to run on non-darwin', async () => {
    setPlatform('linux');
    const { FuseTInstallService } = await import('../../src/process/services/fuset/FuseTInstallService');
    const svc = new FuseTInstallService();
    await expect(svc.ensureInstalled()).rejects.toThrow(/macOS-only/);
  });

  it('install refuses to run on non-darwin', async () => {
    setPlatform('win32');
    const { FuseTInstallService } = await import('../../src/process/services/fuset/FuseTInstallService');
    const svc = new FuseTInstallService();
    await expect(svc.install()).rejects.toThrow(/macOS-only/);
  });
});
