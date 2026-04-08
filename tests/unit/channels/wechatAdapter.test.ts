/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { getMediaUrl, splitMessage, stripMarkdownToPlain, toUnifiedIncomingMessage, toWeChatSendPayload } from '@/channels/plugins/wechat/WeChatAdapter';
import type { WeChatMessage, WeChatMessageItem } from '@/channels/plugins/wechat/types';
import { MessageItemType, MessageType, MessageState } from '@/channels/plugins/wechat/types';

describe('WeChatAdapter', () => {
  // ==================== getMediaUrl ====================
  describe('getMediaUrl', () => {
    it('should extract URL from image_item', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.IMAGE,
        image_item: {
          media: { full_url: 'https://cdn.weixin.qq.com/image/abc' },
          hd_size: 12345,
        },
      };
      expect(getMediaUrl(item)).toBe('https://cdn.weixin.qq.com/image/abc');
    });

    it('should extract URL from voice_item', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.VOICE,
        voice_item: {
          media: { full_url: 'https://cdn.weixin.qq.com/voice/def' },
          duration_ms: 5000,
        },
      };
      expect(getMediaUrl(item)).toBe('https://cdn.weixin.qq.com/voice/def');
    });

    it('should extract URL from file_item', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.FILE,
        file_item: {
          media: { full_url: 'https://cdn.weixin.qq.com/file/ghi' },
          file_name: 'doc.pdf',
        },
      };
      expect(getMediaUrl(item)).toBe('https://cdn.weixin.qq.com/file/ghi');
    });

    it('should extract URL from video_item', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.VIDEO,
        video_item: {
          media: { full_url: 'https://cdn.weixin.qq.com/video/jkl' },
          duration_ms: 10000,
        },
      };
      expect(getMediaUrl(item)).toBe('https://cdn.weixin.qq.com/video/jkl');
    });

    it('should return undefined for text item', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.TEXT,
        text_item: { text: 'hello' },
      };
      expect(getMediaUrl(item)).toBeUndefined();
    });

    it('should return undefined when media object has no full_url', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.IMAGE,
        image_item: {
          media: { aes_key: 'key123' },
        },
      };
      expect(getMediaUrl(item)).toBeUndefined();
    });

    it('should return undefined for empty item', () => {
      const item: WeChatMessageItem = { type: MessageItemType.IMAGE };
      expect(getMediaUrl(item)).toBeUndefined();
    });
  });

  // ==================== toUnifiedIncomingMessage ====================
  describe('toUnifiedIncomingMessage', () => {
    it('should convert text message', () => {
      const msg: WeChatMessage = {
        message_id: 12345,
        from_user_id: 'user123@im.wechat',
        message_type: MessageType.USER,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: 'hello world' } }],
        create_time_ms: 1700000000000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('text');
      expect(result!.content.text).toBe('hello world');
      expect(result!.content.attachments).toBeUndefined();
      expect(result!.platform).toBe('wechat');
      expect(result!.chatId).toBe('user:user123@im.wechat');
    });

    it('should convert image message with _localPath', () => {
      const msg: WeChatMessage = {
        message_id: 12346,
        from_user_id: 'user123@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.IMAGE,
            image_item: {
              media: { full_url: 'https://cdn.weixin.qq.com/image/abc' },
              hd_size: 346911,
            },
            _localPath: '/data/channel-media/wechat/media_123.jpg',
          },
        ],
        create_time_ms: 1700000000000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('photo');
      expect(result!.content.attachments).toHaveLength(1);
      expect(result!.content.attachments![0].type).toBe('photo');
      expect(result!.content.attachments![0].fileId).toBe('/data/channel-media/wechat/media_123.jpg');
      expect(result!.content.attachments![0].mimeType).toBe('image/jpeg');
      expect(result!.content.attachments![0].size).toBe(346911);
    });

    it('should use CDN URL as fileId when no _localPath', () => {
      const msg: WeChatMessage = {
        message_id: 12347,
        from_user_id: 'user123@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.IMAGE,
            image_item: {
              media: { full_url: 'https://cdn.weixin.qq.com/image/abc' },
            },
          },
        ],
        create_time_ms: 1700000000000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.attachments![0].fileId).toBe('https://cdn.weixin.qq.com/image/abc');
    });

    it('should convert voice message', () => {
      const msg: WeChatMessage = {
        message_id: 12348,
        from_user_id: 'user123@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.VOICE,
            voice_item: {
              media: { full_url: 'https://cdn.weixin.qq.com/voice/abc' },
              duration_ms: 3000,
              file_size: 24000,
            },
            _localPath: '/data/channel-media/wechat/media_voice.mp3',
          },
        ],
        create_time_ms: 1700000000000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('voice');
      expect(result!.content.attachments![0].type).toBe('voice');
      expect(result!.content.attachments![0].duration).toBe(3000);
      expect(result!.content.attachments![0].size).toBe(24000);
    });

    it('should convert file message with file name', () => {
      const msg: WeChatMessage = {
        message_id: 12349,
        from_user_id: 'user123@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.FILE,
            file_item: {
              media: { full_url: 'https://cdn.weixin.qq.com/file/abc' },
              file_name: 'document.pdf',
              file_size: 1024000,
            },
            _localPath: '/data/channel-media/wechat/media_doc.pdf',
          },
        ],
        create_time_ms: 1700000000000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('document');
      expect(result!.content.attachments![0].type).toBe('document');
      expect(result!.content.attachments![0].fileName).toBe('document.pdf');
      expect(result!.content.attachments![0].size).toBe(1024000);
    });

    it('should convert video message', () => {
      const msg: WeChatMessage = {
        message_id: 12350,
        from_user_id: 'user123@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.VIDEO,
            video_item: {
              media: { full_url: 'https://cdn.weixin.qq.com/video/abc' },
              duration_ms: 15000,
              file_size: 5000000,
            },
            _localPath: '/data/channel-media/wechat/media_video.mp4',
          },
        ],
        create_time_ms: 1700000000000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('video');
      expect(result!.content.attachments![0].type).toBe('video');
      expect(result!.content.attachments![0].mimeType).toBe('video/mp4');
    });

    it('should handle mixed text and image items', () => {
      const msg: WeChatMessage = {
        message_id: 12351,
        from_user_id: 'user123@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          { type: MessageItemType.TEXT, text_item: { text: 'Look at this:' } },
          {
            type: MessageItemType.IMAGE,
            image_item: {
              media: { full_url: 'https://cdn.weixin.qq.com/image/abc' },
            },
            _localPath: '/data/media/img.jpg',
          },
        ],
        create_time_ms: 1700000000000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('photo');
      expect(result!.content.text).toBe('Look at this:');
      expect(result!.content.attachments).toHaveLength(1);
    });

    it('should ignore bot messages', () => {
      const msg: WeChatMessage = {
        message_id: 12352,
        from_user_id: 'user123@im.wechat',
        message_type: MessageType.BOT,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: 'bot response' } }],
      };
      expect(toUnifiedIncomingMessage(msg)).toBeNull();
    });

    it('should return null for empty message', () => {
      const msg: WeChatMessage = {
        message_id: 12353,
        from_user_id: 'user123@im.wechat',
        message_type: MessageType.USER,
        item_list: [],
      };
      expect(toUnifiedIncomingMessage(msg)).toBeNull();
    });

    it('should return null when from_user_id is empty', () => {
      const msg: WeChatMessage = {
        message_id: 12354,
        from_user_id: '',
        message_type: MessageType.USER,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: 'hello' } }],
      };
      expect(toUnifiedIncomingMessage(msg)).toBeNull();
    });

    it('should provide placeholder text for media without text', () => {
      const msg: WeChatMessage = {
        message_id: 12355,
        from_user_id: 'user123@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.IMAGE,
            image_item: { media: { full_url: 'https://cdn.weixin.qq.com/image/abc' } },
            _localPath: '/data/img.jpg',
          },
        ],
        create_time_ms: 1700000000000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.text).toBe('[photo message]');
    });

    it('should skip media items without URL or local path', () => {
      const msg: WeChatMessage = {
        message_id: 12356,
        from_user_id: 'user123@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          { type: MessageItemType.IMAGE, image_item: {} },
          { type: MessageItemType.TEXT, text_item: { text: 'fallback text' } },
        ],
        create_time_ms: 1700000000000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('text');
      expect(result!.content.text).toBe('fallback text');
      expect(result!.content.attachments).toBeUndefined();
    });
  });

  // ==================== toWeChatSendPayload ====================
  describe('toWeChatSendPayload', () => {
    it('should create a send payload', () => {
      const payload = toWeChatSendPayload('user123', { type: 'text', text: 'Hello!' }, 'ctx-token');
      expect(payload.msg?.to_user_id).toBe('user123');
      expect(payload.msg?.message_type).toBe(MessageType.BOT);
      expect(payload.msg?.message_state).toBe(MessageState.FINISH);
      expect(payload.msg?.context_token).toBe('ctx-token');
      expect(payload.msg?.item_list?.[0]?.text_item?.text).toBe('Hello!');
    });

    it('should strip markdown from text', () => {
      const payload = toWeChatSendPayload('user123', { type: 'text', text: '**bold** _italic_' }, 'ctx');
      expect(payload.msg?.item_list?.[0]?.text_item?.text).toBe('bold italic');
    });
  });

  // ==================== stripMarkdownToPlain ====================
  describe('stripMarkdownToPlain', () => {
    it('should strip bold markers', () => {
      expect(stripMarkdownToPlain('**bold text**')).toBe('bold text');
    });

    it('should strip italic markers', () => {
      expect(stripMarkdownToPlain('*italic*')).toBe('italic');
    });

    it('should strip links keeping text', () => {
      expect(stripMarkdownToPlain('[click here](https://example.com)')).toBe('click here');
    });

    it('should strip code fences', () => {
      expect(stripMarkdownToPlain('```js\nconst x = 1;\n```')).toBe('const x = 1;');
    });

    it('should strip inline code', () => {
      expect(stripMarkdownToPlain('use `const` keyword')).toBe('use const keyword');
    });

    it('should strip headers', () => {
      expect(stripMarkdownToPlain('## Title')).toBe('Title');
    });

    it('should handle HTML entities', () => {
      expect(stripMarkdownToPlain('&lt;div&gt;')).toBe('<div>');
    });
  });

  // ==================== splitMessage ====================
  describe('splitMessage', () => {
    it('should return single chunk for short message', () => {
      expect(splitMessage('short')).toEqual(['short']);
    });

    it('should split long message at newlines', () => {
      const text = 'a'.repeat(3500) + '\n' + 'b'.repeat(1500);
      const chunks = splitMessage(text, 4000);
      expect(chunks.length).toBe(2);
      expect(chunks[0]).toBe('a'.repeat(3500));
      expect(chunks[1]).toBe('b'.repeat(1500));
    });

    it('should handle message with no good split points', () => {
      const text = 'a'.repeat(5000);
      const chunks = splitMessage(text, 4000);
      expect(chunks.length).toBe(2);
      expect(chunks[0].length).toBe(4000);
      expect(chunks[1].length).toBe(1000);
    });

    it('should return empty array for empty input', () => {
      expect(splitMessage('')).toEqual(['']);
    });
  });
});
