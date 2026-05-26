/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

export type ContextRecoveryStatus = 'normal' | 'near_limit' | 'critical' | 'overflowed' | 'compressing' | 'compressed' | 'failed';

export type ContextRecoveryReason = 'near_limit' | 'critical' | 'overflowed' | 'compressing' | 'compressed' | 'failed';

export type ContextRecoveryStrategy = 'compress' | 'fresh';

export type ContextRecoveryActionId = 'compress' | 'fresh' | 'dismiss';

export interface ContextRecoveryState {
  status: ContextRecoveryStatus;
  failedSessionId?: string;
  recoveredSessionId?: string;
  failedAt?: number;
  recoveredAt?: number;
  summaryMessageId?: string;
  summary?: string;
  lastFailedMsgId?: string;
  error?: string;
}

export interface ContextRecoveryMessageData {
  reason: ContextRecoveryReason;
  used?: number;
  size?: number;
  error?: string;
  actions: Array<{
    id: ContextRecoveryActionId;
    label: string;
  }>;
}

export function isContextOverflowError(message: string): boolean {
  const text = message.toLowerCase();
  return ['context_length_exceeded', 'maximum context length', 'context length', 'token limit', 'prompt is too long', 'input is too long', 'too many tokens', 'exceeds the context', 'exceed context', 'context window', '超出模型处理限制', '超出了模型处理限制', '超过上下文', '超出上下文', '上下文过长', '内容过大', '超出'].some((pattern) => text.includes(pattern));
}

export interface ContextSummaryMessage {
  type: string;
  position?: 'left' | 'right' | 'center' | 'pop';
  text: string;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`;
}

export function buildContextSummaryFromMessages(messages: ContextSummaryMessage[]): string {
  const visibleMessages = messages.filter((message) => message.type !== 'context_recovery' && message.text.trim());
  const recentMessages = visibleMessages.slice(-20);
  const userMessages = visibleMessages.filter((message) => message.position === 'right');
  const assistantMessages = visibleMessages.filter((message) => message.position === 'left');
  const filePaths = new Set<string>();
  const commandHints = new Set<string>();
  const pathPattern = /(?:\/[\w .@-]+)+(?:\.[\w-]+)?/g;
  const commandPattern = /`([^`\n]{2,120})`/g;

  for (const message of visibleMessages) {
    for (const match of message.text.matchAll(pathPattern)) {
      filePaths.add(match[0].trim());
      if (filePaths.size >= 20) break;
    }
    for (const match of message.text.matchAll(commandPattern)) {
      commandHints.add(match[1].trim());
      if (commandHints.size >= 20) break;
    }
  }

  const latestUserGoal = userMessages.length > 0 ? userMessages[userMessages.length - 1].text : '';
  const latestAssistant = assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1].text : '';

  const recentBlock = recentMessages
    .map((message, index) => {
      const role = message.position === 'right' ? 'User' : message.position === 'left' ? 'Assistant' : 'System';
      const text = truncate(message.text.trim(), 1200);
      if (!text) return '';
      return `### ${index + 1}. ${role}\n${text}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return `# 压缩后的上下文摘要

## 用户目标
${truncate(latestUserGoal || '未能从历史中提取明确目标。', 1600)}

## 当前状态
${truncate(latestAssistant || '暂无最近助手输出。', 1600)}

## 涉及文件
${
  Array.from(filePaths)
    .slice(0, 20)
    .map((item) => `- ${item}`)
    .join('\n') || '- 未识别到明确文件路径。'
}

## 关键命令或标识
${
  Array.from(commandHints)
    .slice(0, 20)
    .map((item) => `- ${item}`)
    .join('\n') || '- 未识别到明确命令。'
}

## 最近对话
${recentBlock || '无可压缩的最近对话。'}

## 下一步
请基于以上摘要继续当前会话，不要要求用户重复说明此前上下文。`;
}
