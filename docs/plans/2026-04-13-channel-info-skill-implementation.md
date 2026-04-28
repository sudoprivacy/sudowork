# Channel Info Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a Skill that allows users to query channel configuration status through conversation (both remote IM and local desktop).

**Architecture:** Follow existing Skill pattern (like cron). Agent outputs special markers `[CHANNEL_INFO]`, system detects and processes them, returns formatted channel status to Agent. Data comes from IPC bridge `channel.getPluginStatus`.

**Tech Stack:** TypeScript, Electron IPC, Skill system (`_sudowork_meta.json`, `SKILL.md`, `icon.svg`)

---

## Task 1: Create Skill Metadata and Icon

**Files:**
- Create: `skills/_builtin/channel-info/_sudowork_meta.json`
- Create: `skills/_builtin/channel-info/icon.svg`
- Create: `skills/_builtin/channel-info/SKILL.md`

**Step 1: Create _sudowork_meta.json**

```json
{
  "id": "channel-info-skill-uuid",
  "name": "channel-info",
  "display_name": "渠道信息",
  "description": "获取 Channel 渠道配置信息 - 查询 Telegram、飞书、钉钉、微信等渠道的启用状态和运行状态",
  "icon": "icon.svg",
  "emoji": "📡",
  "category": "",
  "categories": ["系统管理"],
  "applicable_scenarios": "[\"查询渠道状态：了解当前已配置的 IM 渠道列表\",\"渠道诊断：检查渠道是否正常运行\",\"配置确认：确认渠道是否已启用\"]",
  "core_features": "[{\"title\": \"状态查询\", \"desc\": \"获取所有已配置渠道的启用和连接状态\"}, {\"title\": \"按渠道查询\", \"desc\": \"支持查询特定渠道的详细状态\"}, {\"title\": \"安全展示\", \"desc\": \"排除敏感凭据信息\"}]",
  "homepage": null,
  "author_id": "None",
  "is_builtin": true,
  "installed_version": "1.0.0",
  "installed_at": "2026-04-13T00:00:00.000Z"
}
```

**Step 2: Create icon.svg**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/>
  <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/>
  <circle cx="12" cy="12" r="2"/>
  <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/>
  <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>
</svg>
```

**Step 3: Create SKILL.md**

```markdown
---
name: channel-info
description: "获取 Channel 渠道配置信息 - 查询 Telegram、飞书、钉钉、微信等渠道的启用状态和运行状态"
---

# 渠道信息 Skill

查询 IM 渠道（Telegram、飞书、钉钉、微信等）的配置和运行状态。

## 使用方法

输出 `[CHANNEL_INFO]` 直接查询所有渠道状态。

输出 `[CHANNEL_INFO: wechat]` 查询特定渠道（支持 telegram、lark、dingtalk、wechat）。

**输出命令直接，不要包裹在代码块中。**

## 示例

查询所有渠道：
```
[CHANNEL_INFO]
```

查询 WeChat 渠道：
```
[CHANNEL_INFO: wechat]
```

## 返回信息

系统将返回以下信息（排除敏感凭据）：
- 渠道类型 (type)
- 渠道名称 (name)
- 启用状态 (enabled)
- 连接状态 (connected)
- 运行状态 (status)
- 最后连接时间 (lastConnected)
- 凭据配置状态 (hasToken) - 仅显示是否已配置，不显示具体凭据

## 注意事项

1. 敏感信息（token、secret 等）不会返回
2. 支持的渠道类型：telegram、lark、dingtalk、wechat、wecom、zentao
3. 渠道状态可能是 running、stopped、error 等
```

**Step 4: Verify files created**

Run: `ls -la skills/_builtin/channel-info/`
Expected: All three files exist

**Step 5: Commit**

```bash
git add skills/_builtin/channel-info/
git commit -m "feat(skills): add channel-info skill metadata and docs"
```

---

## Task 2: Create Channel Info Command Detector

**Files:**
- Create: `src/process/task/ChannelInfoDetector.ts`
- Modify: `src/process/task/AcpAgent.ts` (to import and use detector)

**Step 1: Write the detector module**

```typescript
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
```

**Step 2: Verify file created**

Run: `ls src/process/task/ChannelInfoDetector.ts`
Expected: File exists

**Step 3: Commit**

```bash
git add src/process/task/ChannelInfoDetector.ts
git commit -m "feat(channel): add ChannelInfoDetector for skill command detection"
```

---

## Task 3: Integrate Detector into AcpAgent

**Files:**
- Modify: `src/process/task/AcpAgent.ts`

**Step 1: Add import statement**

Find the imports section at the top of `src/process/task/AcpAgent.ts` and add:

```typescript
import { detectChannelInfoCommands, executeChannelInfoCommand, stripChannelInfoCommands } from './ChannelInfoDetector';
```

**Step 2: Add detection in message processing**

Find where `detectCronCommands` is called (around line where agent message is processed). Add channel info detection alongside:

```typescript
// Detect channel info commands
const channelInfoCommands = detectChannelInfoCommands(messageContent);
if (channelInfoCommands.length > 0) {
  for (const cmd of channelInfoCommands) {
    const result = await executeChannelInfoCommand(cmd);
    // Send result back to agent/conversation
    await this.sendMessage(result);
  }
  // Strip commands from display content
  messageContent = stripChannelInfoCommands(messageContent);
}
```

**Step 3: Verify integration works**

Run: `grep -n "detectChannelInfoCommands" src/process/task/AcpAgent.ts`
Expected: Shows the import and usage lines

**Step 4: Commit**

```bash
git add src/process/task/AcpAgent.ts
git commit -m "feat(channel): integrate ChannelInfoDetector into AcpAgent message processing"
```

---

## Task 4: Add i18n Translations

**Files:**
- Modify: `src/renderer/i18n/locales/en-US/tools.json`
- Modify: `src/renderer/i18n/locales/zh-CN/tools.json`

**Step 1: Add English translation**

In `en-US/tools.json`, add:

```json
{
  "channel-info": {
    "name": "Channel Info",
    "description": "Query channel configuration status - Telegram, Lark, DingTalk, WeChat"
  }
}
```

**Step 2: Add Chinese translation**

In `zh-CN/tools.json`, add:

```json
{
  "channel-info": {
    "name": "渠道信息",
    "description": "查询渠道配置状态 - Telegram、飞书、钉钉、微信"
  }
}
```

**Step 3: Commit**

```bash
git add src/renderer/i18n/locales/en-US/tools.json src/renderer/i18n/locales/zh-CN/tools.json
git commit -m "feat(i18n): add translations for channel-info skill"
```

---

## Task 5: Test the Implementation

**Files:**
- Create: `src/process/task/ChannelInfoDetector.test.ts`

**Step 1: Write unit tests**

```typescript
import { describe, it, expect } from 'vitest';
import { detectChannelInfoCommands, hasChannelInfoCommands, stripChannelInfoCommands } from './ChannelInfoDetector';

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

    it('should ignore commands in code blocks', () => {
      const content = 'Example:\n```[CHANNEL_INFO]```';
      const commands = detectChannelInfoCommands(content);
      expect(commands).toHaveLength(0);
    });

    it('should handle empty content', () => {
      expect(detectChannelInfoCommands('')).toHaveLength(0);
      expect(detectChannelInfoCommands(null as any)).toHaveLength(0);
    });
  });

  describe('hasChannelInfoCommands', () => {
    it('should return true for content with commands', () => {
      expect(hasChannelInfoCommands('[CHANNEL_INFO]')).toBe(true);
      expect(hasChannelInfoCommands('[CHANNEL_INFO: telegram]')).toBe(true);
    });

    it('should return false for content without commands', () => {
      expect(hasChannelInfoCommands('Hello world')).toBe(false);
      expect(hasChannelInfoCommands('')).toBe(false);
    });
  });

  describe('stripChannelInfoCommands', () => {
    it('should remove commands from content', () => {
      const content = 'Check channels [CHANNEL_INFO] and more text';
      const stripped = stripChannelInfoCommands(content);
      expect(stripped).toBe('Check channels  and more text');
    });

    it('should handle multiple commands', () => {
      const content = '[CHANNEL_INFO] text [CHANNEL_INFO: telegram]';
      const stripped = stripChannelInfoCommands(content);
      expect(stripped).toBe('text');
    });
  });
});
```

**Step 2: Run tests**

Run: `npm test src/process/task/ChannelInfoDetector.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/process/task/ChannelInfoDetector.test.ts
git commit -m "test(channel): add unit tests for ChannelInfoDetector"
```

---

## Task 6: Final Verification and Documentation Update

**Step 1: Build the project**

Run: `npm run build`
Expected: Build succeeds without errors

**Step 2: Manual test (if possible)**

Start the application and verify:
1. Skill appears in Settings → Skills list
2. Agent can respond to "[CHANNEL_INFO]" command

**Step 3: Update architecture doc**

In `src/channels/ARCHITECTURE.md`, add mention of channel-info skill in the IPC section.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(channel): complete channel-info skill implementation"
```

---

## Summary

This implementation:
1. Creates a new builtin Skill `channel-info` following project patterns
2. Uses the same detection mechanism as `cron` skill
3. Returns channel status via IPC bridge, filtering sensitive credentials
4. Supports both local desktop and remote IM users
5. Provides i18n support for English and Chinese