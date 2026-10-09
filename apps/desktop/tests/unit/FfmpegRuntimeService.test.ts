import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { DATA_DIR, DUMMY, DUMMY_SHA, downloadMock, extractMock } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const p = require('path');
  const crypto = require('crypto');
  const base = p.join(require('os').tmpdir(), 'sudowork-ffmpeg-unit');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const dummy = 'dummy-ffmpeg-archive-bytes';
  return {
    DATA_DIR: p.join(base, 'data'),
    DUMMY: dummy,
    DUMMY_SHA: crypto.createHash('sha256').update(dummy).digest('hex'),
    downloadMock: vi.fn(),
    extractMock: vi.fn(),
  };
});

// Pin only win32-x64 in the test config (darwin has no source → install skips).
vi.mock('@/shared/ffmpeg-runtime.json', () => ({
  default: { tag: 'test-tag', cos: { baseUrl: 'https://cos.example', sha256: { 'win32-x64': DUMMY_SHA } } },
}));
vi.mock('@process/utils', () => ({ getDataPath: () => DATA_DIR }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@process/services/archiveProgress', () => ({ extractTarGzWithProgress: extractMock }));
vi.mock('@process/services/ffmpeg/downloadArchive', () => ({ downloadArchive: downloadMock }));

import { getFfmpegBinaryPath, getFfprobeBinaryPath, isFfmpegInstalled, getFfmpegBinDir, installFfmpeg } from '@process/services/ffmpeg/FfmpegRuntimeService';

const ffmpegDir = path.join(DATA_DIR, 'ffmpeg');
const originalPlatform = process.platform;
const originalArch = process.arch;

function setTarget(platform: NodeJS.Platform, arch: NodeJS.Architecture): void {
  Object.defineProperty(process, 'platform', { value: platform });
  Object.defineProperty(process, 'arch', { value: arch });
}

/** downloadArchive stub that writes `content` to the destination path. */
function downloadWrites(content: string): void {
  downloadMock.mockImplementation(async (_url: string, dest: string) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  });
}

/** extract stub that writes a flat ffmpeg.exe into the target dir. */
function extractWritesBinary(): void {
  extractMock.mockImplementation(async (_src: string, dest: string) => {
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'ffmpeg.exe'), 'binary');
  });
}

describe('FfmpegRuntimeService', () => {
  beforeEach(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    downloadMock.mockReset();
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

  it('installFfmpeg returns false when the platform has no pinned COS source', async () => {
    setTarget('darwin', 'arm64'); // not in the test config's cos.sha256
    await expect(installFfmpeg()).resolves.toBe(false);
    expect(downloadMock).not.toHaveBeenCalled();
    expect(isFfmpegInstalled()).toBe(false);
  });

  it('installFfmpeg downloads, verifies the SHA256, and extracts the binary', async () => {
    setTarget('win32', 'x64');
    downloadWrites(DUMMY); // sha256(DUMMY) === pinned DUMMY_SHA
    extractWritesBinary();

    await expect(installFfmpeg()).resolves.toBe(true);
    expect(downloadMock).toHaveBeenCalledOnce();
    expect(extractMock).toHaveBeenCalledOnce();
    expect(isFfmpegInstalled()).toBe(true);
  });

  it('installFfmpeg aborts (no extract) on SHA256 mismatch', async () => {
    setTarget('win32', 'x64');
    downloadWrites('tampered-bytes'); // sha256 != pinned
    await expect(installFfmpeg()).resolves.toBe(false);
    expect(extractMock).not.toHaveBeenCalled();
    expect(isFfmpegInstalled()).toBe(false);
  });

  it('installFfmpeg fails when extraction did not produce the binary', async () => {
    setTarget('win32', 'x64');
    downloadWrites(DUMMY);
    extractMock.mockResolvedValue(undefined); // "succeeds" but writes nothing
    await expect(installFfmpeg()).resolves.toBe(false);
    expect(isFfmpegInstalled()).toBe(false);
  });

  it('installFfmpeg is a no-op when already installed', async () => {
    setTarget('win32', 'x64');
    fs.mkdirSync(ffmpegDir, { recursive: true });
    fs.writeFileSync(getFfmpegBinaryPath(), 'binary');
    await expect(installFfmpeg()).resolves.toBe(true);
    expect(downloadMock).not.toHaveBeenCalled();
    expect(extractMock).not.toHaveBeenCalled();
  });
});
