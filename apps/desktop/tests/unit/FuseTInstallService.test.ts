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

  it('checkInstalled prefers the FSKit framework path when both candidates exist (1.2+ users)', async () => {
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
    // FSKit framework path is probed first — keeps detection consistent
    // with what `installer -pkg` writes on a fresh 1.2+ install.
    expect(status.bundlePath).toBe('/Library/Frameworks/fuse_t.framework');
    expect(status.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('checkInstalled falls back to the legacy filesystem bundle path (1.0 / 1.1 users)', async () => {
    setPlatform('darwin');
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        promises: {
          ...actual.promises,
          access: vi.fn().mockImplementation((p: string) => (p === '/Library/Filesystems/fuse-t.fs' ? Promise.resolve(undefined) : Promise.reject(new Error('ENOENT')))),
        },
      };
    });
    const { FuseTInstallService } = await import('../../src/process/services/fuset/FuseTInstallService');
    const svc = new FuseTInstallService();
    const status = await svc.checkInstalled();
    expect(status.installed).toBe(true);
    expect(status.bundlePath).toBe('/Library/Filesystems/fuse-t.fs');
  });

  it('checkInstalled uses pkgutil registry as the last-resort fallback (future layout)', async () => {
    setPlatform('darwin');
    // Both bundle candidates absent — only the pkgutil registry knows
    // FUSE-T is installed. Simulates a future layout shift where the
    // installer drops files outside both of today's known paths.
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        promises: { ...actual.promises, access: vi.fn().mockRejectedValue(new Error('ENOENT')) },
      };
    });
    vi.doMock('child_process', async () => {
      const actual = await vi.importActual<typeof import('child_process')>('child_process');
      return {
        ...actual,
        execFile: vi.fn((_cmd: string, args: string[], cb: (e: Error | null, out: { stdout: string; stderr: string }) => void) => {
          if (args[0] === '--pkgs') {
            cb(null, { stdout: 'org.fuse-t.fskit.1.2.7\norg.fuse-t.core.1.2.7\n', stderr: '' });
            return;
          }
          cb(null, { stdout: '', stderr: '' });
        }),
      };
    });
    const { FuseTInstallService } = await import('../../src/process/services/fuset/FuseTInstallService');
    const svc = new FuseTInstallService();
    const status = await svc.checkInstalled();
    expect(status.installed).toBe(true);
    expect(status.bundlePath).toBe('pkgutil:org.fuse-t.*');
  });

  it('checkInstalled reports not-installed when all probes miss', async () => {
    setPlatform('darwin');
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        promises: { ...actual.promises, access: vi.fn().mockRejectedValue(new Error('ENOENT')) },
      };
    });
    vi.doMock('child_process', async () => {
      const actual = await vi.importActual<typeof import('child_process')>('child_process');
      return {
        ...actual,
        execFile: vi.fn((_cmd: string, _args: string[], cb: (e: Error | null, out: { stdout: string; stderr: string }) => void) => {
          // pkgutil --pkgs --regexp with no matches exits 1; mirror that.
          cb(new Error('pkgutil: no packages found'), { stdout: '', stderr: '' });
        }),
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
