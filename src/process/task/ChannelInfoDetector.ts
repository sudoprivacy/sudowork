/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDatabase } from '@/process/database';

/**
 * Channel info command types detected from agent message content
 */
export type ChannelInfoCommand =
  | { kind: 'list' }  // List all channels
  | { kind: 'query'; channelType: string }; // Query specific channel

/**
 * Remove markdown code blocks from content to avoid detecting commands in examples
 */
function stripCodeBlocks(content: string): string {
  return content.replace(/```[\s\S]*?```/g, '');
}

/**
 * Detect channel info commands in message content
 *
 * Supported formats:
 * - [CHANNEL_INFO] - List all channel statuses
 * - [CHANNEL_INFO: telegram] - Query specific channel type
 *
 * @param content - The text content to scan
 * @returns Array of detected commands
 */
export function detectChannelInfoCommands(content: string): ChannelInfoCommand[] {
  if (!content || typeof content !== 'string') {
    return [];
  }

  const cleanContent = stripCodeBlocks(content);
  const commands: ChannelInfoCommand[] = [];

  // Detect [CHANNEL_INFO: xxx] - specific channel query
  const specificMatches = cleanContent.matchAll(/\[CHANNEL_INFO:\s*([^\]]+)\]/gi);
  for (const match of specificMatches) {
    const channelType = match[1].trim().toLowerCase();
    // Validate channel type
    const validTypes = ['telegram', 'lark', 'dingtalk', 'wechat', 'wecom', 'zentao'];
    if (channelType && validTypes.includes(channelType)) {
      commands.push({ kind: 'query', channelType });
    }
  }

  // Detect [CHANNEL_INFO] - list all (if no specific query found)
  if (commands.length === 0 && /\[CHANNEL_INFO\]/i.test(cleanContent)) {
    commands.push({ kind: 'list' });
  }

  return commands;
}

/**
 * Check if content contains any channel info commands
 */
export function hasChannelInfoCommands(content: string): boolean {
  if (!content || typeof content !== 'string') {
    return false;
  }
  return /\[CHANNEL_INFO/i.test(content);
}

/**
 * Strip channel info command blocks from content
 * Used to create clean display version for UI
 */
export function stripChannelInfoCommands(content: string): string {
  if (!content || typeof content !== 'string') {
    return content;
  }

  return content
    .replace(/\[CHANNEL_INFO:[^\]]+\]/gi, '')
    .replace(/\[CHANNEL_INFO\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Format channel status for display
 * Removes sensitive credential information
 */
export function formatChannelStatus(status: import('@/channels/types').IChannelPluginStatus): string {
  const enabledIcon = status.enabled ? '✅' : '❌';
  const connectedIcon = status.connected ? '✅' : '❌';
  const hasTokenIcon = status.hasToken ? '✅' : '⚠️';
  const lastConnected = status.lastConnected
    ? new Date(status.lastConnected).toISOString()
    : '从未连接';

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
 * Execute channel info command and return formatted result
 */
export async function executeChannelInfoCommand(command: ChannelInfoCommand): Promise<string> {
  try {
    const db = getDatabase();
    const result = db.getChannelPlugins();

    if (!result.success || !result.data) {
      return '❌ 获取渠道信息失败: ' + (result.error || '未知错误');
    }

    let channels = result.data;

    // Filter by channel type if specified
    if (command.kind === 'query') {
      channels = channels.filter(c => c.type === command.channelType);
      if (channels.length === 0) {
        return `❌ 未找到渠道类型: ${command.channelType}`;
      }
    }

    // Map to status objects (use existing hasPluginCredentials from types)
    const { hasPluginCredentials } = await import('@/channels/types');
    const statuses: import('@/channels/types').IChannelPluginStatus[] = channels.map(config => ({
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

    // Format output
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