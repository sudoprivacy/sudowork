/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing AcpDetector
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: vi.fn((fn) => fn),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  statSync: vi.fn(),
}));

vi.mock('@/process/initStorage', () => ({
  ProcessConfig: {
    get: vi.fn(),
  },
}));

vi.mock('@/process/AssistantManager', () => ({
  assistantManager: {
    getInstalledAssistants: vi.fn(),
  },
}));

vi.mock('@/extensions', () => ({
  ExtensionRegistry: {
    getInstance: vi.fn(() => ({
      getAcpAdapters: vi.fn(() => []),
    })),
  },
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: vi.fn(() => ({ PATH: '/usr/bin' })),
}));

vi.mock('@/process/services/sudoclaw/SudoclawInstallService', () => ({
  SUDOCLAW_BIN_DIR: '/tmp/sudoclaw',
}));

vi.mock('@/process/services/scode/ScodeInstallService', () => ({
  getScodePath: vi.fn(() => '/tmp/scode'),
}));

vi.mock('@/process/services/scode/scodePaths', () => ({
  SCODE_HOME: '/tmp/scode-home',
}));

// Import mocked modules to get references
import { ProcessConfig } from '../../src/process/initStorage';
import { assistantManager } from '../../src/process/AssistantManager';

describe('AcpDetector - addCustomAgentsToList', () => {
  let AcpDetectorClass: typeof import('@/agent/acp/AcpDetector');
  let acpDetector: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock exec to always fail (no CLI tools installed)
    const { exec } = await import('child_process');
    (exec as any).mockImplementation((_cmd: string, _opts: any, callback: any) => {
      callback(new Error('Command not found'));
    });

    // Re-import AcpDetector module
    vi.resetModules();
    AcpDetectorClass = await import('../../src/agent/acp/AcpDetector');
    // Access the class from the module and instantiate it
    const AcpDetector = (AcpDetectorClass as any).default?.AcpDetector || (AcpDetectorClass as any).AcpDetector;
    if (!AcpDetector) {
      // Use the singleton instance directly
      acpDetector = (AcpDetectorClass as any).acpDetector;
      // Reset its state
      (acpDetector as any).detectedAgents = [];
      (acpDetector as any).isDetected = false;
    } else {
      acpDetector = new AcpDetector();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects config preset when filesystem is empty', async () => {
    // Arrange: filesystem has no assistants, but config has builtin-gewu preset
    vi.mocked(assistantManager.getInstalledAssistants).mockResolvedValue([]);

    vi.mocked(ProcessConfig.get).mockResolvedValue([
      {
        id: 'builtin-gewu',
        name: 'Gewu',
        enabled: true,
        isPreset: true,
        avatar: '🔍',
        presetAgentType: 'scode',
      },
    ]);

    // Act
    await acpDetector.initialize();
    const detected = acpDetector.getDetectedAgents();

    // Assert: builtin-gewu should be detected with metadata preserved
    const gewuAgent = detected.find((a) => a.customAgentId === 'builtin-gewu');
    expect(gewuAgent).toBeDefined();
    expect(gewuAgent?.name).toBe('Gewu');
    expect(gewuAgent?.isPreset).toBe(true);
    expect(gewuAgent?.avatar).toBe('🔍');
    expect(gewuAgent?.presetAgentType).toBe('scode');
    expect(gewuAgent?.backend).toBe('custom');
  });

  it('does not create duplicate when filesystem provides same ID', async () => {
    // Arrange: filesystem already has builtin-gewu, config also has it
    vi.mocked(assistantManager.getInstalledAssistants).mockResolvedValue([
      {
        id: 'gewu-123',
        name: 'Gewu',
        isBuiltin: true,
        isHubInstalled: false,
        enabled: true,
        category: 'system',
        meta: {
          id: 'gewu',
          nameI18n: {
            'zh-CN': 'Gewu助手',
            'en-US': 'Gewu',
          },
          avatar: '🔍',
          presetAgentType: 'scode',
        },
      },
    ]);

    vi.mocked(ProcessConfig.get).mockResolvedValue([
      {
        id: 'builtin-gewu',
        name: 'Gewu',
        enabled: true,
        isPreset: true,
        avatar: '🔍',
        presetAgentType: 'scode',
      },
    ]);

    // Act
    await acpDetector.initialize();
    const detected = acpDetector.getDetectedAgents();

    // Assert: only one builtin-gewu should exist
    const gewuAgents = detected.filter((a) => a.customAgentId === 'builtin-gewu');
    expect(gewuAgents).toHaveLength(1);
    expect(gewuAgents[0]?.name).toBe('Gewu助手'); // From filesystem meta (takes precedence)
    expect(gewuAgents[0]?.isPreset).toBe(true);
  });

  it('includes both filesystem and config-only agents without overlap', async () => {
    // Arrange: filesystem has one assistant, config has another
    vi.mocked(assistantManager.getInstalledAssistants).mockResolvedValue([
      {
        id: 'fs-agent-1',
        name: 'FilesystemAgent',
        isBuiltin: false,
        isHubInstalled: true,
        enabled: true,
        category: 'hub',
        meta: {
          id: 'fs-agent',
          nameI18n: {
            'en-US': 'Filesystem Agent',
          },
          avatar: '📁',
        },
      },
    ]);

    vi.mocked(ProcessConfig.get).mockResolvedValue([
      {
        id: 'config-agent',
        name: 'ConfigAgent',
        enabled: true,
        isPreset: false,
        defaultCliPath: '/usr/bin/config-agent',
        acpArgs: ['--mode', 'test'],
      },
    ]);

    // Act
    await acpDetector.initialize();
    const detected = acpDetector.getDetectedAgents();

    // Assert: both agents should be present, no duplicates
    const customAgents = detected.filter((a) => a.backend === 'custom');
    expect(customAgents).toHaveLength(2);

    const fsAgent = customAgents.find((a) => a.customAgentId === 'fs-agent');
    expect(fsAgent).toBeDefined();
    expect(fsAgent?.name).toBe('Filesystem Agent');

    const configAgent = customAgents.find((a) => a.customAgentId === 'config-agent');
    expect(configAgent).toBeDefined();
    expect(configAgent?.name).toBe('ConfigAgent');
    expect(configAgent?.cliPath).toBe('/usr/bin/config-agent');
  });

  it('skips disabled config agents', async () => {
    // Arrange: config has disabled agent
    vi.mocked(assistantManager.getInstalledAssistants).mockResolvedValue([]);

    vi.mocked(ProcessConfig.get).mockResolvedValue([
      {
        id: 'disabled-agent',
        name: 'DisabledAgent',
        enabled: false,
        isPreset: false,
      },
    ]);

    // Act
    await acpDetector.initialize();
    const detected = acpDetector.getDetectedAgents();

    // Assert: disabled agent should not be in detected list
    const disabledAgent = detected.find((a) => a.customAgentId === 'disabled-agent');
    expect(disabledAgent).toBeUndefined();
  });
});
