/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IResponseMessage } from '@sudowork/host-bridge/ipcBridge';
import type { TMessage } from '@sudowork/common/chatLib';
import type { AcpBackend } from '@/types/acpTypes';
import { addOrUpdateMessage } from '@process/message';
import { stripThinkTags } from '@process/task/ThinkTagDetector';

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
    addOrUpdateMessage(entry.conversationId, entry.message);
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

// ========== Windows Path Normalization ==========

/**
 * Normalize Windows-style backslash paths in markdown image syntax to forward slashes.
 *
 * When agents return markdown with Windows paths like `![alt](C:\Users\...\image.png)`,
 * the backslashes are interpreted as escape characters by the markdown parser (remark),
 * corrupting the path (e.g. `\.` becomes `.`). This function converts such paths to
 * forward slashes before the content reaches the frontend markdown renderer.
 *
 * Also handles the Windows extended-length path prefix `\\?\` (e.g. `\\?\C:\Users\...\image.png`),
 * which is stripped before normalization.
 */
export function normalizeWindowsImagePaths(content: string): string {
  // Match markdown image syntax where the path starts with an optional \\?\ prefix
  // followed by a Windows drive letter (e.g. \\?\C:\ or C:\).
  // The \\?\ prefix is a Windows extended-length path prefix and must be stripped.
  return content.replace(/!\[([^\]]*)\]\((?:\\\\\?\\)?([A-Za-z]:\\[^)]+)\)/g, (_match, alt: string, imagePath: string) => {
    const normalizedPath = imagePath.replace(/\\/g, '/');
    return `![${alt}](${normalizedPath})`;
  });
}

export function isRawToolCallText(content: string): boolean {
  const trimmed = content.trim();
  return /^call:[\w.:-]+\{[\s\S]*\}$/.test(trimmed);
}

/**
 * Apply content message preprocessing: Windows image path normalization.
 * (Think-tag filtering is handled by StreamingThinkFilter at the AcpAgent stream level.)
 * This is the main entry point for message preprocessing before emission to the frontend.
 */
export function preprocessContentMessage(message: IResponseMessage): IResponseMessage {
  if (message.type !== 'content' || typeof message.data !== 'string') {
    return message;
  }

  let data = message.data;

  if (isRawToolCallText(data)) {
    return { ...message, data: '' };
  }

  // Normalize Windows image paths. Think-tag filtering is handled by StreamingThinkFilter
  // at the AcpAgent stream level (so tags can reach the renderer as a fallback).
  data = normalizeWindowsImagePaths(data);

  if (data === message.data) {
    return message;
  }

  return { ...message, data };
}
