/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { getMediaFileId, getMediaUrl, splitMessage, stripMarkdownToPlain, toUnifiedIncomingMessage, toWeChatSendPayload } from '../../../src/channels/plugins/wechat/WeChatAdapter';
import { MessageItemType, MessageType } from '../../../src/channels/plugins/wechat/types';
import type { WeChatMessage } from '../../../src/channels/plugins/wechat/types';

describe('WeChatAdapter', () => {
  describe('toUnifiedIncomingMessage', () => {
    it('should convert a text message', () => {
      const msg: WeChatMessage = {
        message_id: 1,
        from_user_id: 'user123',
        message_type: MessageType.USER,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: 'Hello' } }],
        create_time_ms: 1700000000000,
      };

      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('text');
      expect(result!.content.text).toBe('Hello');
      expect(result!.content.attachments).toBeUndefined();
      expect(result!.chatId).toBe('user:user123');
    });

    it('should convert an image message', () => {
      const msg: WeChatMessage = {
        message_id: 2,
        from_user_id: 'user123',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.IMAGE,
            image_item: { url: '/path/to/image.jpg', image_id: 'img_001', width: 800, height: 600 },
          },
        ],
        create_time_ms: 1700000000000,
      };

      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('photo');
      expect(result!.content.attachments).toHaveLength(1);
      expect(result!.content.attachments![0].type).toBe('photo');
      expect(result!.content.attachments![0].fileId).toBe('img_001');
      expect(result!.content.attachments![0].mimeType).toBe('image/jpeg');
    });

    it('should convert a voice message', () => {
      const msg: WeChatMessage = {
        message_id: 3,
        from_user_id: 'user123',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.VOICE,
            voice_item: { url: '/path/to/voice.amr', voice_id: 'voice_001', duration: 5000 },
          },
        ],
        create_time_ms: 1700000000000,
      };

      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('voice');
      expect(result!.content.attachments).toHaveLength(1);
      expect(result!.content.attachments![0].type).toBe('voice');
      expect(result!.content.attachments![0].duration).toBe(5000);
    });

    it('should convert a file message', () => {
      const msg: WeChatMessage = {
        message_id: 4,
        from_user_id: 'user123',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.FILE,
            file_item: { url: '/path/to/doc.pdf', file_id: 'file_001', file_name: 'report.pdf', file_size: 1024000 },
          },
        ],
        create_time_ms: 1700000000000,
      };

      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('document');
      expect(result!.content.attachments).toHaveLength(1);
      expect(result!.content.attachments![0].type).toBe('document');
      expect(result!.content.attachments![0].fileName).toBe('report.pdf');
      expect(result!.content.attachments![0].size).toBe(1024000);
    });

    it('should convert a video message', () => {
      const msg: WeChatMessage = {
        message_id: 5,
        from_user_id: 'user123',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.VIDEO,
            video_item: { url: '/path/to/video.mp4', video_id: 'video_001', duration: 30000 },
          },
        ],
        create_time_ms: 1700000000000,
      };

      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('video');
      expect(result!.content.attachments).toHaveLength(1);
      expect(result!.content.attachments![0].type).toBe('video');
      expect(result!.content.attachments![0].duration).toBe(30000);
    });

    it('should handle mixed text and image message', () => {
      const msg: WeChatMessage = {
        message_id: 6,
        from_user_id: 'user123',
        message_type: MessageType.USER,
        item_list: [
          { type: MessageItemType.TEXT, text_item: { text: 'Check this image' } },
          {
            type: MessageItemType.IMAGE,
            image_item: { url: '/path/to/image.jpg', image_id: 'img_002' },
          },
        ],
        create_time_ms: 1700000000000,
      };

      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('photo');
      expect(result!.content.text).toBe('Check this image');
      expect(result!.content.attachments).toHaveLength(1);
    });

    it('should ignore bot messages', () => {
      const msg: WeChatMessage = {
        message_id: 7,
        from_user_id: 'bot123',
        message_type: MessageType.BOT,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: 'Bot response' } }],
      };

      const result = toUnifiedIncomingMessage(msg);
      expect(result).toBeNull();
    });

    it('should ignore messages without user id', () => {
      const msg: WeChatMessage = {
        message_id: 8,
        message_type: MessageType.USER,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: 'No user' } }],
      };

      const result = toUnifiedIncomingMessage(msg);
      expect(result).toBeNull();
    });

    it('should ignore empty messages', () => {
      const msg: WeChatMessage = {
        message_id: 9,
        from_user_id: 'user123',
        message_type: MessageType.USER,
        item_list: [],
      };

      const result = toUnifiedIncomingMessage(msg);
      expect(result).toBeNull();
    });

    it('should handle image with local file path (after download)', () => {
      const localPath = '/tmp/channel-media/wechat/media/photo_12345_abc123.jpg';
      const msg: WeChatMessage = {
        message_id: 10,
        from_user_id: 'user123',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.IMAGE,
            image_item: { url: localPath, image_id: 'img_003' },
          },
        ],
        create_time_ms: 1700000000000,
      };

      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      // When URL is available, fileId should prefer image_id
      expect(result!.content.attachments![0].fileId).toBe('img_003');
    });
  });

  describe('getMediaUrl', () => {
    it('should return URL for image item', () => {
      const item = { type: MessageItemType.IMAGE, image_item: { url: 'https://example.com/img.jpg' } };
      expect(getMediaUrl(item)).toBe('https://example.com/img.jpg');
    });

    it('should return URL for voice item', () => {
      const item = { type: MessageItemType.VOICE, voice_item: { url: 'https://example.com/voice.amr' } };
      expect(getMediaUrl(item)).toBe('https://example.com/voice.amr');
    });

    it('should return URL for file item', () => {
      const item = { type: MessageItemType.FILE, file_item: { url: 'https://example.com/doc.pdf' } };
      expect(getMediaUrl(item)).toBe('https://example.com/doc.pdf');
    });

    it('should return URL for video item', () => {
      const item = { type: MessageItemType.VIDEO, video_item: { url: 'https://example.com/video.mp4' } };
      expect(getMediaUrl(item)).toBe('https://example.com/video.mp4');
    });

    it('should return undefined for text item', () => {
      const item = { type: MessageItemType.TEXT, text_item: { text: 'hello' } };
      expect(getMediaUrl(item)).toBeUndefined();
    });
  });

  describe('getMediaFileId', () => {
    it('should return image_id for image item', () => {
      const item = { type: MessageItemType.IMAGE, image_item: { image_id: 'img_001' } };
      expect(getMediaFileId(item)).toBe('img_001');
    });

    it('should return voice_id for voice item', () => {
      const item = { type: MessageItemType.VOICE, voice_item: { voice_id: 'voice_001' } };
      expect(getMediaFileId(item)).toBe('voice_001');
    });

    it('should return file_id for file item', () => {
      const item = { type: MessageItemType.FILE, file_item: { file_id: 'file_001' } };
      expect(getMediaFileId(item)).toBe('file_001');
    });

    it('should return video_id for video item', () => {
      const item = { type: MessageItemType.VIDEO, video_item: { video_id: 'video_001' } };
      expect(getMediaFileId(item)).toBe('video_001');
    });
  });

  describe('stripMarkdownToPlain', () => {
    it('should strip bold markdown', () => {
      expect(stripMarkdownToPlain('**bold**')).toBe('bold');
    });

    it('should strip code blocks', () => {
      expect(stripMarkdownToPlain('```js\ncode\n```')).toBe('code');
    });

    it('should strip inline code', () => {
      expect(stripMarkdownToPlain('`code`')).toBe('code');
    });

    it('should strip image markdown', () => {
      expect(stripMarkdownToPlain('![alt](url)')).toBe('');
    });

    it('should strip link markdown keeping text', () => {
      expect(stripMarkdownToPlain('[text](url)')).toBe('text');
    });
  });

  describe('splitMessage', () => {
    it('should not split short messages', () => {
      const result = splitMessage('Hello world', 100);
      expect(result).toEqual(['Hello world']);
    });

    it('should split long messages', () => {
      const long = 'A'.repeat(5000);
      const result = splitMessage(long, 4000);
      expect(result.length).toBeGreaterThan(1);
      expect(result.join('').length).toBe(5000);
    });
  });

  describe('toWeChatSendPayload', () => {
    it('should create a text payload', () => {
      const result = toWeChatSendPayload('user123', { type: 'text', text: 'Hello' }, 'ctx_token_123');
      expect(result.msg?.to_user_id).toBe('user123');
      expect(result.msg?.context_token).toBe('ctx_token_123');
      expect(result.msg?.item_list?.[0]?.type).toBe(MessageItemType.TEXT);
      expect(result.msg?.item_list?.[0]?.text_item?.text).toBe('Hello');
    });
  });
});
