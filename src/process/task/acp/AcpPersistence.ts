/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDatabase } from '@process/database';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';

/** Save ACP session ID to database for resume support. */
export function saveAcpSessionId(conversationId: string, sessionId: string): void {
  try {
    const db = getDatabase();
    const result = db.getConversation(conversationId);
    if (result.success && result.data && result.data.type === 'acp') {
      const conversation = result.data;
      const updatedExtra = {
        ...conversation.extra,
        acpSessionId: sessionId,
        acpSessionUpdatedAt: Date.now(),
      };
      db.updateConversation(conversationId, { extra: updatedExtra } as Partial<typeof conversation>);
      mainLog('[AcpAgent]', `Saved ACP session ID: ${sessionId} for conversation: ${conversationId}`);
    }
  } catch (error) {
    mainError('[AcpAgent]', 'Failed to save ACP session ID', error);
  }
}

/** Save session mode to database for resume support. */
export function saveSessionMode(conversationId: string, mode: string): void {
  try {
    const db = getDatabase();
    const result = db.getConversation(conversationId);
    if (result.success && result.data && result.data.type === 'acp') {
      const conversation = result.data;
      const updatedExtra = {
        ...conversation.extra,
        sessionMode: mode,
      };
      db.updateConversation(conversationId, { extra: updatedExtra } as Partial<typeof conversation>);
    }
  } catch (error) {
    mainError('[AcpAgent]', 'Failed to save session mode', error);
  }
}

/** Save model ID to database for resume support. */
export function saveModelId(conversationId: string, modelId: string): void {
  try {
    const db = getDatabase();
    const result = db.getConversation(conversationId);
    if (result.success && result.data && result.data.type === 'acp') {
      const conversation = result.data;
      const updatedExtra = {
        ...conversation.extra,
        currentModelId: modelId,
      };
      db.updateConversation(conversationId, { extra: updatedExtra } as Partial<typeof conversation>);
    }
  } catch (error) {
    mainWarn('[AcpAgent]', 'Failed to save model ID', error);
  }
}

/** Save context usage to database for restore on page switch. */
export function saveContextUsage(conversationId: string, usage: { used: number; size: number }): void {
  try {
    const db = getDatabase();
    const result = db.getConversation(conversationId);
    if (result.success && result.data && result.data.type === 'acp') {
      const conversation = result.data;
      const updatedExtra = {
        ...conversation.extra,
        lastTokenUsage: { totalTokens: usage.used },
        lastContextLimit: usage.size,
      };
      db.updateConversation(conversationId, { extra: updatedExtra } as Partial<typeof conversation>);
    }
  } catch {
    // Non-critical metadata, silently ignore errors
  }
}
