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

    fs.writeFileSync(path.join(resourcesDir, 'openclaw.tgz'), 'fixture');
    fs.writeFileSync(
      path.join(resourcesDir, 'openclaw.manifest.json'),
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

  it('falls back to install manifest version when package.json is unavailable', async () => {
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
  });

  it('prefers extracted package version over install manifest for upgrade checks', async () => {
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

    expect(module.getSudoclawInstalledVersion()).toBe('0.0.1');
    expect(module.getSudoclawVersionState()).toEqual({
      installedVersion: '0.0.1',
      bundledVersion,
      needsUpgrade: true,
    });
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

  it('treats launcher presence as sufficient for installed detection', async () => {
    const pkgRoot = path.join(homeDir, '.nexus', 'sudoclaw', 'cli', 'package');
    fs.mkdirSync(pkgRoot, { recursive: true });
    fs.writeFileSync(path.join(pkgRoot, 'launcher.mjs'), 'export {};');

    const module = await import('@/process/services/sudoclaw/SudoclawInstallService');

    expect(module.getSudoclawCliPath()).toBe(path.join(pkgRoot, 'launcher.mjs'));

    const result = await module.ensureSudoclawInstalled();
    expect(result.installed).toBe(true);
    expect(result.cliPath).toBe(path.join(pkgRoot, 'launcher.mjs'));
    expect(tarExtractMock).not.toHaveBeenCalled();
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
