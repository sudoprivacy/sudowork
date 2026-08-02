import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@process/utils/mainLogger', () => ({
  mainError: vi.fn(),
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
}));

vi.mock('@/process/services/initStatus', () => ({
  initStatusManager: {
    addLog: vi.fn(),
    clearRetry: vi.fn(),
    getStatus: vi.fn(() => ({ stepDetails: {}, displayMode: 'startup' })),
    setDetail: vi.fn(),
    setStatus: vi.fn(),
    setStepProgress: vi.fn(),
    setStepState: vi.fn(),
  },
}));

vi.mock('@/process/services/serviceManager/RuntimeInstaller', () => ({
  runtimeInstaller: {
    ensureAll: vi.fn(),
    primeStatusForStartup: vi.fn(),
  },
}));

vi.mock('@/process/services/serviceManager/ComponentHealthMonitor', () => ({
  componentHealthMonitor: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

import { ServiceManager } from '@/process/services/serviceManager/ServiceManager';
import { runtimeInstaller } from '@/process/services/serviceManager/RuntimeInstaller';
import { initStatusManager } from '@/process/services/initStatus';

type TestableServiceManager = ServiceManager & {
  startNexusWithRetries: () => Promise<void>;
  startNexusOnce: () => Promise<void>;
  initializeSecretsAfterNexus: () => Promise<void>;
  preparePortForStart: () => Promise<void>;
  startSudoclawWithRetries: () => Promise<void>;
  verifyStartupReadiness: () => Promise<void>;
  startSafetyPolling: () => Promise<void>;
};

describe('ServiceManager', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('deduplicates concurrent Sudoclaw starts', async () => {
    const manager = new ServiceManager() as TestableServiceManager;
    const startSudoclawWithRetries = vi.spyOn(manager, 'startSudoclawWithRetries').mockImplementation(
      async () =>
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 20);
        })
    );

    await Promise.all([manager.startSudoclaw(), manager.startSudoclaw(), manager.startSudoclaw()]);

    expect(startSudoclawWithRetries).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent Nexus starts', async () => {
    const manager = new ServiceManager() as TestableServiceManager;
    const startNexusWithRetries = vi.spyOn(manager, 'startNexusWithRetries').mockImplementation(
      async () =>
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 20);
        })
    );

    await Promise.all([manager.startNexus(), manager.startNexus(), manager.startNexus()]);

    expect(startNexusWithRetries).toHaveBeenCalledTimes(1);
  });

  it('does not restart Nexus when secrets initialization fails', async () => {
    const manager = new ServiceManager() as TestableServiceManager;
    vi.spyOn(manager, 'preparePortForStart').mockResolvedValue(undefined);
    const startNexusOnce = vi.spyOn(manager, 'startNexusOnce').mockResolvedValue(undefined);
    vi.spyOn(manager, 'initializeSecretsAfterNexus').mockRejectedValue(new Error('keychain unavailable'));

    await expect(manager.startNexusWithRetries()).rejects.toThrow('keychain unavailable');
    expect(startNexusOnce).toHaveBeenCalledTimes(1);
  });

  it('starts up without requesting Sudoclaw startup', async () => {
    const manager = new ServiceManager() as TestableServiceManager;
    vi.mocked(runtimeInstaller.ensureAll).mockResolvedValue(true);
    vi.mocked(initStatusManager.getStatus).mockReturnValue({ stepDetails: {}, displayMode: 'startup' });
    vi.spyOn(manager, 'verifyStartupReadiness').mockResolvedValue(undefined);
    vi.spyOn(manager, 'startSafetyPolling').mockResolvedValue(undefined);

    await manager.startup();

    expect(runtimeInstaller.ensureAll).toHaveBeenCalledTimes(1);
    expect(runtimeInstaller.ensureAll).toHaveBeenCalledWith({
      startNexus: expect.any(Function),
    });
  });

  it('creates a fresh secrets readiness promise when startup is retried', async () => {
    const manager = new ServiceManager() as TestableServiceManager;
    vi.mocked(initStatusManager.getStatus).mockReturnValue({ stepDetails: {}, displayMode: 'startup' });
    vi.mocked(runtimeInstaller.ensureAll).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    vi.spyOn(manager, 'verifyStartupReadiness').mockResolvedValue(undefined);

    await manager.startup();
    expect(await manager.waitForSecrets()).toBe(false);

    await manager.startup();
    const retrySecrets = manager.waitForSecrets();
    const secretsReadyResolve = (manager as unknown as { secretsReadyResolve: (isReady: boolean) => void }).secretsReadyResolve;
    secretsReadyResolve(true);

    expect(await retrySecrets).toBe(true);
  });
});
