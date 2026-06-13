/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { extractMarkdownFileUrls, extractMarkdownImageUrls, getDefaultExtension, getMediaUrl, getMediaExtract, toUnifiedIncomingMessage, toWeChatSendPayload, splitMessage, stripMarkdownToPlain } from '@/channels/plugins/wechat/WeChatAdapter';
import type { WeChatMessage, WeChatMessageItem } from '@/channels/plugins/wechat/types';
import { MessageItemType, MessageType } from '@/channels/plugins/wechat/types';

describe('WeChatAdapter', () => {
  describe('getMediaUrl', () => {
    it('extracts URL from image_item', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.IMAGE,
        image_item: {
          media: { full_url: 'https://cdn.example.com/image.jpg' },
        },
      };
      expect(getMediaUrl(item)).toBe('https://cdn.example.com/image.jpg');
    });

    it('extracts URL from voice_item', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.VOICE,
        voice_item: {
          media: { full_url: 'https://cdn.example.com/voice.amr' },
        },
      };
      expect(getMediaUrl(item)).toBe('https://cdn.example.com/voice.amr');
    });

    it('extracts URL from file_item', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.FILE,
        file_item: {
          media: { full_url: 'https://cdn.example.com/doc.pdf' },
          file_name: 'doc.pdf',
        },
      };
      expect(getMediaUrl(item)).toBe('https://cdn.example.com/doc.pdf');
    });

    it('extracts URL from video_item', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.VIDEO,
        video_item: {
          media: { full_url: 'https://cdn.example.com/video.mp4' },
        },
      };
      expect(getMediaUrl(item)).toBe('https://cdn.example.com/video.mp4');
    });

    it('returns undefined for text item', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.TEXT,
        text_item: { text: 'hello' },
      };
      expect(getMediaUrl(item)).toBeUndefined();
    });

    it('returns undefined when media has no full_url and no cdnBaseUrl', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.IMAGE,
        image_item: {
          media: { aes_key: 'some-key', encrypt_query_param: 'enc_param_123' },
        },
      };
      expect(getMediaUrl(item)).toBeUndefined();
    });

    it('constructs URL from encrypt_query_param when full_url is absent', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.IMAGE,
        image_item: {
          media: { encrypt_query_param: 'enc_param_123', aes_key: 'some-key' },
        },
      };
      const url = getMediaUrl(item, 'https://cdn.weixin.qq.com');
      expect(url).toBe('https://cdn.weixin.qq.com/download?encrypted_query_param=enc_param_123');
    });

    it('prefers full_url over encrypt_query_param', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.IMAGE,
        image_item: {
          media: {
            full_url: 'https://cdn.weixin.qq.com/image.jpg',
            encrypt_query_param: 'enc_param_123',
          },
        },
      };
      const url = getMediaUrl(item, 'https://cdn.weixin.qq.com');
      expect(url).toBe('https://cdn.weixin.qq.com/image.jpg');
    });

    it('returns undefined for empty item', () => {
      const item: WeChatMessageItem = { type: MessageItemType.NONE };
      expect(getMediaUrl(item)).toBeUndefined();
    });
  });

  describe('getMediaExtract', () => {
    it('returns URL and aes_key from media info', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.VOICE,
        voice_item: {
          media: {
            full_url: 'https://cdn.weixin.qq.com/voice.amr',
            aes_key: 'dGVzdGtleTEyMzQ1Njc4', // base64
          },
        },
      };
      const extract = getMediaExtract(item);
      expect(extract).not.toBeUndefined();
      expect(extract!.url).toBe('https://cdn.weixin.qq.com/voice.amr');
      expect(extract!.aesKeyBase64).toBe('dGVzdGtleTEyMzQ1Njc4');
      expect(extract!.aesKeyIsHex).toBe(false);
    });

    it('uses ImageItem.aeskey (hex) over media.aes_key', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.IMAGE,
        image_item: {
          aeskey: '0123456789abcdef0123456789abcdef', // 32-char hex
          media: {
            full_url: 'https://cdn.weixin.qq.com/image.jpg',
            aes_key: 'should-not-be-used',
          },
        },
      };
      const extract = getMediaExtract(item);
      expect(extract).not.toBeUndefined();
      expect(extract!.aesKeyBase64).toBe('0123456789abcdef0123456789abcdef');
      expect(extract!.aesKeyIsHex).toBe(true);
    });

    it('returns null aesKeyBase64 when no key is present', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.FILE,
        file_item: {
          media: { full_url: 'https://cdn.weixin.qq.com/doc.pdf' },
          file_name: 'doc.pdf',
        },
      };
      const extract = getMediaExtract(item);
      expect(extract).not.toBeUndefined();
      expect(extract!.url).toBe('https://cdn.weixin.qq.com/doc.pdf');
      expect(extract!.aesKeyBase64).toBeNull();
      expect(extract!.aesKeyIsHex).toBe(false);
    });

    it('uses encrypt_query_param with cdnBaseUrl when full_url is absent', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.VIDEO,
        video_item: {
          media: {
            encrypt_query_param: 'enc_video_param',
            aes_key: 'dmlkZW9rZXkxMjM0NTY3OA==',
          },
        },
      };
      const extract = getMediaExtract(item, 'https://cdn.weixin.qq.com');
      expect(extract).not.toBeUndefined();
      expect(extract!.url).toBe('https://cdn.weixin.qq.com/download?encrypted_query_param=enc_video_param');
      expect(extract!.aesKeyBase64).toBe('dmlkZW9rZXkxMjM0NTY3OA==');
    });

    it('returns undefined when no URL can be resolved', () => {
      const item: WeChatMessageItem = {
        type: MessageItemType.IMAGE,
        image_item: {
          media: { aes_key: 'some-key' },
        },
      };
      expect(getMediaExtract(item)).toBeUndefined();
    });
  });

  describe('getDefaultExtension', () => {
    it('returns .jpg for IMAGE', () => {
      expect(getDefaultExtension(MessageItemType.IMAGE)).toBe('.jpg');
    });

    it('returns .amr for VOICE', () => {
      expect(getDefaultExtension(MessageItemType.VOICE)).toBe('.amr');
    });

    it('returns empty string for FILE', () => {
      expect(getDefaultExtension(MessageItemType.FILE)).toBe('');
    });

    it('returns .mp4 for VIDEO', () => {
      expect(getDefaultExtension(MessageItemType.VIDEO)).toBe('.mp4');
    });

    it('returns empty string for unknown type', () => {
      expect(getDefaultExtension(99)).toBe('');
    });
  });

  describe('toUnifiedIncomingMessage', () => {
    it('converts text message', () => {
      const msg: WeChatMessage = {
        message_id: 123,
        from_user_id: 'user1@im.wechat',
        message_type: MessageType.USER,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: 'Hello world' } }],
        create_time_ms: 1000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('text');
      expect(result!.content.text).toBe('Hello world');
      expect(result!.content.attachments).toBeUndefined();
      expect(result!.platform).toBe('wechat');
      expect(result!.chatId).toBe('user:user1@im.wechat');
    });

    it('converts image message with CDN URL', () => {
      const msg: WeChatMessage = {
        message_id: 456,
        from_user_id: 'user2@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.IMAGE,
            image_item: {
              media: { full_url: 'https://cdn.weixin.qq.com/image.jpg' },
              hd_size: 100000,
            },
          },
        ],
        create_time_ms: 2000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('photo');
      expect(result!.content.attachments).toHaveLength(1);
      expect(result!.content.attachments![0].type).toBe('photo');
      expect(result!.content.attachments![0].fileId).toBe('https://cdn.weixin.qq.com/image.jpg');
      expect(result!.content.attachments![0].mimeType).toBe('image/jpeg');
      expect(result!.content.attachments![0].size).toBe(100000);
    });

    it('converts image message with _localPath (after download)', () => {
      const msg: WeChatMessage = {
        message_id: 789,
        from_user_id: 'user3@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.IMAGE,
            image_item: {
              media: { full_url: 'https://cdn.weixin.qq.com/image.jpg' },
            },
            _localPath: '/tmp/channel-media/wechat/image_123.jpg',
          },
        ],
        create_time_ms: 3000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.attachments![0].fileId).toBe('/tmp/channel-media/wechat/image_123.jpg');
    });

    it('converts file message with file_name', () => {
      const msg: WeChatMessage = {
        message_id: 101,
        from_user_id: 'user4@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.FILE,
            file_item: {
              media: { full_url: 'https://cdn.weixin.qq.com/doc.pdf' },
              file_name: 'report.pdf',
              file_size: 50000,
            },
          },
        ],
        create_time_ms: 4000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('document');
      expect(result!.content.attachments![0].type).toBe('document');
      expect(result!.content.attachments![0].fileName).toBe('report.pdf');
      expect(result!.content.attachments![0].size).toBe(50000);
    });

    it('converts voice message', () => {
      const msg: WeChatMessage = {
        message_id: 102,
        from_user_id: 'user5@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.VOICE,
            voice_item: {
              media: { full_url: 'https://cdn.weixin.qq.com/voice.amr' },
              voice_length: 5000,
            },
          },
        ],
        create_time_ms: 5000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('voice');
      expect(result!.content.attachments![0].type).toBe('voice');
      expect(result!.content.attachments![0].mimeType).toBe('audio/amr');
      expect(result!.content.attachments![0].duration).toBe(5000);
      // No voice_format declared → default to 'silk' (personal WeChat voice is
      // SILK regardless of the .amr filename) so TranscriptionService decodes it.
      expect(result!.content.attachments![0].codec).toBe('silk');
    });

    it('passes through voice_format as the attachment codec', () => {
      const msg: WeChatMessage = {
        message_id: 109,
        from_user_id: 'user9@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.VOICE,
            voice_item: {
              media: { full_url: 'https://cdn.weixin.qq.com/voice.amr' },
              voice_length: 3000,
              voice_format: 'amr',
            },
          },
        ],
        create_time_ms: 9000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result!.content.attachments![0].codec).toBe('amr');
    });

    it('does not set codec on non-voice attachments', () => {
      const msg: WeChatMessage = {
        message_id: 110,
        from_user_id: 'user10@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.IMAGE,
            image_item: { media: { full_url: 'https://cdn.weixin.qq.com/pic.jpg' } },
          },
        ],
        create_time_ms: 10000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result!.content.attachments![0].codec).toBeUndefined();
    });

    it('converts video message', () => {
      const msg: WeChatMessage = {
        message_id: 103,
        from_user_id: 'user6@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.VIDEO,
            video_item: {
              media: { full_url: 'https://cdn.weixin.qq.com/video.mp4' },
              video_length: 60000,
            },
          },
        ],
        create_time_ms: 6000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('video');
      expect(result!.content.attachments![0].type).toBe('video');
      expect(result!.content.attachments![0].mimeType).toBe('video/mp4');
      expect(result!.content.attachments![0].duration).toBe(60000);
    });

    it('handles mixed text and image items', () => {
      const msg: WeChatMessage = {
        message_id: 200,
        from_user_id: 'user7@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          { type: MessageItemType.TEXT, text_item: { text: 'Check this image' } },
          {
            type: MessageItemType.IMAGE,
            image_item: {
              media: { full_url: 'https://cdn.weixin.qq.com/photo.jpg' },
            },
          },
        ],
        create_time_ms: 7000,
      };
      const result = toUnifiedIncomingMessage(msg);
      expect(result).not.toBeNull();
      expect(result!.content.text).toBe('Check this image');
      expect(result!.content.type).toBe('photo');
      expect(result!.content.attachments).toHaveLength(1);
    });

    it('ignores bot messages', () => {
      const msg: WeChatMessage = {
        message_id: 300,
        from_user_id: 'bot@im.bot',
        message_type: MessageType.BOT,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: 'Bot response' } }],
      };
      expect(toUnifiedIncomingMessage(msg)).toBeNull();
    });

    it('ignores messages without from_user_id', () => {
      const msg: WeChatMessage = {
        message_id: 400,
        from_user_id: '',
        message_type: MessageType.USER,
        item_list: [{ type: MessageItemType.TEXT, text_item: { text: 'hello' } }],
      };
      expect(toUnifiedIncomingMessage(msg)).toBeNull();
    });

    it('returns null for empty message (no text, no media)', () => {
      const msg: WeChatMessage = {
        message_id: 500,
        from_user_id: 'user@im.wechat',
        message_type: MessageType.USER,
        item_list: [],
      };
      expect(toUnifiedIncomingMessage(msg)).toBeNull();
    });

    it('ignores media items without URL or local path', () => {
      const msg: WeChatMessage = {
        message_id: 600,
        from_user_id: 'user@im.wechat',
        message_type: MessageType.USER,
        item_list: [
          {
            type: MessageItemType.IMAGE,
            image_item: { media: {} },
          },
        ],
      };
      // No URL and no _localPath => no attachment => null message
      expect(toUnifiedIncomingMessage(msg)).toBeNull();
    });
  });

  describe('toWeChatSendPayload', () => {
    it('builds a valid send payload', () => {
      const payload = toWeChatSendPayload('user1@im.wechat', { type: 'text', text: 'Hello' }, 'ctx-token');
      expect(payload.msg?.to_user_id).toBe('user1@im.wechat');
      expect(payload.msg?.context_token).toBe('ctx-token');
      expect(payload.msg?.item_list?.[0]?.text_item?.text).toBe('Hello');
    });
  });

  describe('splitMessage', () => {
    it('returns single chunk for short messages', () => {
      expect(splitMessage('Hello', 100)).toEqual(['Hello']);
    });

    it('splits long messages', () => {
      const longText = 'A'.repeat(200);
      const chunks = splitMessage(longText, 100);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('')).toBe(longText);
    });
  });

  describe('stripMarkdownToPlain', () => {
    it('strips bold markers', () => {
      expect(stripMarkdownToPlain('**bold**')).toBe('bold');
    });

    it('strips inline code', () => {
      expect(stripMarkdownToPlain('`code`')).toBe('code');
    });

    it('strips headers', () => {
      expect(stripMarkdownToPlain('## Header')).toBe('Header');
    });
  });

  describe('extractMarkdownImageUrls', () => {
    it('extracts single image URL', () => {
      const text = 'Here is an image: ![alt text](https://example.com/image.png)';
      const urls = extractMarkdownImageUrls(text);
      expect(urls).toEqual(['https://example.com/image.png']);
    });

    it('extracts multiple image URLs', () => {
      const text = '![img1](https://example.com/a.jpg) some text ![img2](https://example.com/b.png)';
      const urls = extractMarkdownImageUrls(text);
      expect(urls).toEqual(['https://example.com/a.jpg', 'https://example.com/b.png']);
    });

    it('returns empty array when no images', () => {
      const text = 'No images here, just a [link](https://example.com)';
      const urls = extractMarkdownImageUrls(text);
      expect(urls).toEqual([]);
    });

    it('handles empty alt text', () => {
      const text = '![](https://example.com/image.png)';
      const urls = extractMarkdownImageUrls(text);
      expect(urls).toEqual(['https://example.com/image.png']);
    });

    it('handles local file paths', () => {
      const text = '![screenshot](/tmp/screenshots/image.png)';
      const urls = extractMarkdownImageUrls(text);
      expect(urls).toEqual(['/tmp/screenshots/image.png']);
    });

    it('handles relative file paths', () => {
      const text = '![screenshot](./images/screenshot.png)';
      const urls = extractMarkdownImageUrls(text);
      expect(urls).toEqual(['./images/screenshot.png']);
    });

    it('handles relative paths without dot prefix', () => {
      const text = '![chart](output/charts/chart.png)';
      const urls = extractMarkdownImageUrls(text);
      expect(urls).toEqual(['output/charts/chart.png']);
    });

    it('handles Windows absolute paths with backslashes', () => {
      const text = '![img](C:\\Users\\user\\Documents\\image.png)';
      const urls = extractMarkdownImageUrls(text);
      expect(urls).toEqual(['C:\\Users\\user\\Documents\\image.png']);
    });

    it('handles Windows paths with forward slashes', () => {
      const text = '![img](C:/Users/user/Documents/image.png)';
      const urls = extractMarkdownImageUrls(text);
      expect(urls).toEqual(['C:/Users/user/Documents/image.png']);
    });

    it('handles Windows paths with double backslashes', () => {
      const text = '![img](C:\\\\Users\\\\user\\\\image.png)';
      const urls = extractMarkdownImageUrls(text);
      expect(urls).toEqual(['C:\\\\Users\\\\user\\\\image.png']);
    });

    it('handles file:// protocol URLs', () => {
      const text = '![local](file:///home/user/image.png)';
      const urls = extractMarkdownImageUrls(text);
      expect(urls).toEqual(['file:///home/user/image.png']);
    });

    it('handles file:// protocol with Windows path', () => {
      const text = '![local](file:///C:/Users/user/image.png)';
      const urls = extractMarkdownImageUrls(text);
      expect(urls).toEqual(['file:///C:/Users/user/image.png']);
    });

    it('extracts images from complex markdown', () => {
      const text = `# Report
Here is the chart:
![Chart](https://cdn.example.com/chart.png)

And some **bold** text with a [link](https://example.com).

Another image:
![Photo](https://cdn.example.com/photo.jpg)`;
      const urls = extractMarkdownImageUrls(text);
      expect(urls).toEqual(['https://cdn.example.com/chart.png', 'https://cdn.example.com/photo.jpg']);
    });
  });

  describe('extractMarkdownFileUrls', () => {
    it('extracts file links with known extensions', () => {
      const text = 'Download the [report](https://example.com/report.pdf)';
      const files = extractMarkdownFileUrls(text);
      expect(files).toEqual([{ url: 'https://example.com/report.pdf', fileName: 'report' }]);
    });

    it('extracts multiple file links', () => {
      const text = '[spreadsheet](https://example.com/data.xlsx) and [archive](https://example.com/files.zip)';
      const files = extractMarkdownFileUrls(text);
      expect(files).toHaveLength(2);
      expect(files[0].url).toBe('https://example.com/data.xlsx');
      expect(files[1].url).toBe('https://example.com/files.zip');
    });

    it('ignores image links', () => {
      const text = '![image](https://example.com/image.jpg) and [doc](https://example.com/doc.pdf)';
      const files = extractMarkdownFileUrls(text);
      expect(files).toHaveLength(1);
      expect(files[0].url).toBe('https://example.com/doc.pdf');
    });

    it('ignores links without file extensions', () => {
      const text = '[website](https://example.com) and [page](https://example.com/about)';
      const files = extractMarkdownFileUrls(text);
      expect(files).toEqual([]);
    });

    it('handles URLs with query parameters', () => {
      const text = '[download](https://example.com/file.pdf?token=abc123)';
      const files = extractMarkdownFileUrls(text);
      expect(files).toHaveLength(1);
      expect(files[0].url).toBe('https://example.com/file.pdf?token=abc123');
    });

    it('returns empty array for text without links', () => {
      const text = 'Just some plain text without any links.';
      const files = extractMarkdownFileUrls(text);
      expect(files).toEqual([]);
    });

    it('handles local Unix file paths', () => {
      const text = '[report](/home/user/documents/report.pdf)';
      const files = extractMarkdownFileUrls(text);
      expect(files).toHaveLength(1);
      expect(files[0].url).toBe('/home/user/documents/report.pdf');
      expect(files[0].fileName).toBe('report');
    });

    it('handles relative file paths', () => {
      const text = '[data](./output/data.csv)';
      const files = extractMarkdownFileUrls(text);
      expect(files).toHaveLength(1);
      expect(files[0].url).toBe('./output/data.csv');
      expect(files[0].fileName).toBe('data');
    });

    it('handles Windows paths with backslashes and extracts filename', () => {
      const text = '[report](C:\\Users\\user\\Documents\\report.pdf)';
      const files = extractMarkdownFileUrls(text);
      expect(files).toHaveLength(1);
      expect(files[0].url).toBe('C:\\Users\\user\\Documents\\report.pdf');
      expect(files[0].fileName).toBe('report');
    });

    it('extracts filename from Windows path with backslashes when no link text', () => {
      const text = '[](C:\\Users\\user\\Documents\\report.pdf)';
      const files = extractMarkdownFileUrls(text);
      expect(files).toHaveLength(1);
      expect(files[0].fileName).toBe('report.pdf');
    });

    it('handles Windows paths with forward slashes', () => {
      const text = '[data](C:/Users/user/data.xlsx)';
      const files = extractMarkdownFileUrls(text);
      expect(files).toHaveLength(1);
      expect(files[0].url).toBe('C:/Users/user/data.xlsx');
    });

    it('handles file:// protocol URLs', () => {
      const text = '[report](file:///home/user/report.pdf)';
      const files = extractMarkdownFileUrls(text);
      expect(files).toHaveLength(1);
      expect(files[0].url).toBe('file:///home/user/report.pdf');
    });
  });
});
