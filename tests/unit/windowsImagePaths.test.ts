/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { normalizeWindowsImagePaths, preprocessContentMessage } from '@process/task/acp/AcpMessagePipeline';

describe('normalizeWindowsImagePaths', () => {
  it('should normalize Windows backslash paths in markdown image syntax', () => {
    const input = '![alt](C:\\Users\\16674\\.nexus\\sudoclaw\\workspace\\shaobing.png)';
    const expected = '![alt](C:/Users/16674/.nexus/sudoclaw/workspace/shaobing.png)';
    expect(normalizeWindowsImagePaths(input)).toBe(expected);
  });

  it('should handle empty alt text', () => {
    const input = '![](C:\\Users\\16674\\Desktop\\image.png)';
    const expected = '![](C:/Users/16674/Desktop/image.png)';
    expect(normalizeWindowsImagePaths(input)).toBe(expected);
  });

  it('should handle Chinese alt text', () => {
    const input = '![热腾腾的芝麻烧饼](C:\\Users\\16674\\.nexus\\sudoclaw\\workspace\\sudoclaw-temp-1776762459099\\shaobing.png)';
    const expected = '![热腾腾的芝麻烧饼](C:/Users/16674/.nexus/sudoclaw/workspace/sudoclaw-temp-1776762459099/shaobing.png)';
    expect(normalizeWindowsImagePaths(input)).toBe(expected);
  });

  it('should handle multiple images in content', () => {
    const input = 'Here are two images:\n![img1](D:\\photos\\a.png)\n![img2](E:\\docs\\b.jpg)';
    const expected = 'Here are two images:\n![img1](D:/photos/a.png)\n![img2](E:/docs/b.jpg)';
    expect(normalizeWindowsImagePaths(input)).toBe(expected);
  });

  it('should not modify http/https URLs', () => {
    const input = '![alt](https://example.com/image.png)';
    expect(normalizeWindowsImagePaths(input)).toBe(input);
  });

  it('should not modify Unix absolute paths', () => {
    const input = '![alt](/home/user/image.png)';
    expect(normalizeWindowsImagePaths(input)).toBe(input);
  });

  it('should not modify relative paths', () => {
    const input = '![alt](./images/photo.png)';
    expect(normalizeWindowsImagePaths(input)).toBe(input);
  });

  it('should not modify data URLs', () => {
    const input = '![alt](data:image/png;base64,iVBOR...)';
    expect(normalizeWindowsImagePaths(input)).toBe(input);
  });

  it('should handle mixed content with Windows paths and regular text', () => {
    const input = '给你画好了：\n\n![](C:\\Users\\16674\\.nexus\\sudoclaw\\workspace\\sudoclaw-temp-1776762459099\\shaobing.png)\n\n这是一个烧饼。';
    const expected = '给你画好了：\n\n![](C:/Users/16674/.nexus/sudoclaw/workspace/sudoclaw-temp-1776762459099/shaobing.png)\n\n这是一个烧饼。';
    expect(normalizeWindowsImagePaths(input)).toBe(expected);
  });

  it('should handle paths with spaces', () => {
    const input = '![](C:\\Users\\My User\\Documents\\image.png)';
    const expected = '![](C:/Users/My User/Documents/image.png)';
    expect(normalizeWindowsImagePaths(input)).toBe(expected);
  });

  it('should return unchanged content when no images present', () => {
    const input = 'Hello, this is just plain text with no images.';
    expect(normalizeWindowsImagePaths(input)).toBe(input);
  });

  it('should handle lowercase drive letters', () => {
    const input = '![](c:\\users\\test\\image.png)';
    const expected = '![](c:/users/test/image.png)';
    expect(normalizeWindowsImagePaths(input)).toBe(expected);
  });
});

describe('preprocessContentMessage', () => {
  it('should normalize Windows paths in content messages', () => {
    const message = {
      type: 'content' as const,
      conversation_id: 'test-conv',
      msg_id: 'test-msg',
      data: '![](C:\\Users\\test\\image.png)',
    };
    const result = preprocessContentMessage(message);
    expect(result.data).toBe('![](C:/Users/test/image.png)');
  });

  it('should not modify non-content messages', () => {
    const message = {
      type: 'start' as const,
      conversation_id: 'test-conv',
      msg_id: 'test-msg',
      data: null,
    };
    const result = preprocessContentMessage(message);
    expect(result).toBe(message);
  });

  it('should handle both think tags and Windows paths', () => {
    const message = {
      type: 'content' as const,
      conversation_id: 'test-conv',
      msg_id: 'test-msg',
      data: '<think>thinking...</think>![](C:\\Users\\test\\image.png)',
    };
    const result = preprocessContentMessage(message);
    expect(result.data).toBe('![](C:/Users/test/image.png)');
  });

  it('should return same message if no changes needed', () => {
    const message = {
      type: 'content' as const,
      conversation_id: 'test-conv',
      msg_id: 'test-msg',
      data: 'Hello world, no paths here.',
    };
    const result = preprocessContentMessage(message);
    expect(result).toBe(message);
  });
});
