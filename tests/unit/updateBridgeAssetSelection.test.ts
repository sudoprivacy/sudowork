/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@office-ai/platform', () => ({
  storage: {
    buildStorage: vi.fn(() => ({})),
  },
  bridge: {
    buildProvider: vi.fn(() => ({
      provider: vi.fn(),
      invoke: vi.fn(),
    })),
    buildEmitter: vi.fn(() => ({
      emit: vi.fn(),
      on: vi.fn(),
    })),
  },
}));

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/test/path'),
    isPackaged: true,
  },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    logger: null,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    allowDowngrade: false,
    on: vi.fn(),
    removeListener: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    checkForUpdatesAndNotify: vi.fn(),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    transports: { file: { level: 'info' } },
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { buildReleaseInfoFromCOS, getCOSYmlFileName, parseCOSYmlText, pickRecommendedAsset, verifyFileSha512 } from '@/process/bridge/updateBridge';

const SHA512 = createHash('sha512').update('release').digest('base64');
const temporaryDirectories: string[] = [];

const asset = (name: string) => ({
  name,
  url: `https://github.com/sudoprivacy/Sudowork/releases/download/v1.0.0/${name}`,
  size: 1,
});

describe('pickRecommendedAsset', () => {
  it('should prefer ia32 package on win32 ia32 runtime', () => {
    const assets = [asset('Sudowork-1.0.0-win-x64.exe'), asset('Sudowork-1.0.0-win-ia32.exe')];

    const result = pickRecommendedAsset(assets, { platform: 'win32', arch: 'ia32' });

    expect(result?.name).toBe('Sudowork-1.0.0-win-ia32.exe');
  });

  it('should return undefined when no compatible arch package exists', () => {
    const assets = [asset('Sudowork-1.0.0-win-x64.exe'), asset('Sudowork-1.0.0-win-x64.zip')];

    const result = pickRecommendedAsset(assets, { platform: 'win32', arch: 'ia32' });

    expect(result).toBeUndefined();
  });

  it('should allow generic package without explicit arch token', () => {
    const assets = [asset('Sudowork-1.0.0-win.exe')];

    const result = pickRecommendedAsset(assets, { platform: 'win32', arch: 'ia32' });

    expect(result?.name).toBe('Sudowork-1.0.0-win.exe');
  });
});

describe('COS update metadata', () => {
  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
  });

  it('should parse valid electron-updater metadata and ignore extra fields', () => {
    const result = parseCOSYmlText(`
version: 1.2.3
files:
  - url: Sudowork-1.2.3-win-x64.exe
    sha512: ${SHA512}
    size: 123
    blockMapSize: 42
path: Sudowork-1.2.3-win-x64.exe
sha512: ${SHA512}
releaseDate: '2026-07-17T00:00:00.000Z'
`);

    expect(result).toEqual({
      version: '1.2.3',
      files: [{ url: 'Sudowork-1.2.3-win-x64.exe', sha512: SHA512, size: 123 }],
      path: 'Sudowork-1.2.3-win-x64.exe',
      sha512: SHA512,
      releaseDate: '2026-07-17T00:00:00.000Z',
    });
  });

  it('should reject metadata without a valid SHA-512 digest', () => {
    const result = parseCOSYmlText(`
version: 1.2.3
files:
  - url: Sudowork-1.2.3-win-x64.exe
    sha512: invalid
    size: 123
`);

    expect(result).toBeNull();
  });

  it.each([
    [{ platform: 'win32' as const, arch: 'x64' }, 'latest.yml'],
    [{ platform: 'win32' as const, arch: 'arm64' }, 'win-arm64.yml'],
    [{ platform: 'darwin' as const, arch: 'x64' }, 'latest-mac.yml'],
    [{ platform: 'darwin' as const, arch: 'arm64' }, 'arm64-mac.yml'],
  ])('should select the correct metadata filename for $platform $arch', (runtime, expected) => {
    expect(getCOSYmlFileName(runtime)).toBe(expected);
  });

  it('should build a release from versioned COS assets and prefer the platform installer', () => {
    const metadata = parseCOSYmlText(`
version: 1.2.3
files:
  - url: Sudowork-1.2.3-mac-arm64.zip
    sha512: ${SHA512}
    size: 100
  - url: Sudowork-1.2.3-mac-arm64.dmg
    sha512: ${SHA512}
    size: 200
`);
    expect(metadata).not.toBeNull();

    const result = buildReleaseInfoFromCOS(metadata!, { platform: 'darwin', arch: 'arm64' }, 'https://download.example.com/sudowork/release/latest');

    expect(result?.recommendedAsset).toEqual({
      name: 'Sudowork-1.2.3-mac-arm64.dmg',
      url: 'https://download.example.com/sudowork/release/latest/Sudowork-1.2.3-mac-arm64.dmg',
      size: 200,
      sha512: SHA512,
    });
    expect(result?.assets).toHaveLength(2);
  });

  it('should build a release from a private HTTP feed without appending the public COS path', () => {
    const metadata = parseCOSYmlText(`
version: 1.0.1
files:
  - url: Sudowork-1.0.1-win-x64.exe
    sha512: ${SHA512}
    size: 100
`);
    expect(metadata).not.toBeNull();

    const result = buildReleaseInfoFromCOS(metadata!, { platform: 'win32', arch: 'x64' }, 'http://10.0.1.79:8080/downloads/');

    expect(result?.assets).toEqual([
      {
        name: 'Sudowork-1.0.1-win-x64.exe',
        url: 'http://10.0.1.79:8080/downloads/Sudowork-1.0.1-win-x64.exe',
        size: 100,
        sha512: SHA512,
      },
    ]);
  });

  it('should reject assets outside the configured COS feed', () => {
    const metadata = parseCOSYmlText(`
version: 1.2.3
files:
  - url: https://attacker.example/Sudowork-1.2.3-win-x64.exe
    sha512: ${SHA512}
    size: 123
`);
    expect(metadata).not.toBeNull();

    const result = buildReleaseInfoFromCOS(metadata!, { platform: 'win32', arch: 'x64' }, 'https://download.example.com/sudowork/release/latest');

    expect(result).toBeNull();
  });

  it('should reject private HTTP assets outside the configured feed path', () => {
    const metadata = parseCOSYmlText(`
version: 1.0.1
files:
  - url: http://10.0.1.79:8080/other/Sudowork-1.0.1-win-x64.exe
    sha512: ${SHA512}
    size: 123
`);
    expect(metadata).not.toBeNull();

    const result = buildReleaseInfoFromCOS(metadata!, { platform: 'win32', arch: 'x64' }, 'http://10.0.1.79:8080/downloads');

    expect(result).toBeNull();
  });

  it('should verify a downloaded file SHA-512 digest', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sudowork-update-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'update.bin');
    await writeFile(filePath, 'release');

    await expect(verifyFileSha512(filePath, SHA512)).resolves.toBe(true);
    await expect(verifyFileSha512(filePath, createHash('sha512').update('other').digest('base64'))).resolves.toBe(false);
  });
});
