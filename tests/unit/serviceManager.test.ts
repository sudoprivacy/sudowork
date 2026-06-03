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
  verifyStartupReadiness: () => Promise<void>;
  startSafetyPolling: () => Promise<void>;
};

describe('ServiceManager', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
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
});
