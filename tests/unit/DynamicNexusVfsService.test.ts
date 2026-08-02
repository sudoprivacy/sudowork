import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildMode = vi.hoisted(() => ({ isOffline: false }));
const listSecrets = vi.fn();
const processKill = vi.fn();
const processSupervisorTrack = vi.fn();
const mainError = vi.fn();
const spawnMock = vi.fn();
const execMock = vi.fn();
const connectMock = vi.fn();
const existsSyncMock = vi.fn();

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    processKill(signal);
    this.exitCode = 0;
    this.emit('exit', 0, signal ?? null);
    return true;
  }
}

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/sudowork-test-home'),
    getAppPath: vi.fn(() => '/tmp/sudowork-test-app'),
    isPackaged: false,
  },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: existsSyncMock,
    mkdirSync: vi.fn(),
  };
});

vi.mock('net', () => ({
  default: { connect: connectMock },
  connect: connectMock,
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: spawnMock,
    exec: execMock,
  };
});

vi.mock('@/common/buildMode', () => ({
  get IS_OFFLINE_BUILD() {
    return buildMode.isOffline;
  },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError,
}));

vi.mock('@process/ProcessSupervisor', () => ({
  processSupervisor: {
    track: processSupervisorTrack,
  },
}));

vi.mock('@common/nexus/nexus-secret-client', () => ({
  getNexusSecretClient: () => ({ listSecrets }),
}));

vi.mock('@/shared/runtime-versions.json', () => ({
  default: { 'nexus-vfs': '0.4.0', 'nexus-vault': '0.4.0' },
}));

vi.mock('@/shared/runtime-sha256.json', () => ({
  default: {},
}));

vi.mock('@/shared/cos', () => ({
  COS_RUNTIME_BASE: 'https://runtime.invalid',
  COS_LEGACY_NEXUS_VFS_BASE: 'https://legacy.invalid',
}));

vi.mock('@process/services/archiveProgress', () => ({
  extractTarGzWithProgress: vi.fn(),
  extractZipWithProgress: vi.fn(),
}));

vi.mock('@process/services/nexus-vfs/VaultPluginInstaller', () => ({
  vaultPluginInstaller: {
    checkInstalledSync: vi.fn(() => true),
    install: vi.fn(),
    isPlatformSupported: vi.fn(() => true),
  },
}));

function mockPortSequence(results: boolean[]): void {
  let callCount = 0;
  connectMock.mockImplementation((_port: number, _host: string, onConnect: () => void) => {
    const socket = new EventEmitter() as EventEmitter & { destroy: () => void };
    socket.destroy = vi.fn();
    const result = results[Math.min(callCount, results.length - 1)];
    callCount += 1;
    queueMicrotask(() => {
      if (result) {
        onConnect();
      } else {
        socket.emit('error', new Error('ECONNREFUSED'));
      }
    });
    return socket;
  });
}

describe('DynamicNexusVfsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    buildMode.isOffline = false;
    vi.useRealTimers();
    existsSyncMock.mockReturnValue(true);
    execMock.mockImplementation((_cmd: string, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      cb(null, '', '');
      return new EventEmitter();
    });
    spawnMock.mockReturnValue(new FakeChildProcess());
    mockPortSequence([false, true]);
  });

  it('fails startup when the vault plugin is installed but password-vault is not registered', async () => {
    vi.useFakeTimers();
    listSecrets.mockImplementation(() => {
      throw new Error('gRPC call failed: {"code":-32603,"message":"service not found: password-vault"}');
    });

    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');
    const startPromise = dynamicNexusVfsService.start();
    const startError = startPromise.then(
      () => null,
      (err: unknown) => err
    );
    await vi.runAllTimersAsync();

    const err = await startError;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('password-vault service is unavailable');
    expect(mainError).toHaveBeenCalledWith('NexusVfs', expect.stringContaining('service not found: password-vault'));
    expect(processKill).toHaveBeenCalledWith('SIGTERM');
  });

  it('marks startup ready once the vault service responds', async () => {
    listSecrets.mockReturnValue([]);

    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');
    await dynamicNexusVfsService.start();

    expect(listSecrets).toHaveBeenCalledWith('__sudowork_startup_probe__', false);
    expect(dynamicNexusVfsService.isRunning).toBe(true);
  });

  it('starts offline without loading or probing the vault plugin', async () => {
    buildMode.isOffline = true;
    listSecrets.mockImplementation(() => {
      throw new Error('password-vault unavailable');
    });

    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');
    await dynamicNexusVfsService.start();

    expect(spawnMock).toHaveBeenCalledWith(expect.any(String), expect.not.arrayContaining(['--plugin-dir']), expect.any(Object));
    expect(listSecrets).not.toHaveBeenCalled();
    expect(dynamicNexusVfsService.isRunning).toBe(true);
  });
});
