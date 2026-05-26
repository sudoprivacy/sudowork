/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContextRecoveryMessageData, ContextRecoveryState } from '@/common/contextRecovery';
import { buildContextSummaryFromMessages } from '@/common/contextRecovery';
import type { TMessage } from '@/common/chatLib';
import { transformMessage } from '@/common/chatLib';
import { ipcBridge } from '@/common';
import { uuid } from '@/common/utils';
import type { TChatConversation } from '@/common/storage';
import { getDatabase } from '@process/database';
import { addMessage } from '@process/message';
import { mainWarn } from '@process/utils/mainLogger';

function getRecoveryActions(reason: ContextRecoveryMessageData['reason']): ContextRecoveryMessageData['actions'] {
  if (reason === 'overflowed' || reason === 'failed') {
    return [
      { id: 'compress', label: '压缩并继续' },
      { id: 'fresh', label: '开启空白新会话' },
    ];
  }
  return [
    { id: 'compress', label: '压缩后继续' },
    { id: 'fresh', label: '新会话继续' },
    { id: 'dismiss', label: '继续当前会话' },
  ];
}

export function buildContextRecoveryMessage(conversationId: string, reason: ContextRecoveryMessageData['reason'], options?: { msgId?: string; error?: string; used?: number; size?: number }): TMessage | undefined {
  return transformMessage({
    type: 'context_recovery',
    conversation_id: conversationId,
    msg_id: options?.msgId || `context-recovery-${reason}`,
    data: {
      reason,
      used: options?.used,
      size: options?.size,
      error: options?.error,
      actions: getRecoveryActions(reason),
    } satisfies ContextRecoveryMessageData,
  });
}

export function emitContextRecoveryMessage(conversationId: string, reason: ContextRecoveryMessageData['reason'], options?: { msgId?: string; error?: string; used?: number; size?: number }): void {
  const message = {
    type: 'context_recovery',
    conversation_id: conversationId,
    msg_id: options?.msgId || `context-recovery-${reason}`,
    data: {
      reason,
      used: options?.used,
      size: options?.size,
      error: options?.error,
      actions: getRecoveryActions(reason),
    } satisfies ContextRecoveryMessageData,
  };
  ipcBridge.conversation.responseStream.emit(message);
}

export function updateConversationContextRecovery(conversation: TChatConversation, state: ContextRecoveryState | null): boolean {
  if (conversation.type !== 'acp') return false;
  const db = getDatabase();
  const updatedExtra = {
    ...conversation.extra,
    contextRecovery: state || undefined,
  };
  const result = db.updateConversation(conversation.id, { extra: updatedExtra } as Partial<TChatConversation>);
  return result.success;
}

export function addContextRecoveryTip(conversationId: string, content: string, type: 'success' | 'warning' | 'error' = 'success'): TMessage {
  const message: TMessage = {
    id: uuid(),
    msg_id: uuid(),
    conversation_id: conversationId,
    type: 'tips',
    position: 'center',
    content: {
      content,
      type,
    },
    createdAt: Date.now(),
  };
  addMessage(conversationId, message);
  return message;
}

function extractMessageText(message: TMessage): string {
  if (message.type === 'text') return message.content.content || '';
  if (message.type === 'tips') return `[${message.content.type}] ${message.content.content}`;
  if (message.type === 'plan') return message.content.entries.map((entry) => `- [${entry.status}] ${entry.content}`).join('\n');
  if (message.type === 'tool_group') return message.content.map((tool) => `Tool ${tool.name}: ${tool.status}`).join('\n');
  if (message.type === 'acp_tool_call') return `Tool ${message.content.update?.title || message.content.update?.toolCallId || 'call'}: ${message.content.update?.status || 'pending'}`;
  if (message.type === 'context_recovery') return '';
  return '';
}

export function buildLocalContextSummary(messages: TMessage[]): string {
  return buildContextSummaryFromMessages(
    messages.map((message) => ({
      type: message.type,
      position: message.position,
      text: extractMessageText(message),
    }))
  );
}

export function loadConversationMessagesForSummary(conversationId: string): TMessage[] {
  try {
    const db = getDatabase();
    return db.getConversationMessages(conversationId, 0, 10000).data;
  } catch (error) {
    mainWarn('ContextRecovery', 'Failed to load messages for summary:', error);
    return [];
  }
}
