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

function setProcessProperty(key: 'resourcesPath', value: string): PropertyDescriptor | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(process, key);
  Object.defineProperty(process, key, {
    configurable: true,
    enumerable: true,
    value,
  });
  return descriptor;
}

describe('DynamicNexusService install readiness', () => {
  let tempRoot: string;
  let resourcesDir: string;
  let dataDir: string;
  let originalResourcesPath: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-nexus-service-'));
    resourcesDir = path.join(tempRoot, 'resources');
    dataDir = path.join(tempRoot, 'data');

    fs.mkdirSync(resourcesDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    // Write a binary file (>= 1024 bytes) to simulate bundled nexusd resource
    const nexusdFilename = process.platform === 'win32' ? 'nexusd.exe' : 'nexusd';
    fs.writeFileSync(path.join(resourcesDir, nexusdFilename), Buffer.alloc(2048));

    vi.doMock('electron', () => ({
      app: {
        isPackaged: true,
        getAppPath: () => tempRoot,
        getVersion: () => '0.0.0-test',
      },
    }));

    vi.doMock('@process/utils', () => ({
      getDataPath: () => dataDir,
    }));

    vi.doMock('@process/utils/mainLogger', () => ({
      mainLog: vi.fn(),
      mainWarn: vi.fn(),
      mainError: vi.fn(),
    }));

    originalResourcesPath = setProcessProperty('resourcesPath', resourcesDir);
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    if (originalResourcesPath) {
      Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
    }

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('treats a nexus install without the ready marker as not installed', async () => {
    const binDir = path.join(dataDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, process.platform === 'win32' ? 'nexusd.exe' : 'nexusd'), 'binary');

    const { dynamicNexusService } = await import('@/process/services/nexus/DynamicNexusService');

    expect(dynamicNexusService.checkInstalledSync()).toBe(false);
    await expect(dynamicNexusService.checkInstalled()).resolves.toBe(false);
  });

  it('treats a nexus install with the current ready marker as installed', async () => {
    const binDir = path.join(dataDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, process.platform === 'win32' ? 'nexusd.exe' : 'nexusd'), 'binary');
    fs.writeFileSync(path.join(binDir, '.nexus-install-ready'), String(runtimeVersions.nexus));

    const { dynamicNexusService } = await import('@/process/services/nexus/DynamicNexusService');

    expect(dynamicNexusService.checkInstalledSync()).toBe(true);
    await expect(dynamicNexusService.checkInstalled()).resolves.toBe(true);
  });

  it('treats legacy conda env with nexusd binary as installed (backward compat)', async () => {
    const envDir = path.join(dataDir, 'nexus_env', process.platform === 'win32' ? 'Scripts' : 'bin');
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(path.join(envDir, process.platform === 'win32' ? 'nexusd.exe' : 'nexusd'), 'binary');

    const { dynamicNexusService } = await import('@/process/services/nexus/DynamicNexusService');

    expect(dynamicNexusService.checkInstalledSync()).toBe(true);
    await expect(dynamicNexusService.checkInstalled()).resolves.toBe(true);
  });
});
