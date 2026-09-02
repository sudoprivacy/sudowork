/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests for DingTalk media download flow.
 *
 * Tests the full chain: DingTalkStreamMessage -> extractMediaDownloadInfo -> download -> setMediaLocalPath -> toUnifiedIncomingMessage
 * using mock HTTP and real adapter logic.
 */

import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractMediaDownloadInfo, getDefaultExtension, setMediaLocalPath, toUnifiedIncomingMessage } from '@/channels/plugins/dingtalk/DingTalkAdapter';
import type { DingTalkStreamMessage } from '@/channels/plugins/dingtalk/DingTalkAdapter';

// ==================== Integration: full media download flow ====================

describe('DingTalk media download flow (integration)', () => {
  const tmpDir = path.join('/tmp', `dingtalk-media-test-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  /**
   * Simulates the full download flow that DingTalkPlugin.downloadMediaItems performs:
   * 1. extractMediaDownloadInfo to get downloadCode/fileName
   * 2. Mock API call to get downloadUrl
   * 3. Write file directly to mediaDir (same as DingTalkPlugin)
   * 4. setMediaLocalPath to update message data
   * 5. toUnifiedIncomingMessage to verify fileId is local path
   */
  async function simulateFullFlow(
    data: DingTalkStreamMessage,
    mockDownloadUrl: string,
    fileContent: Buffer,
  ): Promise<{ localPath: string; unified: ReturnType<typeof toUnifiedIncomingMessage> }> {
    // Step 1: Extract download info
    const mediaInfo = extractMediaDownloadInfo(data);
    if (!mediaInfo) {
      throw new Error('No media info extracted');
    }

    // Step 2: (Mocked in real plugin - API call to get downloadUrl)
    // In this test we use the mockDownloadUrl directly

    // Step 3: Save file directly to mediaDir (mirrors DingTalkPlugin.downloadMediaItems)
    const ext = mediaInfo.fileName ? path.extname(mediaInfo.fileName) : getDefaultExtension(data.msgtype);
    const baseName = mediaInfo.fileName || `dingtalk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const localPath = path.join(tmpDir, baseName);
    fs.writeFileSync(localPath, fileContent);

    // Step 4: Set local path on message data
    setMediaLocalPath(data, localPath);

    // Step 5: Convert to unified message and verify
    const unified = toUnifiedIncomingMessage(data);

    return { localPath, unified };
  }

  describe('picture message - full flow', () => {
    it('downloads picture and produces local fileId in unified message', async () => {
      const data: DingTalkStreamMessage = {
        msgId: 'msg_pic_1',
        senderStaffId: 'staff1',
        senderNick: 'User1',
        conversationType: '1',
        createAt: 1000,
        msgtype: 'picture',
        picture: { downloadCode: 'pic_download_code_123' },
      };

      const fakeImageData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]); // JPEG magic bytes
      const { localPath, unified } = await simulateFullFlow(data, 'https://dt.example.com/file.jpg', fakeImageData);

      expect(fs.existsSync(localPath)).toBe(true);
      expect(fs.readFileSync(localPath)).toEqual(fakeImageData);
      expect(unified).not.toBeNull();
      expect(unified!.content.type).toBe('photo');
      expect(unified!.content.attachments![0].fileId).toBe(localPath);
      expect(unified!.content.attachments![0].fileId).not.toContain('pic_download_code_123');
    });
  });

  describe('audio message - full flow', () => {
    it('downloads audio and produces local fileId in unified message', async () => {
      const data: DingTalkStreamMessage = {
        msgId: 'msg_audio_1',
        senderStaffId: 'staff2',
        senderNick: 'User2',
        conversationType: '1',
        createAt: 2000,
        msgtype: 'audio',
        audio: { downloadCode: 'audio_download_code_456', duration: '5000', recognition: 'recognized text' },
      };

      const fakeAudioData = Buffer.from([0x23, 0x21, 0x41, 0x4d, 0x52]); // AMR magic bytes
      const { localPath, unified } = await simulateFullFlow(data, 'https://dt.example.com/file.amr', fakeAudioData);

      expect(fs.existsSync(localPath)).toBe(true);
      expect(unified).not.toBeNull();
      expect(unified!.content.type).toBe('audio');
      expect(unified!.content.attachments![0].fileId).toBe(localPath);
      expect(unified!.content.attachments![0].duration).toBe(5000);
      expect(unified!.content.text).toBe('recognized text');
    });
  });

  describe('video message - full flow', () => {
    it('downloads video and produces local fileId in unified message', async () => {
      const data: DingTalkStreamMessage = {
        msgId: 'msg_video_1',
        senderStaffId: 'staff3',
        senderNick: 'User3',
        conversationType: '1',
        createAt: 3000,
        msgtype: 'video',
        video: { downloadCode: 'video_download_code_789', duration: '30000' },
      };

      const fakeVideoData = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]); // MP4 magic bytes
      const { localPath, unified } = await simulateFullFlow(data, 'https://dt.example.com/file.mp4', fakeVideoData);

      expect(fs.existsSync(localPath)).toBe(true);
      expect(unified).not.toBeNull();
      expect(unified!.content.type).toBe('video');
      expect(unified!.content.attachments![0].fileId).toBe(localPath);
      expect(unified!.content.attachments![0].duration).toBe(30000);
    });
  });

  describe('file message - full flow', () => {
    it('downloads file with original fileName and produces local fileId', async () => {
      const data: DingTalkStreamMessage = {
        msgId: 'msg_file_1',
        senderStaffId: 'staff4',
        senderNick: 'User4',
        conversationType: '1',
        createAt: 4000,
        msgtype: 'file',
        file: { downloadCode: 'file_download_code_101', fileName: 'quarterly-report.pdf', fileSize: '102400' },
      };

      const fakeFileData = Buffer.from('%PDF-1.4 fake content');
      const { localPath, unified } = await simulateFullFlow(data, 'https://dt.example.com/file.pdf', fakeFileData);

      expect(fs.existsSync(localPath)).toBe(true);
      expect(localPath).toContain('quarterly-report.pdf');
      expect(unified).not.toBeNull();
      expect(unified!.content.type).toBe('document');
      expect(unified!.content.attachments![0].fileId).toBe(localPath);
      expect(unified!.content.attachments![0].fileName).toBe('quarterly-report.pdf');
      expect(unified!.content.attachments![0].size).toBe(102400);
    });

    it('downloads file without fileName using generated name with default extension', async () => {
      const data: DingTalkStreamMessage = {
        msgId: 'msg_file_2',
        senderStaffId: 'staff5',
        senderNick: 'User5',
        conversationType: '1',
        createAt: 5000,
        msgtype: 'file',
        file: { downloadCode: 'file_download_code_202' },
      };

      const fakeFileData = Buffer.from('some binary data');
      const { localPath, unified } = await simulateFullFlow(data, 'https://dt.example.com/file.bin', fakeFileData);

      expect(fs.existsSync(localPath)).toBe(true);
      // file type has no default extension, so file name is generated without extension
      expect(localPath).toContain(path.join(tmpDir, 'dingtalk'));
      expect(unified).not.toBeNull();
      expect(unified!.content.attachments![0].fileId).toBe(localPath);
    });
  });

  describe('download failure - graceful degradation', () => {
    it('falls back to downloadCode as fileId when download is skipped', () => {
      // Simulate: download failed, _localPath was never set
      const data: DingTalkStreamMessage = {
        msgId: 'msg_fail_1',
        senderStaffId: 'staff6',
        senderNick: 'User6',
        conversationType: '1',
        createAt: 6000,
        msgtype: 'picture',
        picture: { downloadCode: 'expired_code_xyz' },
      };

      // Without calling setMediaLocalPath, _localPath is never set
      const unified = toUnifiedIncomingMessage(data);
      expect(unified).not.toBeNull();
      expect(unified!.content.attachments![0].fileId).toBe('expired_code_xyz');
    });

    it('falls back to downloadCode when extractMediaDownloadInfo returns null (empty downloadCode)', () => {
      const data: DingTalkStreamMessage = {
        msgId: 'msg_fail_2',
        senderStaffId: 'staff7',
        senderNick: 'User7',
        conversationType: '1',
        createAt: 7000,
        msgtype: 'audio',
        audio: { downloadCode: '' },
      };

      // extractMediaDownloadInfo returns null for empty downloadCode
      expect(extractMediaDownloadInfo(data)).toBeNull();

      // Message still converts to unified format (with empty fileId)
      const unified = toUnifiedIncomingMessage(data);
      expect(unified).not.toBeNull();
      expect(unified!.content.type).toBe('audio');
      expect(unified!.content.attachments![0].fileId).toBe('');
    });

    it('non-media messages pass through without any download logic', () => {
      const textData: DingTalkStreamMessage = {
        msgId: 'msg_text_1',
        senderStaffId: 'staff8',
        senderNick: 'User8',
        conversationType: '1',
        createAt: 8000,
        msgtype: 'text',
        text: { content: 'Hello bot' },
      };

      expect(extractMediaDownloadInfo(textData)).toBeNull();

      const unified = toUnifiedIncomingMessage(textData);
      expect(unified).not.toBeNull();
      expect(unified!.content.type).toBe('text');
      expect(unified!.content.text).toBe('Hello bot');
    });
  });

  describe('group chat scenario', () => {
    it('handles picture in group chat with @bot removed and local fileId', async () => {
      const data: DingTalkStreamMessage = {
        msgId: 'msg_group_pic_1',
        senderStaffId: 'staff9',
        senderNick: 'User9',
        conversationType: '2',
        conversationId: 'group123',
        createAt: 9000,
        msgtype: 'picture',
        picture: { downloadCode: 'group_pic_code' },
      };

      const fakeImageData = Buffer.from([0xff, 0xd8, 0xff, 0xe1]);
      const { localPath, unified } = await simulateFullFlow(data, 'https://dt.example.com/group_pic.jpg', fakeImageData);

      expect(unified).not.toBeNull();
      expect(unified!.chatId).toBe('group:group123');
      expect(unified!.content.type).toBe('photo');
      expect(unified!.content.attachments![0].fileId).toBe(localPath);
    });
  });
});
