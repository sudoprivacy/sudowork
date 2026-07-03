/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@office-ai/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@office-ai/platform')>();
  return {
    ...actual,
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
  };
});

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
    setFeedURL: vi.fn(),
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

import { parseCOSYmlText, buildReleaseInfoFromCOS, selectDownloadSource } from '@/process/bridge/updateBridge';
import { COS_RELEASE_BASE } from '@/shared/cos';

const COS_BASE = `${COS_RELEASE_BASE}/sudowork/release/latest`;

const VERSIONED_MAC_YML = `
version: 0.2.12
files:
  - url: Sudowork-0.2.12-mac-arm64.zip
    sha512: fake-zip-sha
    size: 200000
    blockMapSize: 1234
  - url: Sudowork-0.2.12-mac-arm64.dmg
    sha512: fake-dmg-sha
    size: 210000
path: Sudowork-0.2.12-mac-arm64.zip
sha512: fake-zip-sha
releaseDate: '2026-06-01T00:00:00.000Z'
`;

const LEGACY_MAC_YML = `
version: 0.2.11
files:
  - url: Sudowork-latest-mac-arm64.zip
    sha512: fake-zip-sha
    size: 200000
  - url: Sudowork-latest-mac-arm64.dmg
    sha512: fake-dmg-sha
    size: 210000
path: Sudowork-latest-mac-arm64.zip
sha512: fake-zip-sha
releaseDate: '2026-05-01T00:00:00.000Z'
`;

describe('parseCOSYmlText', () => {
  it('should parse versioned metadata with files list', () => {
    const info = parseCOSYmlText(VERSIONED_MAC_YML);

    expect(info).not.toBeNull();
    expect(info?.version).toBe('0.2.12');
    expect(info?.releaseDate).toBe('2026-06-01T00:00:00.000Z');
    expect(info?.path).toBe('Sudowork-0.2.12-mac-arm64.zip');
    expect(info?.files).toEqual([
      { url: 'Sudowork-0.2.12-mac-arm64.zip', size: 200000 },
      { url: 'Sudowork-0.2.12-mac-arm64.dmg', size: 210000 },
    ]);
  });

  it('should return null for yml without version', () => {
    expect(parseCOSYmlText('releaseDate: 2026-06-01')).toBeNull();
  });

  it('should return null for invalid yaml', () => {
    expect(parseCOSYmlText(': not [ yaml')).toBeNull();
  });

  it('should tolerate a missing files list', () => {
    const info = parseCOSYmlText('version: 0.2.12\npath: Sudowork-0.2.12-win-x64.exe\n');

    expect(info?.version).toBe('0.2.12');
    expect(info?.files).toBeUndefined();
  });
});

describe('buildReleaseInfoFromCOS', () => {
  it('should pick the versioned dmg entry on macOS', () => {
    const info = parseCOSYmlText(VERSIONED_MAC_YML);
    const release = buildReleaseInfoFromCOS(info!, { platform: 'darwin', arch: 'arm64' });

    expect(release.version).toBe('0.2.12');
    expect(release.recommendedAsset?.name).toBe('Sudowork-0.2.12-mac-arm64.dmg');
    expect(release.recommendedAsset?.url).toBe(`${COS_BASE}/Sudowork-0.2.12-mac-arm64.dmg`);
    expect(release.recommendedAsset?.size).toBe(210000);
    expect(release.assets).toHaveLength(2);
  });

  it('should pick the versioned exe entry on Windows', () => {
    const info = parseCOSYmlText('version: 0.2.12\nfiles:\n  - url: Sudowork-0.2.12-win-x64.exe\n    size: 100000\n');
    const release = buildReleaseInfoFromCOS(info!, { platform: 'win32', arch: 'x64' });

    expect(release.recommendedAsset?.name).toBe('Sudowork-0.2.12-win-x64.exe');
    expect(release.recommendedAsset?.url).toBe(`${COS_BASE}/Sudowork-0.2.12-win-x64.exe`);
  });

  it('should pick the latest-named dmg entry from legacy metadata', () => {
    const info = parseCOSYmlText(LEGACY_MAC_YML);
    const release = buildReleaseInfoFromCOS(info!, { platform: 'darwin', arch: 'arm64' });

    expect(release.recommendedAsset?.name).toBe('Sudowork-latest-mac-arm64.dmg');
  });

  it('should fall back to the latest-named installer when files list is missing', () => {
    const info = parseCOSYmlText('version: 0.2.12\n');
    const release = buildReleaseInfoFromCOS(info!, { platform: 'darwin', arch: 'arm64' });

    expect(release.recommendedAsset?.name).toBe('Sudowork-latest-mac-arm64.dmg');
    expect(release.recommendedAsset?.url).toBe(`${COS_BASE}/Sudowork-latest-mac-arm64.dmg`);
  });

  it('should fall back when files list has no installer for the platform', () => {
    const info = parseCOSYmlText('version: 0.2.12\nfiles:\n  - url: Sudowork-0.2.12-mac-arm64.zip\n    size: 200000\n');
    const release = buildReleaseInfoFromCOS(info!, { platform: 'darwin', arch: 'arm64' });

    expect(release.recommendedAsset?.name).toBe('Sudowork-latest-mac-arm64.dmg');
  });
});

describe('selectDownloadSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubFetchByUrl = (okUrls: string[]) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({ ok: okUrls.includes(String(url)) }))
    );
  };

  it('should return COS URLs untouched', async () => {
    stubFetchByUrl([]);
    const cosUrl = `${COS_BASE}/Sudowork-0.2.12-mac-arm64.dmg`;

    await expect(selectDownloadSource(cosUrl, 'Sudowork-0.2.12-mac-arm64.dmg')).resolves.toBe(cosUrl);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should map GitHub asset names to the versioned COS URL', async () => {
    const versionedUrl = `${COS_BASE}/Sudowork-0.2.12-win-x64.exe`;
    stubFetchByUrl([versionedUrl]);

    const result = await selectDownloadSource('https://github.com/sudoprivacy/sudowork/releases/download/v0.2.12/Sudowork-0.2.12-win-x64.exe', 'Sudowork-0.2.12-win-x64.exe');

    expect(result).toBe(versionedUrl);
  });

  it('should fall back to the latest-named copy when the versioned file is missing', async () => {
    const latestUrl = `${COS_BASE}/Sudowork-latest-win-x64.exe`;
    stubFetchByUrl([latestUrl]);

    const result = await selectDownloadSource('https://github.com/sudoprivacy/sudowork/releases/download/v0.2.12/Sudowork-0.2.12-win-x64.exe', 'Sudowork-0.2.12-win-x64.exe');

    expect(result).toBe(latestUrl);
  });

  it('should keep the original URL when COS has neither copy', async () => {
    stubFetchByUrl([]);
    const githubUrl = 'https://github.com/sudoprivacy/sudowork/releases/download/v0.2.12/Sudowork-0.2.12-win-x64.exe';

    await expect(selectDownloadSource(githubUrl, 'Sudowork-0.2.12-win-x64.exe')).resolves.toBe(githubUrl);
  });
});
