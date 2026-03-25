/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chatLib';
import type { AcpBackend } from '@/types/acpTypes';
import { addOrUpdateMessage } from '@process/message';
import { stripThinkTags } from '@process/task/ThinkTagDetector';
import type { IResponseMessage } from '@/common/ipcBridge';

// ========== Buffered Stream Text Messages ==========

type BufferedStreamTextMessage = {
  conversationId: string;
  backend: AcpBackend;
  message: Extract<TMessage, { type: 'text' }>;
  timer: ReturnType<typeof setTimeout>;
};

export class StreamTextBuffer {
  private readonly flushIntervalMs = 120;
  private readonly buffered = new Map<string, BufferedStreamTextMessage>();

  private makeKey(message: Extract<TMessage, { type: 'text' }>): string {
    return `${message.conversation_id}:${message.msg_id || message.id}`;
  }

  queue(message: Extract<TMessage, { type: 'text' }>, backend: AcpBackend): void {
    const key = this.makeKey(message);
    const existing = this.buffered.get(key);
    if (existing) {
      this.buffered.set(key, {
        ...existing,
        message: {
          ...existing.message,
          content: {
            ...existing.message.content,
            content: existing.message.content.content + message.content.content,
          },
        },
      });
      return;
    }

    const bufferedMessage: Extract<TMessage, { type: 'text' }> = {
      ...message,
      content: { ...message.content },
    };
    const timer = setTimeout(() => {
      this.flush(key);
    }, this.flushIntervalMs);

    this.buffered.set(key, {
      conversationId: message.conversation_id,
      backend,
      message: bufferedMessage,
      timer,
    });
  }

  flush(key: string): void {
    const entry = this.buffered.get(key);
    if (!entry) return;

    clearTimeout(entry.timer);
    this.buffered.delete(key);
    addOrUpdateMessage(entry.conversationId, entry.message, entry.backend);
  }

  flushAll(): void {
    if (this.buffered.size === 0) return;
    const keys = Array.from(this.buffered.keys());
    for (const key of keys) {
      this.flush(key);
    }
  }
}

// ========== Cron Detection Accumulator ==========

export class CronTextAccumulator {
  currentMsgId: string | null = null;
  currentMsgContent: string = '';

  accumulate(msgId: string | undefined, textContent: string): void {
    if (msgId !== this.currentMsgId) {
      this.currentMsgId = msgId || null;
      this.currentMsgContent = textContent;
    } else {
      this.currentMsgContent += textContent;
    }
  }

  reset(): void {
    this.currentMsgId = null;
    this.currentMsgContent = '';
  }
}

// ========== Think Tag Filtering ==========

export function filterThinkTagsFromMessage(message: IResponseMessage): IResponseMessage {
  if (message.type !== 'content' || typeof message.data !== 'string') {
    return message;
  }

  const content = message.data;
  if (!/<\s*\/?\s*think(?:ing)?\s*>/i.test(content)) {
    return message;
  }

  const cleanedContent = stripThinkTags(content);
  return {
    ...message,
    data: cleanedContent,
  };
}
