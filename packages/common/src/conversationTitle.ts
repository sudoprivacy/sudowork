/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { stripThinkTags } from './thinkTagFilter.js';

/** Beyond this the sidebar truncates anyway, so a longer title buys nothing. */
const MAX_TITLE_LENGTH = 50;

/**
 * Derive a conversation's title from its first user message.
 *
 * A conversation's name is a durable fact about it, so it is produced once,
 * where the message is accepted, and not recomputed by whoever happens to open
 * the conversation later. Desktop and the WebUI server both call this, so the
 * two surfaces cannot drift apart on what the same conversation is called.
 *
 * Returns null when the message yields nothing usable — empty, or reasoning
 * with no visible content — so the caller leaves the conversation untitled
 * instead of storing a blank name that later reads as a real one.
 */
export function deriveConversationTitle(messageContent: string): string | null {
  if (typeof messageContent !== 'string') return null;
  const firstLine = stripThinkTags(messageContent).split('\n')[0] ?? '';
  return firstLine.slice(0, MAX_TITLE_LENGTH).trim() || null;
}

/**
 * Names stored by older builds to mean "this conversation has no name yet".
 *
 * Writing a display string where absence was meant is why these exist, and why
 * they are English in an otherwise translated UI: translating them would have
 * broken every comparison against them. Nothing new should write these — they
 * are listed here only so the code that has to recognise legacy rows does not
 * re-spell them, and so the set shrinks in one place once those rows are gone.
 */
export const LEGACY_UNNAMED_CONVERSATION_NAMES: readonly string[] = ['Remote Agent', 'Moss Server'];

/**
 * Whether a conversation still needs a derived title.
 *
 * Absence has been spelled several different ways over time — null, the
 * conversation's own id, a translated "new conversation" label, or a whole
 * first message stored as the name. They are all listed here so no caller has
 * to re-derive the set, and so it shrinks in one place as those rows age out.
 */
export function isUnnamedConversation(
  name: string | null | undefined,
  options: {
    /** The translated "new conversation" label — only the UI layer can resolve it. */
    localizedDefaults?: readonly string[];
    /** The conversation's own id; some builds stored it as the name. */
    conversationId?: string;
  } = {},
): boolean {
  if (!name) return true;
  // Older builds stored the whole first message as the name; anything this long
  // was never a title, so re-derive it.
  if (name.length > MAX_TITLE_LENGTH) return true;
  if (options.conversationId && name === options.conversationId) return true;
  if (LEGACY_UNNAMED_CONVERSATION_NAMES.includes(name)) return true;
  return options.localizedDefaults?.includes(name) ?? false;
}
