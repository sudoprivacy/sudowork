/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMediaWorkspacePath, saveMediaToWorkspace } from '@/channels/utils/mediaDownloader';

// Mock getDataPath to return a temp directory
vi.mock('@/process/utils', () => ({
  getDataPath: () => '/tmp/sudowork-test',
}));

describe('mediaDownloader', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getMediaWorkspacePath', () => {
    it('should return correct path for wechat platform', () => {
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
      const result = getMediaWorkspacePath('wechat');
      expect(result).toBe(path.join('/tmp/sudowork-test', 'channel-media', 'wechat'));
      expect(mkdirSpy).toHaveBeenCalledWith(expect.stringContaining('channel-media/wechat'), { recursive: true });
    });

    it('should return correct path for telegram platform', () => {
      vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
      const result = getMediaWorkspacePath('telegram');
      expect(result).toBe(path.join('/tmp/sudowork-test', 'channel-media', 'telegram'));
    });

    it('should create directory recursively', () => {
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
      getMediaWorkspacePath('lark');
      expect(mkdirSpy).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });
  });

  describe('saveMediaToWorkspace', () => {
    it('should save buffer to file and return path', async () => {
      vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
      const writeFileSpy = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);

      const data = Buffer.from('fake image data');
      const result = await saveMediaToWorkspace('wechat', data, '.jpg');

      expect(result).toContain('channel-media/wechat/media_');
      expect(result).toContain('.jpg');
      expect(writeFileSpy).toHaveBeenCalledWith(expect.stringContaining('.jpg'), data);
    });

    it('should use custom prefix', async () => {
      vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);

      const data = Buffer.from('fake voice data');
      const result = await saveMediaToWorkspace('wechat', data, '.mp3', 'voice');

      expect(result).toContain('voice_');
      expect(result).toContain('.mp3');
    });

    it('should generate unique filenames', async () => {
      vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);

      const data = Buffer.from('data');
      const path1 = await saveMediaToWorkspace('wechat', data, '.jpg');
      const path2 = await saveMediaToWorkspace('wechat', data, '.jpg');

      expect(path1).not.toBe(path2);
    });
  });
});
