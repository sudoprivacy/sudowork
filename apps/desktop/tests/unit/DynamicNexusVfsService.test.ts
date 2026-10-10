import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listSecrets = vi.fn();
const serverInfo = vi.fn();
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

vi.mock('@common/nexus/nexus-vfs-client', () => ({
  getNexusRpcClient: () => ({ serverInfo }),
}));

vi.mock('@/shared/runtime-versions.json', () => ({
  default: { 'nexus-vfs': '0.4.0', 'nexus-vault': '0.4.0' },
}));

vi.mock('@/shared/runtime-sha256.json', () => ({
  default: {},
}));

vi.mock('@sudowork/common/cos', () => ({
  COS_RUNTIME_BASE: 'https://runtime.invalid',
  COS_LEGACY_NEXUS_VFS_BASE: 'https://legacy.invalid',
}));

vi.mock('@process/services/archiveProgress', () => ({
  extractTarGzWithProgress: vi.fn(),
  extractZipWithProgress: vi.fn(),
}));

vi.mock('@process/services/nexus-vfs/VaultPluginInstaller', () => {
  const vaultPluginInstaller = {
    checkInstalledSync: vi.fn(() => true),
    install: vi.fn(),
    isPlatformSupported: vi.fn(() => true),
    isRuntimeSupported: vi.fn(() => true),
    prepareForStartup: vi.fn(),
    removeInstallation: vi.fn(),
  };
  return { vaultPluginInstaller, nexusPluginInstallers: [vaultPluginInstaller] };
});

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
    vi.useRealTimers();
    existsSyncMock.mockReturnValue(true);
    execMock.mockImplementation((_cmd: string, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      cb(null, '', '');
      return new EventEmitter();
    });
    spawnMock.mockReturnValue(new FakeChildProcess());
    mockPortSequence([false, true]);
    serverInfo.mockResolvedValue({ version: 'nexusd-cluster', zone_id: 'root' });
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

  it('refuses an occupied endpoint without spawning or stopping its listener', async () => {
    mockPortSequence([true]);
    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');

    await expect(dynamicNexusVfsService.start()).rejects.toThrow('already in use by another process');
    await dynamicNexusVfsService.stop();

    expect(spawnMock).not.toHaveBeenCalled();
    expect(execMock).not.toHaveBeenCalled();
    expect(processKill).not.toHaveBeenCalled();
    expect(dynamicNexusVfsService.acpTunnelEndpoint).toBeNull();
  });

  it('does not report an unrelated listener as its running daemon', async () => {
    mockPortSequence([true]);
    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');

    expect(await dynamicNexusVfsService.checkActualRunning()).toBe(false);
    expect(dynamicNexusVfsService.acpTunnelEndpoint).toBeNull();
  });

  it('recovers a transient health failure without starting another child', async () => {
    listSecrets.mockReturnValue([]);
    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');
    await dynamicNexusVfsService.start();
    serverInfo.mockRejectedValueOnce(new Error('temporary RPC failure'));

    expect(await dynamicNexusVfsService.checkActualRunning()).toBe(false);
    expect(await dynamicNexusVfsService.checkActualRunning()).toBe(true);
    await dynamicNexusVfsService.start();
    expect(spawnMock).toHaveBeenCalledOnce();
    await dynamicNexusVfsService.stop();
  });

  it('retains its installation while an unhealthy owned process is alive', async () => {
    listSecrets.mockReturnValue([]);
    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');
    await dynamicNexusVfsService.start();
    serverInfo.mockRejectedValueOnce(new Error('temporary RPC failure'));
    expect(await dynamicNexusVfsService.checkActualRunning()).toBe(false);

    await expect(dynamicNexusVfsService.install()).rejects.toThrow('please stop it first');
    expect(() => dynamicNexusVfsService.removeInstallation()).toThrow('Stop the owned Nexus process');
    await dynamicNexusVfsService.stop();
  });

  it('starts one child for concurrent startup requests and stops that child', async () => {
    listSecrets.mockReturnValue([]);
    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');

    await Promise.all([dynamicNexusVfsService.start(), dynamicNexusVfsService.start(), dynamicNexusVfsService.start()]);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    await dynamicNexusVfsService.stop();
    expect(processKill).toHaveBeenCalledOnce();
    expect(processKill).toHaveBeenCalledWith('SIGTERM');
    expect(dynamicNexusVfsService.isRunning).toBe(false);
  });

  it('finishes an in-flight startup before stopping its owned child', async () => {
    let onVaultReady: (value: unknown[]) => void = () => {};
    listSecrets.mockReturnValue(new Promise((resolve) => (onVaultReady = resolve)));
    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');
    const starting = dynamicNexusVfsService.start();
    await vi.waitFor(() => expect(listSecrets).toHaveBeenCalled());
    const stopping = dynamicNexusVfsService.stop();
    onVaultReady([]);
    await Promise.all([starting, stopping]);

    expect(processKill).toHaveBeenCalledWith('SIGTERM');
    expect(dynamicNexusVfsService.isRunning).toBe(false);
    expect(dynamicNexusVfsService.acpTunnelEndpoint).toBeNull();
  });

  it('escalates termination of its own child even after SIGTERM was sent', async () => {
    vi.useFakeTimers();
    listSecrets.mockReturnValue([]);
    const child = new FakeChildProcess();
    child.kill = (signal?: NodeJS.Signals): boolean => {
      child.killed = true;
      processKill(signal);
      if (signal === 'SIGKILL') {
        child.signalCode = signal;
        child.emit('exit', null, signal);
      }
      return true;
    };
    spawnMock.mockReturnValue(child);
    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');
    await dynamicNexusVfsService.start();
    const stopping = dynamicNexusVfsService.stop();
    await vi.advanceTimersByTimeAsync(3000);
    await stopping;

    expect(processKill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expect(execMock).not.toHaveBeenCalled();
  });

  it('names a Windows heap-corruption crash instead of logging a bare number', async () => {
    listSecrets.mockReturnValue([]);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');
    await dynamicNexusVfsService.start();

    // 0xC0000374, as Node surfaces it on Windows — unsigned, not a negative
    // int32. Getting that wrong makes the lookup silently never match.
    child.emit('exit', 3221226356, null);

    expect(mainError).toHaveBeenCalledWith('NexusVfs', expect.stringContaining('heap corruption'));
    expect(mainError).toHaveBeenCalledWith('NexusVfs', expect.stringContaining('plugin-ABI-v5'));
    expect(dynamicNexusVfsService.isRunning).toBe(false);
  });

  it('stays quiet on an ordinary exit', async () => {
    listSecrets.mockReturnValue([]);
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);

    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');
    await dynamicNexusVfsService.start();
    child.emit('exit', 0, null);

    expect(mainError).not.toHaveBeenCalled();
  });

  it('proves the root zone serves rather than trusting the accepted connection', async () => {
    listSecrets.mockReturnValue([]);

    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');
    await dynamicNexusVfsService.start();

    expect(serverInfo).toHaveBeenCalled();
  });

  it('refuses a reply that names no zone', async () => {
    vi.useFakeTimers();
    // A daemon answering the RPC while serving no zone is the case the port
    // check cannot see. An empty answer must not read as ready.
    serverInfo.mockResolvedValue({ version: 'nexusd-cluster' });
    listSecrets.mockReturnValue([]);

    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');
    const startPromise = dynamicNexusVfsService.start();
    const startError = startPromise.then(
      () => null,
      (err: unknown) => err
    );
    await vi.runAllTimersAsync();

    const err = await startError;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('root zone did not serve');
    expect(dynamicNexusVfsService.isRunning).toBe(false);
  });

  it('fails startup when the port accepts but the root zone cannot serve', async () => {
    vi.useFakeTimers();
    // The shape upstream introduced: the daemon binds and accepts, but a zone
    // only materializes on first access, so the socket says nothing about it.
    serverInfo.mockRejectedValue(new Error('RPC error: serverInfo: zone not available'));
    listSecrets.mockReturnValue([]);

    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');
    const startPromise = dynamicNexusVfsService.start();
    const startError = startPromise.then(
      () => null,
      (err: unknown) => err
    );
    await vi.runAllTimersAsync();

    const err = await startError;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('root zone did not serve');
    expect(dynamicNexusVfsService.isRunning).toBe(false);
    expect(processKill).toHaveBeenCalledWith('SIGTERM');
  });

  it('still proves the zone when the vault plugin is absent', async () => {
    vi.useFakeTimers();
    // This is the branch that mattered: the vault probe returns early without
    // the plugin, so before the zone probe existed this path degraded to a bare
    // TCP check and reported ready for a daemon that could not serve.
    const { vaultPluginInstaller } = await import('@process/services/nexus-vfs/VaultPluginInstaller');
    vi.mocked(vaultPluginInstaller.checkInstalledSync).mockReturnValue(false);
    serverInfo.mockRejectedValue(new Error('RPC error: serverInfo: zone not available'));

    const { dynamicNexusVfsService } = await import('@process/services/nexus-vfs/DynamicNexusVfsService');
    const startPromise = dynamicNexusVfsService.start();
    const startError = startPromise.then(
      () => null,
      (err: unknown) => err
    );
    await vi.runAllTimersAsync();

    const err = await startError;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('root zone did not serve');
    expect(listSecrets).not.toHaveBeenCalled();
    expect(dynamicNexusVfsService.isRunning).toBe(false);
  });
});
