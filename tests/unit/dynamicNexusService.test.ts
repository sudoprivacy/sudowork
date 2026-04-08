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
  const nexusdName = process.platform === 'win32' ? 'nexusd.exe' : 'nexusd';

  // Versioned resource name matching the platform map in DynamicNexusService
  const nexusVersion = runtimeVersions.nexus;
  const PLATFORM_MAP: Record<string, string> = {
    'darwin-arm64': `v${nexusVersion}-nexus-cluster-macos-arm64`,
    'darwin-x64': `v${nexusVersion}-nexus-cluster-macos-x86_64`,
    'win32-x64': `v${nexusVersion}-nexus-cluster-windows-x86_64.exe`,
  };
  const versionedResourceName = PLATFORM_MAP[`${process.platform}-${process.arch}`] ?? nexusdName;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-nexus-service-'));
    resourcesDir = path.join(tempRoot, 'resources');
    dataDir = path.join(tempRoot, 'data');

    fs.mkdirSync(resourcesDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    // Write the bundled binary (versioned format: e.g., resources/v0.9.27-nexus-cluster-macos-arm64)
    fs.writeFileSync(path.join(resourcesDir, versionedResourceName), Buffer.alloc(1024 * 1024));

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

  it('treats a nexusd binary without the ready marker as not installed', async () => {
    const binDir = path.join(dataDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, nexusdName), 'binary');

    const { dynamicNexusService } = await import('@/process/services/nexus/DynamicNexusService');

    expect(dynamicNexusService.checkInstalledSync()).toBe(false);
    await expect(dynamicNexusService.checkInstalled()).resolves.toBe(false);
  });

  it('treats a nexusd binary with the current ready marker as installed', async () => {
    const binDir = path.join(dataDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, nexusdName), 'binary');
    fs.writeFileSync(path.join(binDir, '.nexus-bin-ready'), String(runtimeVersions.nexus));

    const { dynamicNexusService } = await import('@/process/services/nexus/DynamicNexusService');

    expect(dynamicNexusService.checkInstalledSync()).toBe(true);
    await expect(dynamicNexusService.checkInstalled()).resolves.toBe(true);
  });

  it('treats a legacy conda env nexusd as installed (backward compatibility)', async () => {
    // Legacy path: ~/.nexus/nexus_env/bin/nexusd (or Scripts/nexusd.exe on Windows)
    const legacyBinDir = path.join(dataDir, 'nexus_env', process.platform === 'win32' ? 'Scripts' : 'bin');
    fs.mkdirSync(legacyBinDir, { recursive: true });
    fs.writeFileSync(path.join(legacyBinDir, nexusdName), 'binary');

    const { dynamicNexusService } = await import('@/process/services/nexus/DynamicNexusService');

    expect(dynamicNexusService.checkInstalledSync()).toBe(true);
    await expect(dynamicNexusService.checkInstalled()).resolves.toBe(true);
  });
});
