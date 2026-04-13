/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDatabase } from '@/process/database';
import type { IChannelPluginStatus } from '@/channels/types';
import { hasPluginCredentials } from '@/channels/types';

/**
 * 渠道关键词映射（按优先级排序，更具体的关键词在前）
 * 例如："企业微信"应该在"微信"之前匹配
 */
const CHANNEL_KEYWORDS: Array<{ keyword: string; channelType: string }> = [
  // 企业微信 (更具体，需要先匹配)
  { keyword: '企业微信', channelType: 'wecom' },
  { keyword: 'wecom', channelType: 'wecom' },
  // 微信
  { keyword: 'wechat', channelType: 'wechat' },
  { keyword: '微信', channelType: 'wechat' },
  // Telegram
  { keyword: 'telegram', channelType: 'telegram' },
  { keyword: 'tg', channelType: 'telegram' },
  // 飞书
  { keyword: '飞书', channelType: 'lark' },
  { keyword: 'lark', channelType: 'lark' },
  // 钉钉
  { keyword: '钉钉', channelType: 'dingtalk' },
  { keyword: 'dingtalk', channelType: 'dingtalk' },
  // 禅道
  { keyword: '禅道', channelType: 'zentao' },
  { keyword: 'zentao', channelType: 'zentao' },
];

/**
 * 问题关键词（表示用户想查询状态）
 */
const QUERY_INDICATORS = ['配置', '状态', '连接', '启用', '开通', '设置', '是否', '有没有', '怎么样', '信息', '情况', 'configured', 'status', 'enabled', 'connected'];

/**
 * 排除关键词（避免误拦截）
 */
const EXCLUSION_PATTERNS = ['不用', '不想', '关闭', '禁用', '删除', '取消', 'disable', 'remove', 'delete', '关闭微信', '关闭wechat'];

/**
 * 渠道查询命令类型
 */
export type ChannelQueryCommand =
  | { kind: 'list' } // 查询所有渠道
  | { kind: 'query'; channelType: string }; // 查询特定渠道

/**
 * 检测用户消息中的渠道查询意图
 *
 * @param userMessage - 用户输入的消息内容
 * @returns 查询命令，如果未检测到则返回 null
 */
export function detectChannelQueryIntent(userMessage: string): ChannelQueryCommand | null {
  if (!userMessage || typeof userMessage !== 'string') {
    return null;
  }

  const lowerMsg = userMessage.toLowerCase();

  // 排除场景：用户想关闭/删除/禁用渠道
  if (EXCLUSION_PATTERNS.some((p) => lowerMsg.includes(p.toLowerCase()))) {
    return null;
  }

  // 检测"所有渠道"查询
  const queryAllPatterns = ['所有渠道', '哪些渠道', '全部渠道', 'all channels', '渠道列表', '渠道信息'];
  if (queryAllPatterns.some((p) => lowerMsg.includes(p.toLowerCase()))) {
    return { kind: 'list' };
  }

  // 检测特定渠道查询（按优先级顺序）
  for (const { keyword, channelType } of CHANNEL_KEYWORDS) {
    if (lowerMsg.includes(keyword.toLowerCase())) {
      // 检查是否有问题关键词
      const hasQueryIntent = QUERY_INDICATORS.some((indicator) => lowerMsg.includes(indicator.toLowerCase()));
      if (hasQueryIntent) {
        return { kind: 'query', channelType };
      }
    }
  }

  return null;
}

/**
 * 格式化渠道状态显示
 * 移除敏感凭据信息
 */
export function formatChannelStatus(status: IChannelPluginStatus): string {
  const enabledIcon = status.enabled ? '✅' : '❌';
  const connectedIcon = status.connected ? '✅' : '❌';
  const hasTokenIcon = status.hasToken ? '✅' : '⚠️';
  const lastConnected = status.lastConnected ? new Date(status.lastConnected).toLocaleString('zh-CN') : '从未连接';

  return `
📡 **${status.name}** (${status.type})
- 启用状态: ${enabledIcon} ${status.enabled ? '已启用' : '未启用'}
- 连接状态: ${connectedIcon} ${status.connected ? '正常连接' : '未连接'}
- 运行状态: ${status.status}
- 凭据配置: ${hasTokenIcon} ${status.hasToken ? '已配置' : '未配置'}
- 最后连接: ${lastConnected}
`.trim();
}

/**
 * 执行渠道查询命令并返回格式化结果
 */
export async function executeChannelInfoCommand(command: ChannelQueryCommand): Promise<string> {
  try {
    const db = getDatabase();
    const result = db.getChannelPlugins();

    if (!result.success || !result.data) {
      return '❌ 获取渠道信息失败: ' + (result.error || '未知错误');
    }

    let channels = result.data;

    // 按渠道类型过滤
    if (command.kind === 'query') {
      channels = channels.filter((c) => c.type === command.channelType);
      if (channels.length === 0) {
        const validTypes = ['telegram', 'lark', 'dingtalk', 'wechat', 'wecom', 'zentao'];
        if (!validTypes.includes(command.channelType)) {
          return `❌ 不支持的渠道类型: ${command.channelType}\n支持的渠道: telegram, lark, dingtalk, wechat, wecom, zentao`;
        }
        return `❌ 未找到 ${command.channelType} 渠道配置`;
      }
    }

    // 构建状态对象
    const statuses: IChannelPluginStatus[] = channels.map((config) => ({
      id: config.id,
      type: config.type,
      name: config.name,
      enabled: config.enabled,
      connected: config.status === 'running',
      status: config.status || 'stopped',
      lastConnected: config.lastConnected,
      activeUsers: 0,
      hasToken: hasPluginCredentials(config.type, config.credentials),
      isExtension: false,
    }));

    // 格式化输出
    const lines = statuses.map(formatChannelStatus);

    if (command.kind === 'query') {
      return `📡 **渠道信息查询结果**\n\n${lines.join('\n\n')}`;
    } else {
      return `📡 **当前已配置的渠道列表** (${statuses.length} 个)\n\n${lines.join('\n\n')}`;
    }
  } catch (error) {
    return '❌ 获取渠道信息失败: ' + (error instanceof Error ? error.message : String(error));
  }
}
