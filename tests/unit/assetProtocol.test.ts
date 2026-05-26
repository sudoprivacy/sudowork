/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createAssetProtocolResponse, resolveAssetByteRange, resolveAssetFilePath } from '@/extensions/assetProtocol';

describe('resolveAssetFilePath', () => {
  it('resolves unix asset URLs', () => {
    expect(resolveAssetFilePath('aion-asset://asset//Users/test/video.mp4', 'darwin')).toBe('/Users/test/video.mp4');
  });

  it('resolves Windows asset URLs', () => {
    expect(resolveAssetFilePath('aion-asset://asset/C:/Users/test/video.mp4', 'win32')).toBe('C:/Users/test/video.mp4');
  });
});

describe('resolveAssetByteRange', () => {
  it('returns full-file metadata without a Range header', () => {
    expect(resolveAssetByteRange(null, 100)).toEqual({
      status: 200,
      start: 0,
      end: 99,
      contentLength: 100,
    });
  });

  it('supports open-ended byte ranges', () => {
    expect(resolveAssetByteRange('bytes=10-', 100)).toEqual({
      status: 206,
      start: 10,
      end: 99,
      contentLength: 90,
      contentRange: 'bytes 10-99/100',
    });
  });

  it('supports suffix byte ranges', () => {
    expect(resolveAssetByteRange('bytes=-25', 100)).toEqual({
      status: 206,
      start: 75,
      end: 99,
      contentLength: 25,
      contentRange: 'bytes 75-99/100',
    });
  });

  it('rejects unsatisfiable ranges', () => {
    expect(resolveAssetByteRange('bytes=100-200', 100)).toEqual({
      status: 416,
      contentRange: 'bytes */100',
    });
  });
});

describe('createAssetProtocolResponse', () => {
  it('streams the requested byte range with media headers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sudowork-asset-protocol-'));
    const filePath = join(dir, 'clip.mp4');

    try {
      await writeFile(filePath, Buffer.from('0123456789'));

      const response = await createAssetProtocolResponse(
        new Request(`aion-asset://asset/${filePath}`, {
          headers: {
            range: 'bytes=2-5',
          },
        })
      );

      expect(response.status).toBe(206);
      expect(response.headers.get('accept-ranges')).toBe('bytes');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type')).toBe('video/mp4');
      expect(response.headers.get('expires')).toBe('0');
      expect(response.headers.get('pragma')).toBe('no-cache');
      expect(response.headers.get('content-length')).toBe('4');
      expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
      expect(await response.text()).toBe('2345');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('sets audio content type for audio files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sudowork-asset-protocol-'));
    const filePath = join(dir, 'clip.mp3');

    try {
      await writeFile(filePath, Buffer.from('audio'));

      const response = await createAssetProtocolResponse(new Request(`aion-asset://asset/${filePath}`));

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('audio/mpeg');
      expect(await response.text()).toBe('audio');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
