/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACP_BACKENDS_ALL, POTENTIAL_ACP_CLIS, SCODE_REASONING_ACP_ARGS } from '../../src/types/acpTypes';
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
      expect(config.acpArgs).toEqual(SCODE_REASONING_ACP_ARGS);
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
      expect(scodeCli!.args).toEqual(SCODE_REASONING_ACP_ARGS);
      expect(scodeCli!.name).toBe('Sudo Code');
    });
  });

  describe('scode spawn configuration', () => {
    it('should produce correct spawn args for scode acp subcommand', () => {
      // Replicate the logic from createGenericSpawnConfig for scode
      const cliPath = 'scode';
      const acpArgs = SCODE_REASONING_ACP_ARGS;

      // On Unix: simple command split
      const parts = cliPath.split(/\s+/);
      const command = parts[0];
      const args = [...parts.slice(1), ...acpArgs];

      expect(command).toBe('scode');
      expect(args).toEqual(SCODE_REASONING_ACP_ARGS);
    });

    it('should handle full path to scode binary', () => {
      const cliPath = '/home/user/.nexus/sudocode/scode';
      const acpArgs = SCODE_REASONING_ACP_ARGS;

      const parts = cliPath.split(/\s+/);
      const command = parts[0];
      const args = [...parts.slice(1), ...acpArgs];

      expect(command).toBe('/home/user/.nexus/sudocode/scode');
      expect(args).toEqual(SCODE_REASONING_ACP_ARGS);
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

  describe('scode auth arg resolution', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.clearAllMocks();
      vi.resetModules();
    });

    async function loadResolveScodeAcpArgs() {
      vi.doMock('electron', () => ({
        app: {
          isPackaged: false,
          getAppPath: () => '/mock-app',
        },
      }));

      vi.doMock('@process/services/safety/SafetyPollingService', () => ({
        isSafetyHookEnabled: () => true,
      }));

      vi.doMock('@process/utils/mainLogger', () => ({
        mainLog: vi.fn(),
        mainWarn: vi.fn(),
      }));

      vi.doMock('@process/utils/shellEnv', () => ({
        getEnhancedEnv: () => ({
          PATH: '/usr/bin',
        }),
        findSuitableNodeBin: vi.fn(),
        resolveNpxPath: vi.fn(() => 'npx'),
      }));

      const { resolveScodeAcpArgs } = await import('@/agent/acp/acpConnectors');
      return resolveScodeAcpArgs;
    }

    async function loadScodeAuthHelpers() {
      vi.doMock('electron', () => ({
        app: {
          isPackaged: false,
          getAppPath: () => '/mock-app',
        },
      }));

      vi.doMock('@process/services/safety/SafetyPollingService', () => ({
        isSafetyHookEnabled: () => true,
      }));

      vi.doMock('@process/utils/mainLogger', () => ({
        mainLog: vi.fn(),
        mainWarn: vi.fn(),
      }));

      vi.doMock('@process/utils/shellEnv', () => ({
        getEnhancedEnv: () => ({
          PATH: '/usr/bin',
        }),
        findSuitableNodeBin: vi.fn(),
        resolveNpxPath: vi.fn(() => 'npx'),
      }));

      const { resolveScodeAcpArgs, resolveScodeAuthModeFromConfig } = await import('@/agent/acp/acpConnectors');
      return { resolveScodeAcpArgs, resolveScodeAuthModeFromConfig };
    }

    it('forces proxy auth when proxy credentials are available', async () => {
      const resolveScodeAcpArgs = await loadResolveScodeAcpArgs();

      const args = resolveScodeAcpArgs('scode', ['acp'], {
        PROXY_AUTH_TOKEN: 'proxy-token',
        PROXY_BASE_URL: 'https://proxy.example.com',
      });

      expect(args).toEqual(['--auth', 'proxy', 'acp']);
    });

    it('does not duplicate auth flags when cliPath already specifies auth mode', async () => {
      const resolveScodeAcpArgs = await loadResolveScodeAcpArgs();

      const args = resolveScodeAcpArgs('scode --auth proxy', ['acp'], {
        PROXY_AUTH_TOKEN: 'proxy-token',
        PROXY_BASE_URL: 'https://proxy.example.com',
      });

      expect(args).toEqual(['acp']);
    });

    it('keeps original args when proxy credentials are not available', async () => {
      const resolveScodeAcpArgs = await loadResolveScodeAcpArgs();

      const args = resolveScodeAcpArgs('scode', ['acp'], {});

      expect(args).toEqual(['acp']);
    });

    it('uses api-key auth for models that only have an api-key provider', async () => {
      const { resolveScodeAcpArgs, resolveScodeAuthModeFromConfig } = await loadScodeAuthHelpers();
      const authMode = resolveScodeAuthModeFromConfig(
        {
          default_model: 'astron-code-latest',
          models: {
            'astron-code-latest': {
              alias: 'astron-code-latest',
              providers: {
                'api-key': { provider: 'coding-plan-glm5', model: 'astron-code-latest', api: 'openai-completions' },
              },
            },
          },
        },
        { model: 'astron-code-latest' }
      );

      const args = resolveScodeAcpArgs(
        'scode',
        ['acp'],
        {
          PROXY_AUTH_TOKEN: 'proxy-token',
          PROXY_BASE_URL: 'https://hk.sudorouter.ai',
        },
        authMode
      );

      expect(authMode).toBe('api-key');
      expect(args).toEqual(['--auth', 'api-key', 'acp']);
    });

    it('uses the requested model override when resolving scode auth mode', async () => {
      const { resolveScodeAcpArgs, resolveScodeAuthModeFromConfig } = await loadScodeAuthHelpers();
      const authMode = resolveScodeAuthModeFromConfig(
        {
          default_model: 'grok-4-20-reasoning',
          models: {
            'grok-4-20-reasoning': {
              alias: 'grok-4-20-reasoning',
              providers: {
                proxy: { provider: 'sudorouter', model: 'grok-4-20-reasoning', api: 'openai-completions' },
              },
            },
            'astron-code-latest': {
              alias: 'astron-code-latest',
              providers: {
                'api-key': { provider: 'xunfei-coding-plan', model: 'astron-code-latest', api: 'openai-completions' },
              },
            },
          },
        },
        { model: 'grok-4-20-reasoning' },
        'astron-code-latest'
      );

      const args = resolveScodeAcpArgs('scode', ['acp'], {}, authMode);

      expect(authMode).toBe('api-key');
      expect(args).toEqual(['--auth', 'api-key', 'acp']);
    });

    it('uses proxy auth for sudorouter models with proxy providers', async () => {
      const { resolveScodeAcpArgs, resolveScodeAuthModeFromConfig } = await loadScodeAuthHelpers();
      const authMode = resolveScodeAuthModeFromConfig(
        {
          default_model: 'gemini-3-flash-preview',
          models: {
            'gemini-3-flash-preview': {
              alias: 'gemini-3-flash-preview',
              providers: {
                proxy: { provider: 'sudorouter', model: 'gemini-3-flash-preview', api: 'openai-completions' },
              },
            },
          },
        },
        { model: 'gemini-3-flash-preview' }
      );

      const args = resolveScodeAcpArgs('scode', ['acp'], {}, authMode);

      expect(authMode).toBe('proxy');
      expect(args).toEqual(['--auth', 'proxy', 'acp']);
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
      expect(pythonPaths).toContain(path.join(os.homedir(), '.nexus', 'skills', '_system', '_builtin', 'browser'));
      expect(pythonPaths).toContain('/custom/python');
      expect(pythonPaths).not.toContain(hookPythonPath);
      expect(env.CLAUDECODE).toBeUndefined();
      expect(env.npm_config_registry).toBeUndefined();
    });

    it('does not inject the safety hook for any backend while it is globally disabled', async () => {
      // Safety hooks are gated off by the SAFETY_HOOKS_ENABLED module kill switch
      // (obsolete implementation; injection path kept for future restoration). So
      // no backend gets NODE_OPTIONS / whl / child marker, regardless of the
      // per-run isSafetyHookEnabled() setting. The browser PYTHONPATH is still wired.
      const prepareCleanEnv = await loadPrepareCleanEnv({
        safetyHookEnabled: true,
      });

      const env = prepareCleanEnv();
      const pythonPaths = env.PYTHONPATH?.split(path.delimiter) ?? [];

      expect(env.NODE_OPTIONS).toBeUndefined();
      expect(env.HOOK_PYTHON_WHL).toBeUndefined();
      expect(env.SUDOWORK_ACP_CHILD).toBeUndefined();
      expect(pythonPaths).toContain('/custom/python');
      expect(pythonPaths).toContain(path.join(os.homedir(), '.nexus', 'skills', '_system', '_builtin', 'browser'));
    });

    it('injects UTF-8 environment variables on Windows', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        const prepareCleanEnv = await loadPrepareCleanEnv({
          safetyHookEnabled: false,
        });

        const env = prepareCleanEnv({ injectSafetyHook: false });

        // Python UTF-8 mode
        expect(env.PYTHONUTF8).toBe('1');
        expect(env.PYTHONIOENCODING).toBe('utf-8');
        // POSIX locale for cross-platform runtimes
        expect(env.LANG).toBe('C.UTF-8');
        expect(env.LC_ALL).toBe('C.UTF-8');
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      }
    });

    it('does not override existing UTF-8 env vars if already set', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        // Override getEnhancedEnv to return pre-set UTF-8 env vars
        vi.doMock('@process/utils/shellEnv', () => ({
          getEnhancedEnv: () => ({
            PATH: '/usr/bin',
            PYTHONPATH: '/custom/python',
            NODE_OPTIONS: '--inspect',
            PYTHONUTF8: '0',
            PYTHONIOENCODING: 'ascii',
            LANG: 'ja_JP.UTF-8',
            LC_ALL: 'ja_JP.UTF-8',
          }),
          findSuitableNodeBin: vi.fn(),
          resolveNpxPath: vi.fn(() => 'npx'),
        }));

        const { prepareCleanEnv } = await import('@/agent/acp/acpConnectors');
        const env = prepareCleanEnv({ injectSafetyHook: false });

        // Should preserve user's existing values
        expect(env.PYTHONUTF8).toBe('0');
        expect(env.PYTHONIOENCODING).toBe('ascii');
        expect(env.LANG).toBe('ja_JP.UTF-8');
        expect(env.LC_ALL).toBe('ja_JP.UTF-8');
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      }
    });
  });

  describe('createGenericSpawnConfig shell behavior', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.clearAllMocks();
      vi.resetModules();
    });

    async function loadCreateGenericSpawnConfig() {
      vi.doMock('electron', () => ({
        app: {
          isPackaged: false,
          getAppPath: () => '/mock-app',
        },
      }));

      vi.doMock('@process/services/safety/SafetyPollingService', () => ({
        isSafetyHookEnabled: () => false,
      }));

      vi.doMock('@process/utils/mainLogger', () => ({
        mainLog: vi.fn(),
        mainWarn: vi.fn(),
      }));

      vi.doMock('@process/utils/shellEnv', () => ({
        getEnhancedEnv: () => ({
          PATH: '/usr/bin',
        }),
        findSuitableNodeBin: vi.fn(),
        resolveNpxPath: vi.fn(() => 'npx'),
      }));

      const { createGenericSpawnConfig } = await import('@/agent/acp/acpConnectors');
      return createGenericSpawnConfig;
    }

    it('should not use shell for direct CLI paths on Windows (no cmd.exe intermediary)', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        const createGenericSpawnConfig = await loadCreateGenericSpawnConfig();
        const config = createGenericSpawnConfig('C:\\Users\\test\\.nexus\\sudocode\\scode.exe', 'C:\\workspace', ['acp']);

        // shell should be false — no cmd.exe intermediary
        expect(config.options.shell).toBe(false);
        expect(config.command).toBe('C:\\Users\\test\\.nexus\\sudocode\\scode.exe');
        expect(config.args).toEqual(['acp']);
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      }
    });

    it('should not prepend chcp to the command on Windows', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        const createGenericSpawnConfig = await loadCreateGenericSpawnConfig();
        const config = createGenericSpawnConfig('scode', 'C:\\workspace', ['acp']);

        // Command should NOT contain chcp
        expect(config.command).not.toContain('chcp');
        expect(config.command).toBe('scode');
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      }
    });
  });
});
