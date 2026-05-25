import { describe, expect, it } from 'vitest';
import { getContentTypeFromExt } from '@/renderer/messages/MessageFileSend';

// --- getContentTypeFromExt 纯函数测试 ---

describe('getContentTypeFromExt', () => {
  // 文档类型
  it('maps pdf → pdf', () => {
    expect(getContentTypeFromExt('pdf')).toBe('pdf');
  });

  it('maps docx → word, doc → word, odt → word', () => {
    expect(getContentTypeFromExt('docx')).toBe('word');
    expect(getContentTypeFromExt('doc')).toBe('word');
    expect(getContentTypeFromExt('odt')).toBe('word');
  });

  it('maps xlsx → excel, xls → excel, ods → excel', () => {
    expect(getContentTypeFromExt('xlsx')).toBe('excel');
    expect(getContentTypeFromExt('xls')).toBe('excel');
    expect(getContentTypeFromExt('ods')).toBe('excel');
  });

  it('maps pptx → ppt, ppt → ppt, odp → ppt', () => {
    expect(getContentTypeFromExt('pptx')).toBe('ppt');
    expect(getContentTypeFromExt('ppt')).toBe('ppt');
    expect(getContentTypeFromExt('odp')).toBe('ppt');
  });

  // Markdown
  it('maps md → markdown, markdown → markdown', () => {
    expect(getContentTypeFromExt('md')).toBe('markdown');
    expect(getContentTypeFromExt('markdown')).toBe('markdown');
  });

  // 图片类型
  it('maps common image extensions to image', () => {
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff', 'avif'];
    for (const ext of imageExts) {
      expect(getContentTypeFromExt(ext)).toBe('image');
    }
  });

  it('maps common video extensions to video', () => {
    const videoExts = ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'avi', 'mkv', 'wmv', 'flv'];
    for (const ext of videoExts) {
      expect(getContentTypeFromExt(ext)).toBe('video');
    }
  });

  it('maps common audio extensions to audio', () => {
    const audioExts = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga', 'opus', 'amr', 'wma'];
    for (const ext of audioExts) {
      expect(getContentTypeFromExt(ext)).toBe('audio');
    }
  });

  // 代码类型
  it('maps code extensions to code', () => {
    const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'json', 'yaml', 'txt', 'sh'];
    for (const ext of codeExts) {
      expect(getContentTypeFromExt(ext)).toBe('code');
    }
  });

  // 特殊类型
  it('maps csv → code (not excel)', () => {
    expect(getContentTypeFromExt('csv')).toBe('code');
  });

  it('maps html → html, htm → html', () => {
    expect(getContentTypeFromExt('html')).toBe('html');
    expect(getContentTypeFromExt('htm')).toBe('html');
  });

  it('maps diff → diff, patch → diff', () => {
    expect(getContentTypeFromExt('diff')).toBe('diff');
    expect(getContentTypeFromExt('patch')).toBe('diff');
  });

  // 边界情况
  it('returns code for unknown extensions', () => {
    expect(getContentTypeFromExt('xyz')).toBe('code');
    expect(getContentTypeFromExt('rar')).toBe('code');
    expect(getContentTypeFromExt('zip')).toBe('code');
  });

  it('returns code for empty string', () => {
    expect(getContentTypeFromExt('')).toBe('code');
  });

  it('is case-insensitive', () => {
    expect(getContentTypeFromExt('PNG')).toBe('image');
    expect(getContentTypeFromExt('Pdf')).toBe('pdf');
    expect(getContentTypeFromExt('DOCX')).toBe('word');
    expect(getContentTypeFromExt('MD')).toBe('markdown');
    expect(getContentTypeFromExt('MP4')).toBe('video');
    expect(getContentTypeFromExt('MP3')).toBe('audio');
    expect(getContentTypeFromExt('TS')).toBe('code');
  });
});
