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

    describe('误拦截修复场景', () => {
      // 原始长句：包含多个渠道词和泛查询词，但实际是商业讨论
      it('should return null for long sentence about business opportunity discussion', () => {
        const longSentence =
          '所以我觉得包括还有大厂在内的，类似于推出 workbuddy 这样的抢占终端用户，还有类似飞书和钉钉都可以 ai 办公了，我们的 sudowork 你觉得还有没有推广的机会，我觉得海外大模型api 中转站是个更好的机会，再加上我们的 ai 管理平台（sudorouter），你从批判的角度来看，那个更有机会，语言上不要有任何保留，尖锐一点';
        const result = detectChannelQueryIntent(longSentence);
        expect(result).toBeNull();
      });

      // 飞书和钉钉竞品比较讨论 - 不应拦截
      it('should return null for "飞书和钉钉都可以ai办公了"', () => {
        const result = detectChannelQueryIntent('飞书和钉钉都可以ai办公了');
        expect(result).toBeNull();
      });

      // 单渠道商业讨论 - 不应拦截
      it('should return null for "飞书这样的办公产品有没有推广机会"', () => {
        const result = detectChannelQueryIntent('飞书这样的办公产品有没有推广机会');
        expect(result).toBeNull();
      });

      // 管理词不在渠道词窗口内 - 不应拦截
      it('should return null for "飞书这样的产品有没有推广机会，另外我们配置 sudorouter"', () => {
        const result = detectChannelQueryIntent('飞书这样的产品有没有推广机会，另外我们配置 sudorouter');
        expect(result).toBeNull();
      });

      // 只有泛查询词但没有渠道管理语义 - 不应拦截
      it('should return null for "飞书有没有"', () => {
        const result = detectChannelQueryIntent('飞书有没有');
        expect(result).toBeNull();
      });

      // 渠道词 + 泛查询词 + 渠道管理关键词 - 应该拦截
      it('should detect "飞书有没有配置"', () => {
        const result = detectChannelQueryIntent('飞书有没有配置');
        expect(result).toEqual({ kind: 'query', channelType: 'lark' });
      });

      it('should detect "钉钉有没有开通"', () => {
        const result = detectChannelQueryIntent('钉钉有没有开通');
        expect(result).toEqual({ kind: 'query', channelType: 'dingtalk' });
      });

      it('should detect "微信连接是否正常"', () => {
        const result = detectChannelQueryIntent('微信连接是否正常');
        expect(result).toEqual({ kind: 'query', channelType: 'wechat' });
      });

      // 多渠道比较 + 泛查询词 + 渠道管理关键词 - 不应拦截（多渠道比较）
      it('should return null for "飞书和钉钉的配置情况"', () => {
        const result = detectChannelQueryIntent('飞书和钉钉的配置情况');
        expect(result).toBeNull();
      });

      // 明确的列表查询 - 应该返回 list
      it('should detect "飞书和钉钉所有渠道信息"', () => {
        const result = detectChannelQueryIntent('飞书和钉钉所有渠道信息');
        expect(result).toEqual({ kind: 'list' });
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
