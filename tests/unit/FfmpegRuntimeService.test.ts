import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { DATA_DIR, APP_DIR, extractMock } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const p = require('path');
  const base = p.join(require('os').tmpdir(), 'sudowork-ffmpeg-unit');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { DATA_DIR: p.join(base, 'data'), APP_DIR: p.join(base, 'app'), extractMock: vi.fn() };
});

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => APP_DIR } }));
vi.mock('@process/utils', () => ({ getDataPath: () => DATA_DIR }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/services/archiveProgress', () => ({ extractTarGzWithProgress: extractMock }));

import { getFfmpegBinaryPath, getFfprobeBinaryPath, isFfmpegInstalled, getFfmpegBinDir, installFfmpeg } from '@process/services/ffmpeg/FfmpegRuntimeService';

const ffmpegDir = path.join(DATA_DIR, 'ffmpeg');
const originalPlatform = process.platform;
const originalArch = process.arch;

function setTarget(platform: NodeJS.Platform, arch: NodeJS.Architecture): void {
  Object.defineProperty(process, 'platform', { value: platform });
  Object.defineProperty(process, 'arch', { value: arch });
}

/** Point getBundledResourcePath at a dummy dev resource for the given target. */
function writeDummyResource(platform: string, arch: string): void {
  const dir = path.join(APP_DIR, 'resources');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `ffmpeg-${platform}-${arch}.tar.gz`), 'dummy');
}

describe('FfmpegRuntimeService', () => {
  beforeEach(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(APP_DIR, { recursive: true, force: true });
    extractMock.mockReset();
  });
  afterEach(() => {
    setTarget(originalPlatform, originalArch);
  });

  it('resolves the flat binary paths under <userData>/ffmpeg per platform', () => {
    setTarget('win32', 'x64');
    expect(getFfmpegBinaryPath()).toBe(path.join(ffmpegDir, 'ffmpeg.exe'));
    expect(getFfprobeBinaryPath()).toBe(path.join(ffmpegDir, 'ffprobe.exe'));

    setTarget('darwin', 'arm64');
    expect(getFfmpegBinaryPath()).toBe(path.join(ffmpegDir, 'ffmpeg'));
    expect(getFfprobeBinaryPath()).toBe(path.join(ffmpegDir, 'ffprobe'));
  });

  it('reports not-installed (and no bin dir) until the binary exists', () => {
    setTarget('win32', 'x64');
    expect(isFfmpegInstalled()).toBe(false);
    expect(getFfmpegBinDir()).toBeNull();

    fs.mkdirSync(ffmpegDir, { recursive: true });
    fs.writeFileSync(getFfmpegBinaryPath(), 'binary');
    expect(isFfmpegInstalled()).toBe(true);
    expect(getFfmpegBinDir()).toBe(ffmpegDir);
  });

  it('installFfmpeg returns false when no bundled resource is present', async () => {
    setTarget('win32', 'x64');
    await expect(installFfmpeg()).resolves.toBe(false);
    expect(extractMock).not.toHaveBeenCalled();
    expect(isFfmpegInstalled()).toBe(false);
  });

  it('installFfmpeg extracts the bundled resource and resolves the binary', async () => {
    setTarget('win32', 'x64');
    writeDummyResource('win32', 'x64');
    // Simulate extraction producing the flat binary at the target dir.
    extractMock.mockImplementation(async (_src: string, dest: string) => {
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, 'ffmpeg.exe'), 'binary');
    });

    await expect(installFfmpeg()).resolves.toBe(true);
    expect(extractMock).toHaveBeenCalledOnce();
    expect(isFfmpegInstalled()).toBe(true);
  });

  it('installFfmpeg fails when extraction did not produce the binary', async () => {
    setTarget('win32', 'x64');
    writeDummyResource('win32', 'x64');
    extractMock.mockResolvedValue(undefined); // extractor "succeeds" but writes nothing
    await expect(installFfmpeg()).resolves.toBe(false);
    expect(isFfmpegInstalled()).toBe(false);
  });

  it('installFfmpeg is a no-op when already installed', async () => {
    setTarget('win32', 'x64');
    fs.mkdirSync(ffmpegDir, { recursive: true });
    fs.writeFileSync(getFfmpegBinaryPath(), 'binary');
    await expect(installFfmpeg()).resolves.toBe(true);
    expect(extractMock).not.toHaveBeenCalled();
  });
});
