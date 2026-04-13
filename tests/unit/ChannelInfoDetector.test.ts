/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

// Mock the database module before importing the detector
vi.mock('@/process/database', () => ({
  getDatabase: vi.fn(),
}));

import { detectChannelInfoCommands, hasChannelInfoCommands, stripChannelInfoCommands } from '@/process/task/ChannelInfoDetector';

describe('ChannelInfoDetector', () => {
  describe('detectChannelInfoCommands', () => {
    it('should detect [CHANNEL_INFO] command', () => {
      const content = 'Let me check the channels.\n[CHANNEL_INFO]';
      const commands = detectChannelInfoCommands(content);
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({ kind: 'list' });
    });

    it('should detect [CHANNEL_INFO: wechat] command', () => {
      const content = 'Check WeChat status.\n[CHANNEL_INFO: wechat]';
      const commands = detectChannelInfoCommands(content);
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({ kind: 'query', channelType: 'wechat' });
    });

    it('should detect [CHANNEL_INFO: telegram] command', () => {
      const content = '[CHANNEL_INFO: telegram]';
      const commands = detectChannelInfoCommands(content);
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({ kind: 'query', channelType: 'telegram' });
    });

    it('should ignore commands in code blocks', () => {
      const content = 'Example:\n```[CHANNEL_INFO]```';
      const commands = detectChannelInfoCommands(content);
      expect(commands).toHaveLength(0);
    });

    it('should handle empty content', () => {
      expect(detectChannelInfoCommands('')).toHaveLength(0);
      expect(detectChannelInfoCommands(null as any)).toHaveLength(0);
      expect(detectChannelInfoCommands(undefined as any)).toHaveLength(0);
    });

    it('should ignore invalid channel types', () => {
      const content = '[CHANNEL_INFO: invalid_type]';
      const commands = detectChannelInfoCommands(content);
      expect(commands).toHaveLength(0);
    });

    it('should handle multiple commands in same content', () => {
      // Implementation prioritizes specific query over list
      const content = '[CHANNEL_INFO: telegram]\n[CHANNEL_INFO: wechat]';
      const commands = detectChannelInfoCommands(content);
      expect(commands.length).toBeGreaterThan(0);
    });

    it('should detect all valid channel types', () => {
      const validTypes = ['telegram', 'lark', 'dingtalk', 'wechat', 'wecom', 'zentao'];
      for (const type of validTypes) {
        const content = `[CHANNEL_INFO: ${type}]`;
        const commands = detectChannelInfoCommands(content);
        expect(commands).toHaveLength(1);
        expect(commands[0]).toEqual({ kind: 'query', channelType: type });
      }
    });

    it('should be case insensitive for command detection', () => {
      const content = '[channel_info: TELEGRAM]';
      const commands = detectChannelInfoCommands(content);
      expect(commands).toHaveLength(1);
      expect(commands[0]).toEqual({ kind: 'query', channelType: 'telegram' });
    });

    it('should not detect list command when specific query is present', () => {
      const content = '[CHANNEL_INFO]\n[CHANNEL_INFO: telegram]';
      const commands = detectChannelInfoCommands(content);
      // Only specific query is detected, not list
      expect(commands.some((c) => c.kind === 'query')).toBe(true);
      expect(commands.some((c) => c.kind === 'list')).toBe(false);
    });
  });

  describe('hasChannelInfoCommands', () => {
    it('should return true for content with commands', () => {
      expect(hasChannelInfoCommands('[CHANNEL_INFO]')).toBe(true);
      expect(hasChannelInfoCommands('[CHANNEL_INFO: telegram]')).toBe(true);
      expect(hasChannelInfoCommands('Some text [CHANNEL_INFO] more text')).toBe(true);
    });

    it('should return false for content without commands', () => {
      expect(hasChannelInfoCommands('Hello world')).toBe(false);
      expect(hasChannelInfoCommands('')).toBe(false);
      expect(hasChannelInfoCommands(null as any)).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(hasChannelInfoCommands('[channel_info]')).toBe(true);
      expect(hasChannelInfoCommands('[CHANNEL_INFO]')).toBe(true);
    });
  });

  describe('stripChannelInfoCommands', () => {
    it('should remove [CHANNEL_INFO] from content', () => {
      const content = 'Check channels [CHANNEL_INFO] and more text';
      const stripped = stripChannelInfoCommands(content);
      expect(stripped).toBe('Check channels  and more text');
    });

    it('should remove [CHANNEL_INFO: type] from content', () => {
      const content = 'Check [CHANNEL_INFO: telegram] now';
      const stripped = stripChannelInfoCommands(content);
      expect(stripped).toBe('Check  now');
    });

    it('should handle multiple commands', () => {
      const content = '[CHANNEL_INFO] text [CHANNEL_INFO: telegram]';
      const stripped = stripChannelInfoCommands(content);
      expect(stripped).toBe('text');
    });

    it('should handle empty content', () => {
      expect(stripChannelInfoCommands('')).toBe('');
      expect(stripChannelInfoCommands(null as any)).toBe(null);
    });

    it('should collapse excessive newlines', () => {
      const content = 'text\n\n\n\n[CHANNEL_INFO]\n\n\n\nmore text';
      const stripped = stripChannelInfoCommands(content);
      expect(stripped).not.toContain('\n\n\n');
    });

    it('should be case insensitive when stripping', () => {
      const content = '[channel_info] and [CHANNEL_INFO: TELEGRAM]';
      const stripped = stripChannelInfoCommands(content);
      expect(stripped).toBe('and');
    });
  });
});
