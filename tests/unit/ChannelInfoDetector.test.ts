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

import { detectChannelQueryIntent } from '@/process/task/ChannelInfoDetector';

describe('ChannelInfoDetector', () => {
  describe('detectChannelQueryIntent', () => {
    describe('特定渠道查询', () => {
      it('should detect "wechat配置了吗"', () => {
        const result = detectChannelQueryIntent('wechat配置了吗');
        expect(result).toEqual({ kind: 'query', channelType: 'wechat' });
      });

      it('should detect "微信的渠道状态"', () => {
        const result = detectChannelQueryIntent('微信的渠道状态');
        expect(result).toEqual({ kind: 'query', channelType: 'wechat' });
      });

      it('should detect "telegram是否启用"', () => {
        const result = detectChannelQueryIntent('telegram是否启用');
        expect(result).toEqual({ kind: 'query', channelType: 'telegram' });
      });

      it('should detect "tg的连接情况"', () => {
        const result = detectChannelQueryIntent('tg的连接情况');
        expect(result).toEqual({ kind: 'query', channelType: 'telegram' });
      });

      it('should detect "飞书有没有配置"', () => {
        const result = detectChannelQueryIntent('飞书有没有配置');
        expect(result).toEqual({ kind: 'query', channelType: 'lark' });
      });

      it('should detect "lark status"', () => {
        const result = detectChannelQueryIntent('lark status');
        expect(result).toEqual({ kind: 'query', channelType: 'lark' });
      });

      it('should detect "钉钉的设置信息"', () => {
        const result = detectChannelQueryIntent('钉钉的设置信息');
        expect(result).toEqual({ kind: 'query', channelType: 'dingtalk' });
      });

      it('should detect "企业微信状态怎么样"', () => {
        const result = detectChannelQueryIntent('企业微信状态怎么样');
        expect(result).toEqual({ kind: 'query', channelType: 'wecom' });
      });

      it('should detect "禅道连接是否正常"', () => {
        const result = detectChannelQueryIntent('禅道连接是否正常');
        expect(result).toEqual({ kind: 'query', channelType: 'zentao' });
      });

      it('should be case insensitive', () => {
        const result = detectChannelQueryIntent('WECHAT配置');
        expect(result).toEqual({ kind: 'query', channelType: 'wechat' });
      });
    });

    describe('查询所有渠道', () => {
      it('should detect "有哪些渠道可用"', () => {
        const result = detectChannelQueryIntent('有哪些渠道可用');
        expect(result).toEqual({ kind: 'list' });
      });

      it('should detect "所有渠道"', () => {
        const result = detectChannelQueryIntent('所有渠道');
        expect(result).toEqual({ kind: 'list' });
      });

      it('should detect "全部渠道信息"', () => {
        const result = detectChannelQueryIntent('全部渠道信息');
        expect(result).toEqual({ kind: 'list' });
      });

      it('should detect "渠道列表"', () => {
        const result = detectChannelQueryIntent('渠道列表');
        expect(result).toEqual({ kind: 'list' });
      });

      it('should detect "all channels"', () => {
        const result = detectChannelQueryIntent('all channels');
        expect(result).toEqual({ kind: 'list' });
      });
    });

    describe('排除场景', () => {
      it('should return null for "我想关闭wechat"', () => {
        const result = detectChannelQueryIntent('我想关闭wechat');
        expect(result).toBeNull();
      });

      it('should return null for "不用微信"', () => {
        const result = detectChannelQueryIntent('不用微信');
        expect(result).toBeNull();
      });

      it('should return null for "禁用telegram"', () => {
        const result = detectChannelQueryIntent('禁用telegram');
        expect(result).toBeNull();
      });

      it('should return null for "删除钉钉配置"', () => {
        const result = detectChannelQueryIntent('删除钉钉配置');
        expect(result).toBeNull();
      });

      it('should return null for "关闭飞书"', () => {
        const result = detectChannelQueryIntent('关闭飞书');
        expect(result).toBeNull();
      });

      it('should return null for "disable wechat"', () => {
        const result = detectChannelQueryIntent('disable wechat');
        expect(result).toBeNull();
      });
    });

    describe('不匹配场景', () => {
      it('should return null for "[CHANNEL_INFO]" command format', () => {
        const result = detectChannelQueryIntent('[CHANNEL_INFO]');
        expect(result).toBeNull();
      });

      it('should return null for "[CHANNEL_INFO: wechat]" command format', () => {
        const result = detectChannelQueryIntent('[CHANNEL_INFO: wechat]');
        expect(result).toBeNull();
      });

      it('should return null for "wechat" without query indicators', () => {
        const result = detectChannelQueryIntent('wechat');
        expect(result).toBeNull();
      });

      it('should return null for "我喜欢用微信"', () => {
        const result = detectChannelQueryIntent('我喜欢用微信');
        expect(result).toBeNull();
      });

      it('should return null for "普通聊天内容"', () => {
        const result = detectChannelQueryIntent('普通聊天内容');
        expect(result).toBeNull();
      });

      it('should return null for empty content', () => {
        expect(detectChannelQueryIntent('')).toBeNull();
        expect(detectChannelQueryIntent(null as any)).toBeNull();
        expect(detectChannelQueryIntent(undefined as any)).toBeNull();
      });
    });
  });
});
