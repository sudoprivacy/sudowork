import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStatusProvider: vi.fn(),
  retryStartupProvider: vi.fn(),
  reinstallComponentProvider: vi.fn(),
  quitAppProvider: vi.fn(),
  emitStatus: vi.fn(),
  getStatus: vi.fn(),
  subscribe: vi.fn(),
  exit: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { exit: mocks.exit },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    init: {
      getStatus: { provider: mocks.getStatusProvider },
      retryStartup: { provider: mocks.retryStartupProvider },
      reinstallComponent: { provider: mocks.reinstallComponentProvider },
      onStatusChange: { emit: mocks.emitStatus },
      quitApp: { provider: mocks.quitAppProvider },
    },
  },
}));

vi.mock('@/process/services/initStatus', () => ({
  initStatusManager: {
    getStatus: mocks.getStatus,
    subscribe: mocks.subscribe,
  },
}));

import { initInitBridge } from '@/process/bridge/initBridge';

describe('initInitBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replays the current status after registering the provider', () => {
    const status = { phase: 'pending', message: '准备初始化...', progress: 0 } as const;
    mocks.getStatus.mockReturnValue(status);

    initInitBridge();

    expect(mocks.getStatusProvider).toHaveBeenCalledOnce();
    expect(mocks.subscribe).toHaveBeenCalledOnce();
    expect(mocks.emitStatus).toHaveBeenCalledWith(status);
  });
});
