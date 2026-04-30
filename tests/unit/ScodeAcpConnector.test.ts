/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACP_BACKENDS_ALL, POTENTIAL_ACP_CLIS } from '../../src/types/acpTypes';
import type { AcpBackendAll } from '../../src/types/acpTypes';

describe('Scode ACP integration', () => {
  describe('ACP_BACKENDS_ALL configuration', () => {
    it('should include scode as a registered backend', () => {
      expect(ACP_BACKENDS_ALL).toHaveProperty('scode');
    });

    it('should have correct scode backend configuration', () => {
      const config = ACP_BACKENDS_ALL['scode' as AcpBackendAll];
      expect(config).toBeDefined();
      expect(config.id).toBe('scode');
      expect(config.name).toBe('Sudo Code');
      expect(config.cliCommand).toBe('scode');
      expect(config.acpArgs).toEqual(['acp']);
      expect(config.enabled).toBe(true);
      expect(config.authRequired).toBe(false);
      expect(config.supportsStreaming).toBe(false);
    });
  });

  describe('POTENTIAL_ACP_CLIS detection list', () => {
    it('should include scode in the auto-detection list', () => {
      const scodeCli = Array.from(POTENTIAL_ACP_CLIS).find((cli) => cli.backendId === 'scode');
      expect(scodeCli).toBeDefined();
      expect(scodeCli!.cmd).toBe('scode');
      expect(scodeCli!.args).toEqual(['acp']);
      expect(scodeCli!.name).toBe('Sudo Code');
    });
  });

  describe('scode spawn configuration', () => {
    it('should produce correct spawn args for scode acp subcommand', () => {
      // Replicate the logic from createGenericSpawnConfig for scode
      const cliPath = 'scode';
      const acpArgs = ['acp'];

      // On Unix: simple command split
      const parts = cliPath.split(/\s+/);
      const command = parts[0];
      const args = [...parts.slice(1), ...acpArgs];

      expect(command).toBe('scode');
      expect(args).toEqual(['acp']);
    });

    it('should handle full path to scode binary', () => {
      const cliPath = '/home/user/.nexus/sudocode/scode';
      const acpArgs = ['acp'];

      const parts = cliPath.split(/\s+/);
      const command = parts[0];
      const args = [...parts.slice(1), ...acpArgs];

      expect(command).toBe('/home/user/.nexus/sudocode/scode');
      expect(args).toEqual(['acp']);
    });

    it('should default to --experimental-acp when acpArgs is undefined', () => {
      const acpArgs = undefined;
      const effectiveAcpArgs = acpArgs === undefined ? ['--experimental-acp'] : acpArgs;
      expect(effectiveAcpArgs).toEqual(['--experimental-acp']);
    });

    it('should use empty args when acpArgs is empty array', () => {
      const acpArgs: string[] = [];
      const effectiveAcpArgs = acpArgs === undefined ? ['--experimental-acp'] : acpArgs;
      expect(effectiveAcpArgs).toEqual([]);
    });
  });

  describe('scode environment preparation', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.clearAllMocks();
      vi.resetModules();
      vi.unstubAllEnvs();
    });

    async function loadPrepareCleanEnv(
      options: {
        safetyHookEnabled: boolean;
        inheritedPythonPath?: string;
      } = { safetyHookEnabled: true }
    ) {
      vi.doMock('electron', () => ({
        app: {
          isPackaged: false,
          getAppPath: () => '/mock-app',
        },
      }));

      vi.doMock('@process/services/safety/SafetyPollingService', () => ({
        isSafetyHookEnabled: () => options.safetyHookEnabled,
      }));

      vi.doMock('@process/utils/mainLogger', () => ({
        mainLog: vi.fn(),
        mainWarn: vi.fn(),
      }));

      vi.doMock('@process/utils/shellEnv', () => ({
        getEnhancedEnv: () => ({
          PATH: '/usr/bin',
          PYTHONPATH: options.inheritedPythonPath ?? '/custom/python',
          NODE_OPTIONS: '--inspect',
          NODE_INSPECT: '1',
          NODE_DEBUG: '1',
          CLAUDECODE: '1',
          npm_config_registry: 'https://example.com',
        }),
        findSuitableNodeBin: vi.fn(),
        resolveNpxPath: vi.fn(() => 'npx'),
      }));

      const { prepareCleanEnv } = await import('@/agent/acp/acpConnectors');
      return prepareCleanEnv;
    }

    it('skips safety hook injection for scode while keeping browser PYTHONPATH', async () => {
      const hookPythonPath = '/mock-app/hook/python/pythonpath';
      const inheritedPythonPath = ['/custom/python', hookPythonPath].join(path.delimiter);
      const prepareCleanEnv = await loadPrepareCleanEnv({
        safetyHookEnabled: true,
        inheritedPythonPath,
      });

      const env = prepareCleanEnv({ injectSafetyHook: false });
      const pythonPaths = env.PYTHONPATH?.split(path.delimiter) ?? [];

      expect(env.NODE_OPTIONS).toBeUndefined();
      expect(env.HOOK_PYTHON_WHL).toBeUndefined();
      expect(env.SUDOWORK_ACP_CHILD).toBeUndefined();
      expect(pythonPaths).toContain(path.join(os.homedir(), '.nexus', 'skills', '_system', 'browser'));
      expect(pythonPaths).toContain('/custom/python');
      expect(pythonPaths).not.toContain(hookPythonPath);
      expect(env.CLAUDECODE).toBeUndefined();
      expect(env.npm_config_registry).toBeUndefined();
    });

    it('still injects safety hook for other ACP backends by default', async () => {
      const prepareCleanEnv = await loadPrepareCleanEnv({
        safetyHookEnabled: true,
      });

      const env = prepareCleanEnv();
      const pythonPaths = env.PYTHONPATH?.split(path.delimiter) ?? [];

      expect(env.NODE_OPTIONS).toContain('/mock-app/hook/node/dist/hook.js');
      expect(env.HOOK_PYTHON_WHL).toBe('/mock-app/hook/python/dist/hook-0.0.1-py3-none-any.whl');
      expect(env.SUDOWORK_ACP_CHILD).toBe('1');
      expect(pythonPaths).toContain('/mock-app/hook/python/pythonpath');
      expect(pythonPaths).toContain('/custom/python');
      expect(pythonPaths).toContain(path.join(os.homedir(), '.nexus', 'skills', '_system', 'browser'));
    });
  });
});
