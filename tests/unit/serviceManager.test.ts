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

import { ServiceManager } from '@/process/services/serviceManager/ServiceManager';

type TestableServiceManager = ServiceManager & {
  startNexusWithRetries: () => Promise<void>;
  startOpenClawWithRetries: () => Promise<void>;
};

describe('ServiceManager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deduplicates concurrent Sudoclaw starts', async () => {
    const manager = new ServiceManager() as TestableServiceManager;
    const startOpenClawWithRetries = vi.spyOn(manager, 'startOpenClawWithRetries').mockImplementation(
      async () =>
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 20);
        })
    );

    await Promise.all([manager.startOpenClaw(), manager.startOpenClaw(), manager.startOpenClaw()]);

    expect(startOpenClawWithRetries).toHaveBeenCalledTimes(1);
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
});
