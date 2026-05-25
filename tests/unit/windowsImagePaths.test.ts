/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@process/message', () => ({
  addOrUpdateMessage: vi.fn(),
}));

import { normalizeWindowsImagePaths, preprocessContentMessage } from '@process/task/acp/AcpMessagePipeline';
import { defaultUrlTransform } from 'react-markdown';

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

  it('should not modify paths that already use forward slashes', () => {
    const input = '![](C:/Users/16674/.nexus/sudoclaw/workspace/shaobing.png)';
    expect(normalizeWindowsImagePaths(input)).toBe(input);
  });

  it('should strip Windows extended-length path prefix \\\\?\\', () => {
    const input = '![](\\\\?\\C:\\Users\\zouqi\\.nexus\\scode-temp-1778554568911\\cute_little_girl.png)';
    const expected = '![](C:/Users/zouqi/.nexus/scode-temp-1778554568911/cute_little_girl.png)';
    expect(normalizeWindowsImagePaths(input)).toBe(expected);
  });

  it('should strip \\\\?\\ prefix with alt text', () => {
    const input = '![一个可爱的小女孩，卡通风格](\\\\?\\C:\\Users\\zouqi\\.nexus\\scode-temp-1778554568911\\cute_little_girl.png)';
    const expected = '![一个可爱的小女孩，卡通风格](C:/Users/zouqi/.nexus/scode-temp-1778554568911/cute_little_girl.png)';
    expect(normalizeWindowsImagePaths(input)).toBe(expected);
  });

  it('should handle \\\\?\\ prefix in mixed content', () => {
    const input = 'I have successfully generated the image.\n\n![](\\\\?\\C:\\Users\\zouqi\\.nexus\\scode-temp-1778554568911\\cute_little_girl.png)\n\nHere it is!';
    const expected = 'I have successfully generated the image.\n\n![](C:/Users/zouqi/.nexus/scode-temp-1778554568911/cute_little_girl.png)\n\nHere it is!';
    expect(normalizeWindowsImagePaths(input)).toBe(expected);
  });

  it('should handle both \\\\?\\ prefixed and normal Windows paths in same content', () => {
    const input = '![img1](\\\\?\\C:\\Users\\test\\a.png)\n![img2](D:\\photos\\b.png)';
    const expected = '![img1](C:/Users/test/a.png)\n![img2](D:/photos/b.png)';
    expect(normalizeWindowsImagePaths(input)).toBe(expected);
  });
});

describe('defaultUrlTransform sanitization (root cause of empty src)', () => {
  it('should sanitize Windows drive letter paths as unknown protocol', () => {
    // This demonstrates the root cause: react-markdown treats "C:" as a protocol
    // and sanitizes it to empty string because "C" is not in the safe protocol list
    expect(defaultUrlTransform('C:/Users/16674/.nexus/sudoclaw/workspace/shaobing.png')).toBe('');
  });

  it('should allow http/https URLs', () => {
    expect(defaultUrlTransform('https://example.com/image.png')).toBe('https://example.com/image.png');
  });

  it('should allow relative paths', () => {
    expect(defaultUrlTransform('./images/photo.png')).toBe('./images/photo.png');
  });

  it('should allow Unix absolute paths', () => {
    expect(defaultUrlTransform('/home/user/image.png')).toBe('/home/user/image.png');
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

  it('should strip \\\\?\\ prefix and normalize Windows paths in content messages', () => {
    const message = {
      type: 'content' as const,
      conversation_id: 'test-conv',
      msg_id: 'test-msg',
      data: '![](\\\\?\\C:\\Users\\zouqi\\.nexus\\scode-temp-1778554568911\\cute_little_girl.png)',
    };
    const result = preprocessContentMessage(message);
    expect(result.data).toBe('![](C:/Users/zouqi/.nexus/scode-temp-1778554568911/cute_little_girl.png)');
  });

  it('should blank raw tool call text content', () => {
    const message = {
      type: 'content' as const,
      conversation_id: 'test-conv',
      msg_id: 'test-msg',
      data: 'call:default_api:read_file{limit:100,path:/tmp/weather-query/SKILL.md}',
    };
    const result = preprocessContentMessage(message);
    expect(result.data).toBe('');
  });

  it('should not blank normal text that mentions tool calls', () => {
    const message = {
      type: 'content' as const,
      conversation_id: 'test-conv',
      msg_id: 'test-msg',
      data: '工具调用已完成：call:default_api:read_file{limit:100,path:/tmp/weather-query/SKILL.md}',
    };
    const result = preprocessContentMessage(message);
    expect(result).toBe(message);
  });
});
