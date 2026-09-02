/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveMediaToWorkspace } from '@/channels/utils/mediaDownloader';

describe('mediaDownloader', () => {
  const tmpDir = path.join('/tmp', `media-test-${Date.now()}`);

  afterEach(() => {
    // Clean up temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('saveMediaToWorkspace', () => {
    it('saves a file with the provided fileName', () => {
      const data = Buffer.from('fake-image-data');
      const filePath = saveMediaToWorkspace({
        platform: 'wechat',
        baseDir: tmpDir,
        data,
        fileName: 'photo.jpg',
      });
      expect(filePath).toBe(path.join(tmpDir, 'wechat', 'photo.jpg'));
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath).toString()).toBe('fake-image-data');
    });

    it('generates a file name when not provided', () => {
      const data = Buffer.from('fake-voice-data');
      const filePath = saveMediaToWorkspace({
        platform: 'telegram',
        baseDir: tmpDir,
        data,
        defaultExtension: '.amr',
      });
      expect(filePath).toContain(path.join(tmpDir, 'telegram'));
      expect(filePath).toMatch(/\.amr$/);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('creates nested platform directory', () => {
      const data = Buffer.from('data');
      saveMediaToWorkspace({
        platform: 'lark',
        baseDir: tmpDir,
        data,
        fileName: 'test.png',
      });
      expect(fs.existsSync(path.join(tmpDir, 'lark'))).toBe(true);
    });

    it('handles empty data', () => {
      const data = Buffer.alloc(0);
      const filePath = saveMediaToWorkspace({
        platform: 'wechat',
        baseDir: tmpDir,
        data,
        fileName: 'empty.bin',
      });
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.statSync(filePath).size).toBe(0);
    });

    it('uses defaultExtension when fileName has no extension', () => {
      const data = Buffer.from('data');
      const filePath = saveMediaToWorkspace({
        platform: 'wechat',
        baseDir: tmpDir,
        data,
        defaultExtension: '.mp4',
      });
      expect(filePath).toMatch(/\.mp4$/);
    });
  });
});
