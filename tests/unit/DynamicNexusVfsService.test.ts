import { spawn } from 'child_process';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn((value: unknown) => String(value).includes('nexusd-cluster')),
  mkdirSync: vi.fn(),
}));

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return '/mock-home';
      return '/mock-app';
    },
    isPackaged: false,
    getAppPath: () => '/mock-app',
  },
}));

// Mock fs binary checks and directory creation
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: fsMocks.existsSync,
    mkdirSync: fsMocks.mkdirSync,
  };
});

// Mock child_process spawn
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  exec: vi.fn(() => Promise.resolve({ stdout: '', stderr: '' })),
}));

// Mock processSupervisor
vi.mock('@process/ProcessSupervisor', () => ({
  processSupervisor: {
    track: vi.fn(),
  },
}));

// Mock archiveProgress
vi.mock('@process/services/archiveProgress', () => ({
  extractTarGzWithProgress: vi.fn(),
  extractZipWithProgress: vi.fn(),
}));

// Mock VaultPluginInstaller
vi.mock('@process/services/nexus-vfs/VaultPluginInstaller', () => ({
  vaultPluginInstaller: {
    isPlatformSupported: () => false,
    checkInstalledSync: () => false,
    install: vi.fn(),
  },
}));

// Mock logger
vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

describe('DynamicNexusVfsService', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    vi.resetModules();
    originalEnv = { ...process.env };
    vi.clearAllMocks();

    // Create a mock process for spawn
    const mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      exitCode: null,
      signalCode: null,
      killed: false,
      pid: 12345,
    };
    (spawn as Mock).mockReturnValue(mockProcess);
  });

  afterEach(async () => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('start()', () => {
    it('passes NEXUS_DATA_DIR environment variable to spawned process', async () => {
      const { dynamicNexusVfsService } = await import('../../src/process/services/nexus-vfs/DynamicNexusVfsService');

      // Mock internal methods to avoid real port checks
      vi.spyOn(dynamicNexusVfsService as any, 'checkInstalledSync').mockReturnValue(true);
      vi.spyOn(dynamicNexusVfsService as any, 'isPortInUse').mockResolvedValue(false);
      vi.spyOn(dynamicNexusVfsService as any, 'waitForPortReady').mockResolvedValue(undefined);

      await dynamicNexusVfsService.start();

      expect(spawn).toHaveBeenCalled();
      const spawnCall = (spawn as Mock).mock.calls[0];
      const spawnOptions = spawnCall[2];

      expect(spawnOptions).toBeDefined();
      expect(spawnOptions.env).toBeDefined();
      expect(spawnOptions.env.NEXUS_DATA_DIR).toBe('/mock-home/.nexus-vfs/data');
    });

    it('sets cwd to install root (~/.nexus-vfs) for stable working directory', async () => {
      const { dynamicNexusVfsService } = await import('../../src/process/services/nexus-vfs/DynamicNexusVfsService');

      vi.spyOn(dynamicNexusVfsService as any, 'checkInstalledSync').mockReturnValue(true);
      vi.spyOn(dynamicNexusVfsService as any, 'isPortInUse').mockResolvedValue(false);
      vi.spyOn(dynamicNexusVfsService as any, 'waitForPortReady').mockResolvedValue(undefined);

      await dynamicNexusVfsService.start();

      const spawnCall = (spawn as Mock).mock.calls[0];
      const spawnOptions = spawnCall[2];

      expect(spawnOptions.cwd).toBe('/mock-home/.nexus-vfs');
    });

    it('inherits process.env in spawn options', async () => {
      const { dynamicNexusVfsService } = await import('../../src/process/services/nexus-vfs/DynamicNexusVfsService');

      vi.spyOn(dynamicNexusVfsService as any, 'checkInstalledSync').mockReturnValue(true);
      vi.spyOn(dynamicNexusVfsService as any, 'isPortInUse').mockResolvedValue(false);
      vi.spyOn(dynamicNexusVfsService as any, 'waitForPortReady').mockResolvedValue(undefined);

      // Set a test env var
      process.env.TEST_VAR = 'test-value';

      await dynamicNexusVfsService.start();

      const spawnCall = (spawn as Mock).mock.calls[0];
      const spawnOptions = spawnCall[2];

      expect(spawnOptions.env.TEST_VAR).toBe('test-value');
    });
  });
});
