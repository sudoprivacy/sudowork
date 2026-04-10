/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  encodeChatId,
  getDefaultExtension,
  parseChatId,
  toUnifiedIncomingMessage,
} from '@/channels/plugins/wecom/WeComAdapter';
import type { WeComMsgCallback } from '@/channels/plugins/wecom/WeComAdapter';

/** Helper: create a minimal WeCom message callback */
function makeMsg(overrides: Partial<WeComMsgCallback> & Pick<WeComMsgCallback, 'msgtype'>): WeComMsgCallback {
  return {
    msgid: 'msg-001',
    aibotid: 'bot-001',
    chattype: 'single',
    from: { userid: 'user001', name: 'Test User' },
    ...overrides,
  };
}

describe('WeComAdapter', () => {
  describe('encodeChatId / parseChatId', () => {
    it('encodes single chat as user:<userid>', () => {
      const msg = makeMsg({ msgtype: 'text', chattype: 'single' });
      expect(encodeChatId(msg)).toBe('user:user001');
    });

    it('encodes group chat as group:<chatid>', () => {
      const msg = makeMsg({ msgtype: 'text', chattype: 'group', chatid: 'group-123' });
      expect(encodeChatId(msg)).toBe('group:group-123');
    });

    it('parses user: prefix', () => {
      expect(parseChatId('user:abc')).toEqual({ type: 'user', id: 'abc' });
    });

    it('parses group: prefix', () => {
      expect(parseChatId('group:xyz')).toEqual({ type: 'group', id: 'xyz' });
    });
  });

  describe('getDefaultExtension', () => {
    it('returns .jpg for image', () => {
      expect(getDefaultExtension('image')).toBe('.jpg');
    });

    it('returns .mp4 for video', () => {
      expect(getDefaultExtension('video')).toBe('.mp4');
    });

    it('returns .amr for voice', () => {
      expect(getDefaultExtension('voice')).toBe('.amr');
    });

    it('returns empty string for file', () => {
      expect(getDefaultExtension('file')).toBe('');
    });

    it('returns empty string for unknown type', () => {
      expect(getDefaultExtension('unknown')).toBe('');
    });
  });

  describe('toUnifiedIncomingMessage - text', () => {
    it('converts text message', () => {
      const msg = makeMsg({ msgtype: 'text', text: { content: 'Hello world' } });
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('text');
      expect(result!.content.text).toBe('Hello world');
      expect(result!.platform).toBe('wecom');
    });

    it('strips @mentions in group text', () => {
      const msg = makeMsg({
        msgtype: 'text',
        chattype: 'group',
        chatid: 'grp1',
        text: { content: '@Bot hello there' },
      });
      const result = toUnifiedIncomingMessage(msg);
      expect(result!.content.text).toBe('hello there');
    });
  });

  describe('toUnifiedIncomingMessage - voice', () => {
    it('converts voice message to text (transcription)', () => {
      const msg = makeMsg({ msgtype: 'voice', voice: { content: 'transcribed text' } });
      const result = toUnifiedIncomingMessage(msg);
      expect(result!.content.type).toBe('text');
      expect(result!.content.text).toBe('transcribed text');
    });
  });

  describe('toUnifiedIncomingMessage - image', () => {
    it('uses _imageLocalPath when available (after download)', () => {
      const msg = makeMsg({
        msgtype: 'image',
        image: { url: 'https://cdn.example.com/encrypted.jpg', aeskey: 'xxx' },
        _imageLocalPath: '/tmp/channel-media/wecom/image_123.jpg',
      });
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('photo');
      expect(result!.content.attachments).toHaveLength(1);
      expect(result!.content.attachments![0].fileId).toBe('/tmp/channel-media/wecom/image_123.jpg');
      expect(result!.content.attachments![0].type).toBe('photo');
    });

    it('falls back to URL when no local path', () => {
      const msg = makeMsg({
        msgtype: 'image',
        image: { url: 'https://cdn.example.com/encrypted.jpg', aeskey: 'xxx' },
      });
      const result = toUnifiedIncomingMessage(msg);
      expect(result!.content.attachments![0].fileId).toBe('https://cdn.example.com/encrypted.jpg');
    });
  });

  describe('toUnifiedIncomingMessage - file', () => {
    it('uses _fileLocalPath when available', () => {
      const msg = makeMsg({
        msgtype: 'file',
        file: { url: 'https://cdn.example.com/enc.pdf', aeskey: 'yyy', filename: 'report.pdf', filesize: 50000 },
        _fileLocalPath: '/tmp/channel-media/wecom/report.pdf',
      });
      const result = toUnifiedIncomingMessage(msg);
      expect(result!.content.type).toBe('document');
      expect(result!.content.attachments![0].fileId).toBe('/tmp/channel-media/wecom/report.pdf');
      expect(result!.content.attachments![0].fileName).toBe('report.pdf');
      expect(result!.content.attachments![0].size).toBe(50000);
    });

    it('falls back to URL when no local path', () => {
      const msg = makeMsg({
        msgtype: 'file',
        file: { url: 'https://cdn.example.com/enc.pdf', aeskey: 'yyy', filename: 'report.pdf' },
      });
      const result = toUnifiedIncomingMessage(msg);
      expect(result!.content.attachments![0].fileId).toBe('https://cdn.example.com/enc.pdf');
    });
  });

  describe('toUnifiedIncomingMessage - video', () => {
    it('uses _videoLocalPath when available', () => {
      const msg = makeMsg({
        msgtype: 'video',
        video: { url: 'https://cdn.example.com/enc.mp4', aeskey: 'zzz' },
        _videoLocalPath: '/tmp/channel-media/wecom/video_456.mp4',
      });
      const result = toUnifiedIncomingMessage(msg);
      expect(result!.content.type).toBe('video');
      expect(result!.content.attachments![0].fileId).toBe('/tmp/channel-media/wecom/video_456.mp4');
    });

    it('falls back to URL when no local path', () => {
      const msg = makeMsg({
        msgtype: 'video',
        video: { url: 'https://cdn.example.com/enc.mp4', aeskey: 'zzz' },
      });
      const result = toUnifiedIncomingMessage(msg);
      expect(result!.content.attachments![0].fileId).toBe('https://cdn.example.com/enc.mp4');
    });
  });

  describe('toUnifiedIncomingMessage - mixed', () => {
    it('extracts text and image attachments from mixed message (msg_item)', () => {
      const msg = makeMsg({
        msgtype: 'mixed',
        mixed: {
          msg_item: [
            { msgtype: 'text', text: { content: 'Check this image' } },
            {
              msgtype: 'image',
              image: { url: 'https://cdn.example.com/img.jpg', aeskey: 'key1' },
              _localPath: '/tmp/channel-media/wecom/img_001.jpg',
            },
          ],
        },
      });
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.text).toBe('Check this image');
      expect(result!.content.type).toBe('photo');
      expect(result!.content.attachments).toHaveLength(1);
      expect(result!.content.attachments![0].fileId).toBe('/tmp/channel-media/wecom/img_001.jpg');
    });

    it('falls back to "items" field for backward compatibility', () => {
      const msg = makeMsg({
        msgtype: 'mixed',
        mixed: {
          items: [
            { msgtype: 'text', text: { content: 'Legacy format' } },
            {
              msgtype: 'image',
              image: { url: 'https://cdn.example.com/img.jpg', aeskey: 'key1' },
              _localPath: '/tmp/channel-media/wecom/img_legacy.jpg',
            },
          ],
        },
      });
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.text).toBe('Legacy format');
      expect(result!.content.type).toBe('photo');
      expect(result!.content.attachments).toHaveLength(1);
      expect(result!.content.attachments![0].fileId).toBe('/tmp/channel-media/wecom/img_legacy.jpg');
    });

    it('falls back to URL for mixed image without local path', () => {
      const msg = makeMsg({
        msgtype: 'mixed',
        mixed: {
          msg_item: [
            { msgtype: 'text', text: { content: 'Look' } },
            { msgtype: 'image', image: { url: 'https://cdn.example.com/img.jpg', aeskey: 'key1' } },
          ],
        },
      });
      const result = toUnifiedIncomingMessage(msg);
      expect(result!.content.attachments![0].fileId).toBe('https://cdn.example.com/img.jpg');
    });

    it('handles text-only mixed message (no images)', () => {
      const msg = makeMsg({
        msgtype: 'mixed',
        mixed: {
          msg_item: [
            { msgtype: 'text', text: { content: 'Part one' } },
            { msgtype: 'text', text: { content: 'Part two' } },
          ],
        },
      });
      const result = toUnifiedIncomingMessage(msg);
      expect(result!.content.type).toBe('text');
      expect(result!.content.text).toBe('Part one\nPart two');
      expect(result!.content.attachments).toBeUndefined();
    });

    it('handles multiple images in mixed message', () => {
      const msg = makeMsg({
        msgtype: 'mixed',
        mixed: {
          msg_item: [
            { msgtype: 'text', text: { content: 'Two pics' } },
            {
              msgtype: 'image',
              image: { url: 'https://cdn.example.com/1.jpg', aeskey: 'k1' },
              _localPath: '/tmp/1.jpg',
            },
            {
              msgtype: 'image',
              image: { url: 'https://cdn.example.com/2.jpg', aeskey: 'k2' },
              _localPath: '/tmp/2.jpg',
            },
          ],
        },
      });
      const result = toUnifiedIncomingMessage(msg);
      expect(result!.content.attachments).toHaveLength(2);
      expect(result!.content.attachments![0].fileId).toBe('/tmp/1.jpg');
      expect(result!.content.attachments![1].fileId).toBe('/tmp/2.jpg');
    });

    it('supports "type" field (alternative to "msgtype") for mixed items', () => {
      const msg = makeMsg({
        msgtype: 'mixed',
        mixed: {
          msg_item: [
            { type: 'text', text: { content: 'Hello from type field' } },
            {
              type: 'image',
              image: { url: 'https://cdn.example.com/img.jpg', aeskey: 'key1' },
              _localPath: '/tmp/channel-media/wecom/img_type.jpg',
            },
          ],
        },
      });
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.text).toBe('Hello from type field');
      expect(result!.content.type).toBe('photo');
      expect(result!.content.attachments).toHaveLength(1);
      expect(result!.content.attachments![0].fileId).toBe('/tmp/channel-media/wecom/img_type.jpg');
    });

    it('handles image-only mixed message (no text parts)', () => {
      const msg = makeMsg({
        msgtype: 'mixed',
        mixed: {
          msg_item: [
            {
              msgtype: 'image',
              image: { url: 'https://cdn.example.com/img.jpg', aeskey: 'key1' },
            },
          ],
        },
      });
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('photo');
      expect(result!.content.text).toBe('');
      expect(result!.content.attachments).toHaveLength(1);
      expect(result!.content.attachments![0].fileId).toBe('https://cdn.example.com/img.jpg');
    });
  });

  describe('toUnifiedIncomingMessage - edge cases', () => {
    it('returns null for missing from.userid', () => {
      const msg = makeMsg({ msgtype: 'text', from: { userid: '' } });
      expect(toUnifiedIncomingMessage(msg)).toBeNull();
    });

    it('handles unknown msgtype gracefully', () => {
      const msg = makeMsg({ msgtype: 'location' });
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('text');
      expect(result!.content.text).toBe('');
    });
  });
});
