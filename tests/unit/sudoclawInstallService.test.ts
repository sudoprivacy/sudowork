/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import runtimeVersions from '@/shared/runtime-versions.json';

const bundledVersion = String(runtimeVersions.sudoclaw);
const resourceArchiveName = `${bundledVersion}-sudoclaw-windows-x64.tgz`;
const resourceManifestName = `${bundledVersion}-sudoclaw-windows-x64.manifest.json`;

function setProcessProperty(key: 'platform' | 'arch' | 'resourcesPath', value: string): PropertyDescriptor | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(process, key);
  Object.defineProperty(process, key, {
    configurable: true,
    enumerable: true,
    value,
  });
  return descriptor;
}

describe('SudoclawInstallService', () => {
  let tempRoot: string;
  let homeDir: string;
  let resourcesDir: string;
  let originalPlatform: PropertyDescriptor | undefined;
  let originalArch: PropertyDescriptor | undefined;
  let originalResourcesPath: PropertyDescriptor | undefined;
  let tarExtractMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sudoclaw-install-'));
    homeDir = path.join(tempRoot, 'home');
    resourcesDir = path.join(tempRoot, 'resources');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(resourcesDir, { recursive: true });

    fs.writeFileSync(path.join(resourcesDir, resourceArchiveName), 'fixture');
    fs.writeFileSync(
      path.join(resourcesDir, resourceManifestName),
      JSON.stringify(
        {
          version: bundledVersion,
          platform: 'win32',
          arch: 'x64',
          daveyBinding: '@snazzah/davey-win32-x64-msvc',
        },
        null,
        2
      )
    );

    tarExtractMock = vi.fn().mockResolvedValue(undefined);

    vi.doMock('electron', () => ({
      app: {
        isPackaged: true,
        getAppPath: () => tempRoot,
      },
    }));

    vi.doMock('os', async () => {
      const actual = await vi.importActual<typeof import('os')>('os');
      return {
        ...actual,
        homedir: () => homeDir,
      };
    });

    vi.doMock('tar', () => ({
      x: tarExtractMock,
    }));

    vi.doMock('@process/utils/mainLogger', () => ({
      mainLog: vi.fn(),
      mainWarn: vi.fn(),
      mainError: vi.fn(),
    }));

    originalPlatform = setProcessProperty('platform', 'win32');
    originalArch = setProcessProperty('arch', 'x64');
    originalResourcesPath = setProcessProperty('resourcesPath', resourcesDir);
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    if (originalArch) Object.defineProperty(process, 'arch', originalArch);
    if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('reads installed version directly from install manifest', async () => {
    const sudoclawDir = path.join(homeDir, '.nexus', 'sudoclaw');
    fs.mkdirSync(sudoclawDir, { recursive: true });
    fs.writeFileSync(
      path.join(sudoclawDir, 'install-manifest.json'),
      JSON.stringify(
        {
          version: bundledVersion,
          platform: 'win32',
          arch: 'x64',
        },
        null,
        2
      )
    );

    const module = await import('@/process/services/sudoclaw/SudoclawInstallService');

    expect(module.getSudoclawInstalledVersion()).toBe(bundledVersion);
    expect(module.getSudoclawVersionState()).toEqual({
      installedVersion: bundledVersion,
      bundledVersion,
      needsUpgrade: false,
    });
    expect(module.isSudoclawInstalled()).toBe(true);
  });

  it('uses install manifest version for upgrade checks even if package.json differs', async () => {
    const pkgRoot = path.join(homeDir, '.nexus', 'sudoclaw', 'cli', 'package');
    fs.mkdirSync(pkgRoot, { recursive: true });
    fs.writeFileSync(path.join(pkgRoot, 'package.json'), JSON.stringify({ version: '0.0.1' }, null, 2));

    const sudoclawDir = path.join(homeDir, '.nexus', 'sudoclaw');
    fs.mkdirSync(sudoclawDir, { recursive: true });
    fs.writeFileSync(
      path.join(sudoclawDir, 'install-manifest.json'),
      JSON.stringify(
        {
          version: bundledVersion,
          platform: 'win32',
          arch: 'x64',
        },
        null,
        2
      )
    );

    const module = await import('@/process/services/sudoclaw/SudoclawInstallService');

    expect(module.getSudoclawInstalledVersion()).toBe(bundledVersion);
    expect(module.getSudoclawVersionState()).toEqual({
      installedVersion: bundledVersion,
      bundledVersion,
      needsUpgrade: false,
    });
    expect(module.isSudoclawInstalled()).toBe(true);
  });

  it('treats raw manifest version mismatch as upgrade without normalization', async () => {
    const sudoclawDir = path.join(homeDir, '.nexus', 'sudoclaw');
    fs.mkdirSync(sudoclawDir, { recursive: true });
    fs.writeFileSync(
      path.join(sudoclawDir, 'install-manifest.json'),
      JSON.stringify(
        {
          version: bundledVersion.replace(/^v/, ''),
          platform: 'win32',
          arch: 'x64',
        },
        null,
        2
      )
    );

    const module = await import('@/process/services/sudoclaw/SudoclawInstallService');

    expect(module.getSudoclawInstalledVersion()).toBe(bundledVersion.replace(/^v/, ''));
    expect(module.getSudoclawVersionState()).toEqual({
      installedVersion: bundledVersion.replace(/^v/, ''),
      bundledVersion,
      needsUpgrade: true,
    });
    expect(module.isSudoclawInstalled()).toBe(false);
  });

  it('refreshes install manifest without re-extracting when existing install is valid', async () => {
    const pkgRoot = path.join(homeDir, '.nexus', 'sudoclaw', 'cli', 'package');
    fs.mkdirSync(path.join(pkgRoot, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(pkgRoot, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(pkgRoot, 'node_modules', 'chalk'), { recursive: true });
    fs.mkdirSync(path.join(pkgRoot, 'node_modules', '@snazzah', 'davey-win32-x64-msvc'), { recursive: true });
    fs.writeFileSync(path.join(pkgRoot, 'package.json'), JSON.stringify({ version: bundledVersion }, null, 2));
    fs.writeFileSync(path.join(pkgRoot, 'dist', 'entry.mjs'), 'export {};');
    fs.writeFileSync(path.join(pkgRoot, 'launcher.mjs'), 'export {};');
    fs.writeFileSync(path.join(pkgRoot, 'bin', 'openclaw.cmd'), '@echo off');
    fs.writeFileSync(
      path.join(homeDir, '.nexus', 'sudoclaw', 'install-manifest.json'),
      JSON.stringify(
        {
          version: bundledVersion,
          platform: 'win32',
          arch: 'x64',
        },
        null,
        2
      )
    );

    const module = await import('@/process/services/sudoclaw/SudoclawInstallService');
    const result = await module.ensureSudoclawInstalled();

    expect(result.installed).toBe(true);
    expect(tarExtractMock).not.toHaveBeenCalled();

    const installManifestPath = path.join(homeDir, '.nexus', 'sudoclaw', 'install-manifest.json');
    expect(fs.existsSync(installManifestPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(installManifestPath, 'utf-8'))).toMatchObject({
      version: bundledVersion,
      platform: 'win32',
      arch: 'x64',
    });
  });

  it('does not treat launcher presence alone as installed without manifest version', async () => {
    const pkgRoot = path.join(homeDir, '.nexus', 'sudoclaw', 'cli', 'package');
    fs.mkdirSync(pkgRoot, { recursive: true });
    fs.writeFileSync(path.join(pkgRoot, 'launcher.mjs'), 'export {};');

    const module = await import('@/process/services/sudoclaw/SudoclawInstallService');

    expect(module.getSudoclawCliPath()).toBe(path.join(pkgRoot, 'launcher.mjs'));
    expect(module.isSudoclawInstalled()).toBe(false);

    const result = await module.ensureSudoclawInstalled();
    expect(result.installed).toBe(false);
    expect(fs.existsSync(path.join(homeDir, '.nexus', 'sudoclaw', 'install-manifest.json'))).toBe(false);
  });

  it('fails install when bundled openclaw manifest version does not match runtime version', async () => {
    fs.writeFileSync(
      path.join(resourcesDir, resourceManifestName),
      JSON.stringify(
        {
          version: 'v0.0.1-old',
          platform: 'win32',
          arch: 'x64',
          daveyBinding: '@snazzah/davey-win32-x64-msvc',
        },
        null,
        2
      )
    );

    const module = await import('@/process/services/sudoclaw/SudoclawInstallService');
    const result = await module.ensureSudoclawInstalled();

    expect(result.installed).toBe(false);
    expect(result.error).toContain('Bundled OpenClaw resource version mismatch');
    expect(fs.existsSync(path.join(homeDir, '.nexus', 'sudoclaw', 'install-manifest.json'))).toBe(false);
  });

  it('preserves custom workspace while repairing config', async () => {
    const sudoclawDir = path.join(homeDir, '.nexus', 'sudoclaw');
    fs.mkdirSync(sudoclawDir, { recursive: true });
    const customWorkspace = path.join(homeDir, 'my-workspace');
    const configPath = path.join(sudoclawDir, 'sudoclaw.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          agents: {
            defaults: {
              workspace: customWorkspace,
            },
          },
          gateway: {
            port: 18789,
          },
        },
        null,
        2
      )
    );

    const module = await import('@/process/services/sudoclaw/SudoclawInstallService');
    module.repairOpenClawConfig();

    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8'))).toMatchObject({
      agents: {
        defaults: {
          workspace: customWorkspace,
        },
      },
      gateway: {
        port: 17863,
        mode: 'local',
        auth: {
          mode: 'none',
        },
      },
    });
  });

  it('backfills tools.web.search.provider when missing', async () => {
    const sudoclawDir = path.join(homeDir, '.nexus', 'sudoclaw');
    fs.mkdirSync(sudoclawDir, { recursive: true });
    const configPath = path.join(sudoclawDir, 'sudoclaw.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          agents: { defaults: { workspace: '/tmp/ws' } },
          gateway: { port: 17863, mode: 'local', auth: { mode: 'none' }, reload: { mode: 'hot' } },
          tools: { deny: ['browser', 'image'] },
        },
        null,
        2
      )
    );

    const module = await import('@/process/services/sudoclaw/SudoclawInstallService');
    module.repairOpenClawConfig();

    const repaired = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(repaired.tools.web).toEqual({ search: { provider: 'tavily' } });
    expect(repaired.tools.deny).toEqual(['browser', 'image', 'canvas']);
  });

  it('preserves existing tools.web.search.provider value', async () => {
    const sudoclawDir = path.join(homeDir, '.nexus', 'sudoclaw');
    fs.mkdirSync(sudoclawDir, { recursive: true });
    const configPath = path.join(sudoclawDir, 'sudoclaw.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          agents: { defaults: { workspace: '/tmp/ws' } },
          gateway: { port: 17863, mode: 'local', auth: { mode: 'none' }, reload: { mode: 'hot' } },
          tools: { deny: ['browser', 'image'], web: { search: { provider: 'custom-provider' } } },
        },
        null,
        2
      )
    );

    const module = await import('@/process/services/sudoclaw/SudoclawInstallService');
    module.repairOpenClawConfig();

    const repaired = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(repaired.tools.web.search.provider).toBe('custom-provider');
  });

  it('backfills tavily webSearch apiKey and baseUrl during repair', async () => {
    const sudoclawDir = path.join(homeDir, '.nexus', 'sudoclaw');
    fs.mkdirSync(sudoclawDir, { recursive: true });
    const configPath = path.join(sudoclawDir, 'sudoclaw.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          agents: { defaults: { workspace: '/tmp/ws' } },
          models: {
            providers: {
              sudorouter: {
                apiKey: 'router-key',
              },
            },
          },
          gateway: { port: 17863, mode: 'local', auth: { mode: 'none' }, reload: { mode: 'hot' } },
          plugins: {
            entries: {
              tavily: {
                config: {
                  webSearch: {},
                },
              },
            },
          },
        },
        null,
        2
      )
    );

    const module = await import('@/process/services/sudoclaw/SudoclawInstallService');
    module.repairOpenClawConfig();

    const repaired = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(repaired.plugins.entries.tavily).toMatchObject({
      enabled: true,
      config: {
        webSearch: {
          apiKey: 'router-key',
          baseUrl: 'https://hk.sudorouter.ai/search/tavily',
        },
      },
    });
  });

  it('backfills tavily webSearch baseUrl without overwriting existing apiKey', async () => {
    const sudoclawDir = path.join(homeDir, '.nexus', 'sudoclaw');
    fs.mkdirSync(sudoclawDir, { recursive: true });
    const configPath = path.join(sudoclawDir, 'sudoclaw.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          agents: { defaults: { workspace: '/tmp/ws' } },
          gateway: { port: 17863, mode: 'local', auth: { mode: 'none' }, reload: { mode: 'hot' } },
          plugins: {
            entries: {
              tavily: {
                config: {
                  webSearch: {
                    apiKey: 'plugin-key',
                  },
                },
              },
            },
          },
        },
        null,
        2
      )
    );

    const module = await import('@/process/services/sudoclaw/SudoclawInstallService');
    module.repairOpenClawConfig();

    const repaired = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(repaired.plugins.entries.tavily.config.webSearch).toEqual({
      apiKey: 'plugin-key',
      baseUrl: 'https://hk.sudorouter.ai/search/tavily',
    });
  });

  it('does not delete legacy dir when new sudoclaw dir already exists', async () => {
    const newPkgRoot = path.join(homeDir, '.nexus', 'sudoclaw', 'cli', 'package');
    fs.mkdirSync(path.join(newPkgRoot, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(newPkgRoot, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(newPkgRoot, 'node_modules', 'chalk'), { recursive: true });
    fs.mkdirSync(path.join(newPkgRoot, 'node_modules', '@snazzah', 'davey-win32-x64-msvc'), { recursive: true });
    fs.writeFileSync(path.join(newPkgRoot, 'package.json'), JSON.stringify({ version: bundledVersion }, null, 2));
    fs.writeFileSync(path.join(newPkgRoot, 'dist', 'entry.mjs'), 'export {};');
    fs.writeFileSync(path.join(newPkgRoot, 'launcher.mjs'), 'export {};');
    fs.writeFileSync(path.join(newPkgRoot, 'bin', 'openclaw.cmd'), '@echo off');
    fs.writeFileSync(
      path.join(homeDir, '.nexus', 'sudoclaw', 'install-manifest.json'),
      JSON.stringify(
        {
          version: bundledVersion,
          platform: 'win32',
          arch: 'x64',
        },
        null,
        2
      )
    );

    const legacyDir = path.join(homeDir, '.sudoclaw');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, 'legacy.txt'), 'keep me');

    const module = await import('@/process/services/sudoclaw/SudoclawInstallService');
    const result = await module.ensureSudoclawInstalled();

    expect(result.installed).toBe(true);
    expect(fs.existsSync(path.join(legacyDir, 'legacy.txt'))).toBe(true);
  });

  it('removes only cli files during uninstall helper', async () => {
    const sudoclawDir = path.join(homeDir, '.nexus', 'sudoclaw');
    const cliDir = path.join(sudoclawDir, 'cli');
    const workspaceDir = path.join(sudoclawDir, 'workspace');
    const configPath = path.join(sudoclawDir, 'sudoclaw.json');
    fs.mkdirSync(cliDir, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(cliDir, 'openclaw.cmd'), '@echo off');
    fs.writeFileSync(path.join(workspaceDir, 'note.txt'), 'workspace');
    fs.writeFileSync(configPath, JSON.stringify({ foo: 'bar' }, null, 2));

    const module = await import('@/process/services/sudoclaw/SudoclawInstallService');
    module.removeSudoclawCli();

    expect(fs.existsSync(cliDir)).toBe(false);
    expect(fs.existsSync(workspaceDir)).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);
  });
});
