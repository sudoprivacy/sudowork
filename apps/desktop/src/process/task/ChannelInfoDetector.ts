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
 * 渠道管理语义关键词（必须与渠道词搭配使用才能触发查询）
 * 这些词明确表示用户在询问渠道的配置/状态等管理信息
 */
const CHANNEL_MANAGEMENT_KEYWORDS = ['配置', '状态', '连接', '启用', '开通', '设置', '渠道', '机器人', 'configured', 'status', 'enabled', 'connected'];

/**
 * 泛查询词（单独使用不应触发，必须与渠道管理关键词搭配）
 * 例如："有没有配置" 可以，但 "有没有推广机会" 不行
 */
const GENERIC_QUERY_WORDS = ['是否', '有没有', '怎么样', '信息', '情况'];

/**
 * 窗口大小：渠道管理关键词必须出现在渠道词前后此范围内
 */
const WINDOW_SIZE = 16;

/**
 * 检查关键词是否在目标位置的窗口范围内
 */
function isWithinWindow(keywordIndex: number, targetIndex: number, windowSize: number): boolean {
  return Math.abs(keywordIndex - targetIndex) <= windowSize;
}

/**
 * 检查句子中是否存在有效的渠道查询语义
 * 要求：渠道管理关键词必须出现在渠道词附近（前后 WINDOW_SIZE 字符内）
 */
function hasValidChannelQuerySemantics(lowerMsg: string, channelKeyword: string): boolean {
  const keywordLower = channelKeyword.toLowerCase();
  const keywordIndex = lowerMsg.indexOf(keywordLower);

  if (keywordIndex === -1) return false;

  // 渠道词的结束位置
  const keywordEndIndex = keywordIndex + keywordLower.length;

  // 方案1: 渠道管理关键词在渠道词附近（如 "微信配置", "飞书状态", "企业微信状态怎么样"）
  for (const mgmtKeyword of CHANNEL_MANAGEMENT_KEYWORDS) {
    const mgmtLower = mgmtKeyword.toLowerCase();
    let searchPos = 0;
    while ((searchPos = lowerMsg.indexOf(mgmtLower, searchPos)) !== -1) {
      // 检查管理关键词是否在渠道词前后窗口内
      if (isWithinWindow(searchPos, keywordIndex, WINDOW_SIZE) || isWithinWindow(searchPos, keywordEndIndex, WINDOW_SIZE)) {
        return true;
      }
      searchPos++;
    }
  }

  // 方案2: 泛查询词 + 渠道管理关键词的组合（如 "飞书有没有配置"）
  // 要求：泛查询词和管理关键词都在渠道词窗口内
  for (const genericWord of GENERIC_QUERY_WORDS) {
    const genericLower = genericWord.toLowerCase();
    const genericIndex = lowerMsg.indexOf(genericLower);
    if (genericIndex === -1) continue;

    // 泛查询词必须在渠道词窗口内
    if (!isWithinWindow(genericIndex, keywordIndex, WINDOW_SIZE) && !isWithinWindow(genericIndex, keywordEndIndex, WINDOW_SIZE)) {
      continue;
    }

    // 还需要在窗口内找到管理关键词
    for (const mgmtKeyword of CHANNEL_MANAGEMENT_KEYWORDS) {
      const mgmtLower = mgmtKeyword.toLowerCase();
      let searchPos = 0;
      while ((searchPos = lowerMsg.indexOf(mgmtLower, searchPos)) !== -1) {
        if (isWithinWindow(searchPos, keywordIndex, WINDOW_SIZE) || isWithinWindow(searchPos, keywordEndIndex, WINDOW_SIZE)) {
          return true;
        }
        searchPos++;
      }
    }
  }

  return false;
}

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

  // 检测特定渠道查询
  // 统计匹配到的不同渠道数量，超过1个则不拦截（避免误拦截多渠道比较）
  const matchedChannels: Array<{ keyword: string; channelType: string; start: number; end: number }> = [];

  for (const { keyword, channelType } of CHANNEL_KEYWORDS) {
    const keywordLower = keyword.toLowerCase();
    const keywordIndex = lowerMsg.indexOf(keywordLower);
    if (keywordIndex !== -1) {
      // 检查是否有有效的渠道查询语义
      if (hasValidChannelQuerySemantics(lowerMsg, keyword)) {
        const keywordEnd = keywordIndex + keywordLower.length;
        const coveredBySpecificKeyword = matchedChannels.some((c) => c.start <= keywordIndex && keywordEnd <= c.end);
        // 避免重复添加同一渠道类型，也避免 "企业微信" 再被内部的 "微信" 计为第二个渠道。
        if (!coveredBySpecificKeyword && !matchedChannels.some((c) => c.channelType === channelType)) {
          matchedChannels.push({ keyword, channelType, start: keywordIndex, end: keywordEnd });
        }
      }
    }
  }

  // 只有一个渠道匹配时返回查询结果
  if (matchedChannels.length === 1) {
    return { kind: 'query', channelType: matchedChannels[0].channelType };
  }

  // 多个不同渠道匹配时不拦截（用户可能在比较或讨论，不是查询）
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
