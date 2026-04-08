/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateMediaFilename, ensureMediaDir, saveMediaToWorkspace } from '../../../src/channels/utils/mediaDownloader';
import type { IUnifiedAttachment } from '../../../src/channels/types';

// Mock fs to avoid writing real files
vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

describe('mediaDownloader', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateMediaFilename', () => {
    it('should generate filename for image attachment', () => {
      const attachment: IUnifiedAttachment = {
        type: 'photo',
        fileId: 'img_001',
        mimeType: 'image/jpeg',
      };
      const filename = generateMediaFilename(attachment);
      expect(filename).toMatch(/^photo_\d+_[a-z0-9]+\.jpg$/);
    });

    it('should generate filename for document with name', () => {
      const attachment: IUnifiedAttachment = {
        type: 'document',
        fileId: 'file_001',
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
      };
      const filename = generateMediaFilename(attachment);
      expect(filename).toMatch(/^report_\d+_[a-z0-9]+\.pdf$/);
    });

    it('should generate filename for voice attachment', () => {
      const attachment: IUnifiedAttachment = {
        type: 'voice',
        fileId: 'voice_001',
        mimeType: 'audio/amr',
      };
      const filename = generateMediaFilename(attachment);
      expect(filename).toMatch(/^voice_\d+_[a-z0-9]+\.amr$/);
    });

    it('should generate filename for video attachment', () => {
      const attachment: IUnifiedAttachment = {
        type: 'video',
        fileId: 'video_001',
        mimeType: 'video/mp4',
      };
      const filename = generateMediaFilename(attachment);
      expect(filename).toMatch(/^video_\d+_[a-z0-9]+\.mp4$/);
    });

    it('should use .bin extension for unknown mime types', () => {
      const attachment: IUnifiedAttachment = {
        type: 'document',
        fileId: 'file_001',
      };
      const filename = generateMediaFilename(attachment);
      expect(filename).toMatch(/^document_\d+_[a-z0-9]+\.bin$/);
    });
  });

  describe('ensureMediaDir', () => {
    it('should create media directory path', () => {
      const result = ensureMediaDir('/workspace', 'wechat');
      expect(result).toBe(path.join('/workspace', 'wechat', 'media'));
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('/workspace', 'wechat', 'media'), { recursive: true });
    });
  });

  describe('saveMediaToWorkspace', () => {
    it('should save buffer to workspace and return path', () => {
      const buffer = Buffer.from('fake image data');
      const attachment: IUnifiedAttachment = {
        type: 'photo',
        fileId: 'img_001',
        mimeType: 'image/jpeg',
      };

      const result = saveMediaToWorkspace(buffer, '/workspace', 'wechat', attachment);
      expect(result).toContain(path.join('/workspace', 'wechat', 'media'));
      expect(result).toMatch(/\.jpg$/);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });
});
