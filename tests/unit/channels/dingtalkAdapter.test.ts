/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { getDefaultExtension, getDefaultMimeType, extractMediaDownloadInfo, setMediaLocalPath, toUnifiedIncomingMessage, getUploadMediaType, getDingTalkFileType } from '@/channels/plugins/dingtalk/DingTalkAdapter';
import type { DingTalkStreamMessage } from '@/channels/plugins/dingtalk/DingTalkAdapter';

// ==================== getDefaultExtension ====================

describe('DingTalkAdapter getDefaultExtension', () => {
  it('returns .jpg for picture', () => {
    expect(getDefaultExtension('picture')).toBe('.jpg');
  });

  it('returns .amr for audio', () => {
    expect(getDefaultExtension('audio')).toBe('.amr');
  });

  it('returns .mp4 for video', () => {
    expect(getDefaultExtension('video')).toBe('.mp4');
  });

  it('returns empty string for file (uses original fileName)', () => {
    expect(getDefaultExtension('file')).toBe('');
  });

  it('returns empty string for text', () => {
    expect(getDefaultExtension('text')).toBe('');
  });

  it('returns .jpg for richText (contains picture items)', () => {
    expect(getDefaultExtension('richText')).toBe('.jpg');
  });

  it('returns empty string for undefined', () => {
    expect(getDefaultExtension(undefined)).toBe('');
  });

  it('returns empty string for unknown type', () => {
    expect(getDefaultExtension('sticker')).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(getDefaultExtension('')).toBe('');
  });
});

// ==================== getDefaultMimeType ====================

describe('DingTalkAdapter getDefaultMimeType', () => {
  it('returns image/jpeg for picture', () => {
    expect(getDefaultMimeType('picture')).toBe('image/jpeg');
  });

  it('returns audio/amr for audio', () => {
    expect(getDefaultMimeType('audio')).toBe('audio/amr');
  });

  it('returns video/mp4 for video', () => {
    expect(getDefaultMimeType('video')).toBe('video/mp4');
  });

  it('returns application/octet-stream for file', () => {
    expect(getDefaultMimeType('file')).toBe('application/octet-stream');
  });

  it('returns application/octet-stream for text', () => {
    expect(getDefaultMimeType('text')).toBe('application/octet-stream');
  });

  it('returns application/octet-stream for undefined', () => {
    expect(getDefaultMimeType(undefined)).toBe('application/octet-stream');
  });

  it('returns application/octet-stream for unknown type', () => {
    expect(getDefaultMimeType('sticker')).toBe('application/octet-stream');
  });
});

// ==================== extractMediaDownloadInfo ====================

describe('DingTalkAdapter extractMediaDownloadInfo', () => {
  it('returns downloadCode for picture message', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'picture',
      picture: { downloadCode: 'pic_code_123' },
    };
    const result = extractMediaDownloadInfo(data);
    expect(result).not.toBeNull();
    expect(result!.downloadCode).toBe('pic_code_123');
    expect(result!.fileName).toBeUndefined();
  });

  it('returns downloadCode from content field for picture message (Stream API)', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'picture',
      content: { pictureDownloadCode: 'pic_dl_code_abc', downloadCode: 'generic_dl_code' },
    };
    const result = extractMediaDownloadInfo(data);
    expect(result).not.toBeNull();
    expect(result!.downloadCode).toBe('generic_dl_code');
  });

  it('falls back to content.downloadCode when pictureDownloadCode is absent', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'picture',
      content: { downloadCode: 'generic_dl_code' },
    };
    const result = extractMediaDownloadInfo(data);
    expect(result).not.toBeNull();
    expect(result!.downloadCode).toBe('generic_dl_code');
  });

  it('prefers picture field over content field', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'picture',
      picture: { downloadCode: 'pic_field_code' },
      content: { downloadCode: 'content_field_code' },
    };
    const result = extractMediaDownloadInfo(data);
    expect(result).not.toBeNull();
    expect(result!.downloadCode).toBe('pic_field_code');
  });

  it('returns downloadCode for audio message', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'audio',
      audio: { downloadCode: 'audio_code_456', duration: '3000' },
    };
    const result = extractMediaDownloadInfo(data);
    expect(result).not.toBeNull();
    expect(result!.downloadCode).toBe('audio_code_456');
    expect(result!.fileName).toBeUndefined();
  });

  it('returns downloadCode from content field for audio message (Stream API)', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'audio',
      content: { downloadCode: 'audio_content_code', duration: '5000', recognition: 'hello' },
    };
    const result = extractMediaDownloadInfo(data);
    expect(result).not.toBeNull();
    expect(result!.downloadCode).toBe('audio_content_code');
  });

  it('returns downloadCode for video message', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'video',
      video: { downloadCode: 'video_code_789' },
    };
    const result = extractMediaDownloadInfo(data);
    expect(result).not.toBeNull();
    expect(result!.downloadCode).toBe('video_code_789');
    expect(result!.fileName).toBeUndefined();
  });

  it('returns downloadCode from content field for video message (Stream API)', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'video',
      content: { downloadCode: 'video_content_code', duration: '10000' },
    };
    const result = extractMediaDownloadInfo(data);
    expect(result).not.toBeNull();
    expect(result!.downloadCode).toBe('video_content_code');
  });

  it('returns downloadCode and fileName for file message', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'file',
      file: { downloadCode: 'file_code_101', fileName: 'report.pdf', fileSize: '50000' },
    };
    const result = extractMediaDownloadInfo(data);
    expect(result).not.toBeNull();
    expect(result!.downloadCode).toBe('file_code_101');
    expect(result!.fileName).toBe('report.pdf');
  });

  it('returns downloadCode and fileName from content field for file message (Stream API)', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'file',
      content: { downloadCode: 'file_content_code', fileName: 'doc.xlsx', fileSize: '102400' },
    };
    const result = extractMediaDownloadInfo(data);
    expect(result).not.toBeNull();
    expect(result!.downloadCode).toBe('file_content_code');
    expect(result!.fileName).toBe('doc.xlsx');
  });

  it('returns null for text message', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'text',
      text: { content: 'hello' },
    };
    expect(extractMediaDownloadInfo(data)).toBeNull();
  });

  it('returns null for richText message', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'richText',
      richText: { richTextList: [{ text: 'hello', type: 'text' }] },
    };
    expect(extractMediaDownloadInfo(data)).toBeNull();
  });

  it('returns null when msgtype is undefined', () => {
    const data: DingTalkStreamMessage = {};
    expect(extractMediaDownloadInfo(data)).toBeNull();
  });

  it('returns null when msgtype is empty string', () => {
    const data: DingTalkStreamMessage = { msgtype: '' };
    expect(extractMediaDownloadInfo(data)).toBeNull();
  });

  it('returns null when msgtype is unknown', () => {
    const data: DingTalkStreamMessage = { msgtype: 'sticker' };
    expect(extractMediaDownloadInfo(data)).toBeNull();
  });

  it('returns null when downloadCode is empty string', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'picture',
      picture: { downloadCode: '' },
    };
    expect(extractMediaDownloadInfo(data)).toBeNull();
  });

  it('returns null when downloadCode is undefined', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'picture',
      picture: {},
    };
    expect(extractMediaDownloadInfo(data)).toBeNull();
  });

  it('returns null when media field is undefined', () => {
    const data: DingTalkStreamMessage = { msgtype: 'picture' };
    expect(extractMediaDownloadInfo(data)).toBeNull();
  });

  it('returns fileName as undefined for file message without fileName', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'file',
      file: { downloadCode: 'file_code_no_name' },
    };
    const result = extractMediaDownloadInfo(data);
    expect(result).not.toBeNull();
    expect(result!.downloadCode).toBe('file_code_no_name');
    expect(result!.fileName).toBeUndefined();
  });
});

// ==================== setMediaLocalPath ====================

describe('DingTalkAdapter setMediaLocalPath', () => {
  it('sets _localPath on picture field', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'picture',
      picture: { downloadCode: 'code1' },
    };
    setMediaLocalPath(data, '/tmp/photo.jpg');
    expect(data.picture!._localPath).toBe('/tmp/photo.jpg');
  });

  it('sets _localPath on audio field', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'audio',
      audio: { downloadCode: 'code2' },
    };
    setMediaLocalPath(data, '/tmp/voice.amr');
    expect(data.audio!._localPath).toBe('/tmp/voice.amr');
  });

  it('sets _localPath on video field', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'video',
      video: { downloadCode: 'code3' },
    };
    setMediaLocalPath(data, '/tmp/video.mp4');
    expect(data.video!._localPath).toBe('/tmp/video.mp4');
  });

  it('sets _localPath on file field', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'file',
      file: { downloadCode: 'code4', fileName: 'doc.pdf' },
    };
    setMediaLocalPath(data, '/tmp/doc.pdf');
    expect(data.file!._localPath).toBe('/tmp/doc.pdf');
  });

  it('does not throw when media field is undefined for picture', () => {
    const data: DingTalkStreamMessage = { msgtype: 'picture' };
    expect(() => setMediaLocalPath(data, '/tmp/photo.jpg')).not.toThrow();
  });

  it('does not throw when media field is undefined for audio', () => {
    const data: DingTalkStreamMessage = { msgtype: 'audio' };
    expect(() => setMediaLocalPath(data, '/tmp/voice.amr')).not.toThrow();
  });

  it('does not throw when media field is undefined for video', () => {
    const data: DingTalkStreamMessage = { msgtype: 'video' };
    expect(() => setMediaLocalPath(data, '/tmp/video.mp4')).not.toThrow();
  });

  it('does not throw when media field is undefined for file', () => {
    const data: DingTalkStreamMessage = { msgtype: 'file' };
    expect(() => setMediaLocalPath(data, '/tmp/doc.pdf')).not.toThrow();
  });

  it('does not throw when msgtype is undefined', () => {
    const data: DingTalkStreamMessage = {};
    expect(() => setMediaLocalPath(data, '/tmp/anything')).not.toThrow();
  });

  it('overwrites existing _localPath', () => {
    const data: DingTalkStreamMessage = {
      msgtype: 'picture',
      picture: { downloadCode: 'code', _localPath: '/old/path.jpg' },
    };
    setMediaLocalPath(data, '/new/path.jpg');
    expect(data.picture!._localPath).toBe('/new/path.jpg');
  });
});

// ==================== toUnifiedIncomingMessage - media _localPath priority ====================

describe('DingTalkAdapter extractMessageContent _localPath priority', () => {
  const baseMessage: DingTalkStreamMessage = {
    msgId: 'msg1',
    senderStaffId: 'staff1',
    senderNick: 'TestUser',
    conversationType: '1',
    createAt: 1000,
  };

  // --- picture ---

  describe('picture message', () => {
    it('uses _localPath when available', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'picture',
        picture: {
          downloadCode: 'code_abc',
          _localPath: '/tmp/channel-media/dingtalk/photo_123.jpg',
        },
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('photo');
      expect(result!.content.attachments![0].fileId).toBe('/tmp/channel-media/dingtalk/photo_123.jpg');
    });

    it('falls back to downloadCode when _localPath is absent', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'picture',
        picture: {
          downloadCode: 'code_abc',
        },
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.attachments![0].fileId).toBe('code_abc');
    });

    it('returns empty fileId when both _localPath and downloadCode are absent', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'picture',
        picture: {},
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.attachments![0].fileId).toBe('');
    });

    it('returns empty fileId when picture is undefined', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'picture',
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.attachments![0].fileId).toBe('');
    });
  });

  // --- audio ---

  describe('audio message', () => {
    it('uses _localPath when available', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'audio',
        audio: {
          downloadCode: 'audio_code',
          duration: '3000',
          recognition: 'hello world',
          _localPath: '/tmp/channel-media/dingtalk/voice_456.amr',
        },
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('audio');
      expect(result!.content.attachments![0].fileId).toBe('/tmp/channel-media/dingtalk/voice_456.amr');
      expect(result!.content.attachments![0].duration).toBe(3000);
      expect(result!.content.text).toBe('hello world');
    });

    it('falls back to downloadCode when _localPath is absent', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'audio',
        audio: {
          downloadCode: 'audio_code',
          duration: '5000',
        },
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.attachments![0].fileId).toBe('audio_code');
      expect(result!.content.attachments![0].duration).toBe(5000);
    });

    it('returns empty fileId and undefined duration when both are absent', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'audio',
        audio: {},
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.attachments![0].fileId).toBe('');
      expect(result!.content.attachments![0].duration).toBeUndefined();
    });
  });

  // --- video ---

  describe('video message', () => {
    it('uses _localPath when available', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'video',
        video: {
          downloadCode: 'video_code',
          duration: '10000',
          _localPath: '/tmp/channel-media/dingtalk/video_789.mp4',
        },
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('video');
      expect(result!.content.attachments![0].fileId).toBe('/tmp/channel-media/dingtalk/video_789.mp4');
      expect(result!.content.attachments![0].duration).toBe(10000);
    });

    it('falls back to downloadCode when _localPath is absent', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'video',
        video: {
          downloadCode: 'video_code',
        },
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.attachments![0].fileId).toBe('video_code');
    });

    it('returns empty fileId when both are absent', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'video',
        video: {},
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.attachments![0].fileId).toBe('');
    });
  });

  // --- file ---

  describe('file message', () => {
    it('uses _localPath when available', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'file',
        file: {
          downloadCode: 'file_code',
          fileName: 'report.pdf',
          fileSize: '50000',
          _localPath: '/tmp/channel-media/dingtalk/report.pdf',
        },
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('document');
      expect(result!.content.attachments![0].fileId).toBe('/tmp/channel-media/dingtalk/report.pdf');
      expect(result!.content.attachments![0].fileName).toBe('report.pdf');
      expect(result!.content.attachments![0].size).toBe(50000);
    });

    it('falls back to downloadCode when _localPath is absent', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'file',
        file: {
          downloadCode: 'file_code',
          fileName: 'doc.docx',
        },
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.attachments![0].fileId).toBe('file_code');
      expect(result!.content.attachments![0].fileName).toBe('doc.docx');
    });

    it('returns empty fileId and preserves fileName when both are absent', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'file',
        file: {
          fileName: 'note.txt',
        },
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.attachments![0].fileId).toBe('');
      expect(result!.content.attachments![0].fileName).toBe('note.txt');
    });

    it('returns empty fileId and undefined fileName when file is empty object', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'file',
        file: {},
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.attachments![0].fileId).toBe('');
      expect(result!.content.attachments![0].fileName).toBeUndefined();
    });
  });
});

// ==================== richText message handling ====================

describe('DingTalkAdapter richText message handling', () => {
  const baseMessage: DingTalkStreamMessage = {
    msgId: 'msg1',
    senderStaffId: 'staff1',
    senderNick: 'TestUser',
    conversationType: '1',
    createAt: 1000,
  };

  // --- extractMediaDownloadInfo for richText ---

  describe('extractMediaDownloadInfo for richText', () => {
    it('returns downloadCode for richText with picture item (content.richText path)', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'richText',
        content: {
          richText: [
            { text: 'hello' },
            { downloadCode: 'pic_dl_123', pictureDownloadCode: 'pic_pc_123', type: 'picture' },
          ],
        },
      };
      const result = extractMediaDownloadInfo(data);
      expect(result).not.toBeNull();
      expect(result!.downloadCode).toBe('pic_dl_123');
    });

    it('returns downloadCode for richText with picture item (richText.richTextList fallback)', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'richText',
        richText: {
          richTextList: [
            { text: 'hello' },
            { downloadCode: 'pic_dl_456', pictureDownloadCode: 'pic_pc_456', type: 'picture' },
          ],
        },
      };
      const result = extractMediaDownloadInfo(data);
      expect(result).not.toBeNull();
      expect(result!.downloadCode).toBe('pic_dl_456');
    });

    it('returns null for richText with text-only items', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'richText',
        content: {
          richText: [{ text: 'hello' }, { text: 'world' }],
        },
      };
      expect(extractMediaDownloadInfo(data)).toBeNull();
    });

    it('returns null for richText with empty content', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'richText',
        content: {},
      };
      expect(extractMediaDownloadInfo(data)).toBeNull();
    });
  });

  // --- setMediaLocalPath for richText ---

  describe('setMediaLocalPath for richText', () => {
    it('sets _localPath on content field for richText', () => {
      const data: DingTalkStreamMessage = {
        msgtype: 'richText',
        content: { richText: [{ text: 'hello' }] },
      };
      setMediaLocalPath(data, '/tmp/rich_photo.jpg');
      expect(data.content!._localPath).toBe('/tmp/rich_photo.jpg');
    });

    it('does not throw when content is undefined for richText', () => {
      const data: DingTalkStreamMessage = { msgtype: 'richText' };
      expect(() => setMediaLocalPath(data, '/tmp/anything.jpg')).not.toThrow();
    });
  });

  // --- toUnifiedIncomingMessage for richText ---

  describe('toUnifiedIncomingMessage for richText', () => {
    it('returns photo type for richText with text+picture (content.richText path)', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'richText',
        content: {
          richText: [
            { text: 'hello' },
            { downloadCode: 'pic_dl_789', pictureDownloadCode: 'pic_pc_789', type: 'picture' },
          ],
        },
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('photo');
      expect(result!.content.text).toBe('hello');
      expect(result!.content.attachments).toBeDefined();
      expect(result!.content.attachments!.length).toBe(1);
      expect(result!.content.attachments![0].type).toBe('photo');
      expect(result!.content.attachments![0].fileId).toBe('pic_dl_789');
    });

    it('returns photo type for richText with text+picture (richText.richTextList fallback)', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'richText',
        richText: {
          richTextList: [
            { text: 'hello' },
            { downloadCode: 'pic_dl_abc', pictureDownloadCode: 'pic_pc_abc', type: 'picture' },
          ],
        },
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('photo');
      expect(result!.content.text).toBe('hello');
      expect(result!.content.attachments![0].fileId).toBe('pic_dl_abc');
    });

    it('uses _localPath when available for richText picture', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'richText',
        content: {
          _localPath: '/tmp/channel-media/dingtalk/rich_photo.jpg',
          richText: [
            { text: 'hello' },
            { downloadCode: 'pic_dl_xyz', type: 'picture' },
          ],
        },
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('photo');
      expect(result!.content.attachments![0].fileId).toBe('/tmp/channel-media/dingtalk/rich_photo.jpg');
    });

    it('returns text type for richText with text only', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'richText',
        content: {
          richText: [{ text: 'hello' }, { text: ' world' }],
        },
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('text');
      expect(result!.content.text).toBe('hello world');
    });

    it('returns photo type for richText with picture only (no text)', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'richText',
        content: {
          richText: [
            { downloadCode: 'pic_only_code', pictureDownloadCode: 'pic_only_pc', type: 'picture' },
          ],
        },
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('photo');
      expect(result!.content.text).toBe('');
      expect(result!.content.attachments![0].fileId).toBe('pic_only_code');
    });

    it('returns text type with empty text for richText with empty array', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'richText',
        content: { richText: [] },
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('text');
      expect(result!.content.text).toBe('');
    });

    it('returns text type for richText with no content field', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'richText',
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('text');
      expect(result!.content.text).toBe('');
    });

    it('joins multiple text items for richText', () => {
      const data: DingTalkStreamMessage = {
        ...baseMessage,
        msgtype: 'richText',
        content: {
          richText: [{ text: 'line1' }, { text: 'line2' }, { text: 'line3' }],
        },
      };
      const result = toUnifiedIncomingMessage(data);
      expect(result).not.toBeNull();
      expect(result!.content.type).toBe('text');
      expect(result!.content.text).toBe('line1line2line3');
    });
  });
});

// ==================== getUploadMediaType ====================

describe('getUploadMediaType', () => {
  // DingTalk upload API explicitly supports these as image type
  it('returns image for jpg', () => {
    expect(getUploadMediaType('photo.jpg')).toBe('image');
  });

  it('returns image for jpeg', () => {
    expect(getUploadMediaType('photo.jpeg')).toBe('image');
  });

  it('returns image for png', () => {
    expect(getUploadMediaType('icon.png')).toBe('image');
  });

  it('returns image for gif', () => {
    expect(getUploadMediaType('anim.gif')).toBe('image');
  });

  it('returns image for bmp', () => {
    expect(getUploadMediaType('bitmap.bmp')).toBe('image');
  });

  // NOT supported by DingTalk upload API as image type
  it('returns file for webp (not in DingTalk image list)', () => {
    expect(getUploadMediaType('photo.webp')).toBe('file');
  });

  it('returns file for svg (not in DingTalk image list)', () => {
    expect(getUploadMediaType('icon.svg')).toBe('file');
  });

  it('returns file for tiff (not in DingTalk image list)', () => {
    expect(getUploadMediaType('scan.tiff')).toBe('file');
  });

  it('returns file for avif (not in DingTalk image list)', () => {
    expect(getUploadMediaType('photo.avif')).toBe('file');
  });

  it('returns file for ico (not in DingTalk image list)', () => {
    expect(getUploadMediaType('favicon.ico')).toBe('file');
  });

  // Document types
  it('returns file for pdf', () => {
    expect(getUploadMediaType('doc.pdf')).toBe('file');
  });

  it('returns file for docx', () => {
    expect(getUploadMediaType('report.docx')).toBe('file');
  });

  it('returns file for xlsx', () => {
    expect(getUploadMediaType('data.xlsx')).toBe('file');
  });

  it('returns file for pptx', () => {
    expect(getUploadMediaType('slides.pptx')).toBe('file');
  });

  it('returns file for zip', () => {
    expect(getUploadMediaType('archive.zip')).toBe('file');
  });

  it('returns file for rar', () => {
    expect(getUploadMediaType('archive.rar')).toBe('file');
  });

  // Other types
  it('returns file for csv', () => {
    expect(getUploadMediaType('data.csv')).toBe('file');
  });

  it('returns file for txt', () => {
    expect(getUploadMediaType('note.txt')).toBe('file');
  });

  it('returns file for md', () => {
    expect(getUploadMediaType('readme.md')).toBe('file');
  });

  it('returns file for json', () => {
    expect(getUploadMediaType('config.json')).toBe('file');
  });

  // Edge cases
  it('returns file for empty string', () => {
    expect(getUploadMediaType('')).toBe('file');
  });

  it('returns file for filename without extension', () => {
    expect(getUploadMediaType('Makefile')).toBe('file');
  });

  it('returns file for hidden file with dot prefix', () => {
    expect(getUploadMediaType('.gitignore')).toBe('file');
  });

  it('takes last extension from multi-dot filename', () => {
    expect(getUploadMediaType('archive.tar.gz')).toBe('file');
  });

  // Case insensitivity
  it('returns image for uppercase PNG', () => {
    expect(getUploadMediaType('photo.PNG')).toBe('image');
  });

  it('returns image for mixed case JpEg', () => {
    expect(getUploadMediaType('photo.JpEg')).toBe('image');
  });

  it('returns file for uppercase PDF', () => {
    expect(getUploadMediaType('doc.PDF')).toBe('file');
  });

  it('returns file for mixed case DocX', () => {
    expect(getUploadMediaType('doc.DocX')).toBe('file');
  });

  it('returns image for uppercase GIF', () => {
    expect(getUploadMediaType('anim.GIF')).toBe('image');
  });

  it('returns image for uppercase BMP', () => {
    expect(getUploadMediaType('bitmap.BMP')).toBe('image');
  });
});

// ==================== getDingTalkFileType ====================

describe('getDingTalkFileType', () => {
  // Exact mappings
  it('maps pdf → pdf', () => {
    expect(getDingTalkFileType('doc.pdf')).toBe('pdf');
  });

  it('maps doc → doc', () => {
    expect(getDingTalkFileType('letter.doc')).toBe('doc');
  });

  it('maps docx → doc', () => {
    expect(getDingTalkFileType('report.docx')).toBe('doc');
  });

  it('maps xls → xlsx', () => {
    expect(getDingTalkFileType('data.xls')).toBe('xlsx');
  });

  it('maps xlsx → xlsx', () => {
    expect(getDingTalkFileType('data.xlsx')).toBe('xlsx');
  });

  it('maps ppt → ppt', () => {
    expect(getDingTalkFileType('slides.ppt')).toBe('ppt');
  });

  it('maps pptx → ppt', () => {
    expect(getDingTalkFileType('slides.pptx')).toBe('ppt');
  });

  it('maps zip → zip', () => {
    expect(getDingTalkFileType('archive.zip')).toBe('zip');
  });

  it('maps rar → rar', () => {
    expect(getDingTalkFileType('archive.rar')).toBe('rar');
  });

  // Unknown extensions → default 'pdf'
  it('maps csv → pdf (unknown, defaults to pdf)', () => {
    expect(getDingTalkFileType('data.csv')).toBe('pdf');
  });

  it('maps txt → pdf (unknown, defaults to pdf)', () => {
    expect(getDingTalkFileType('note.txt')).toBe('pdf');
  });

  it('maps md → pdf (unknown, defaults to pdf)', () => {
    expect(getDingTalkFileType('readme.md')).toBe('pdf');
  });

  it('maps json → pdf (unknown, defaults to pdf)', () => {
    expect(getDingTalkFileType('config.json')).toBe('pdf');
  });

  it('maps odt → pdf (unknown, defaults to pdf)', () => {
    expect(getDingTalkFileType('doc.odt')).toBe('pdf');
  });

  it('maps png → pdf (image extension, defaults to pdf)', () => {
    expect(getDingTalkFileType('photo.png')).toBe('pdf');
  });

  // Edge cases
  it('returns pdf for empty string', () => {
    expect(getDingTalkFileType('')).toBe('pdf');
  });

  it('returns pdf for filename without extension', () => {
    expect(getDingTalkFileType('Makefile')).toBe('pdf');
  });

  it('returns pdf for hidden file', () => {
    expect(getDingTalkFileType('.gitignore')).toBe('pdf');
  });

  it('takes last extension from multi-dot filename', () => {
    expect(getDingTalkFileType('report.final.pdf')).toBe('pdf');
  });

  it('takes last extension for multi-dot docx', () => {
    expect(getDingTalkFileType('draft.v2.docx')).toBe('doc');
  });

  // Case insensitivity
  it('maps PDF → pdf', () => {
    expect(getDingTalkFileType('doc.PDF')).toBe('pdf');
  });

  it('maps DOCX → doc', () => {
    expect(getDingTalkFileType('doc.DOCX')).toBe('doc');
  });

  it('maps XLSX → xlsx', () => {
    expect(getDingTalkFileType('data.XLSX')).toBe('xlsx');
  });

  it('maps PPTX → ppt', () => {
    expect(getDingTalkFileType('slides.PPTX')).toBe('ppt');
  });
});
