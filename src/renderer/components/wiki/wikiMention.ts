/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/** `#` followed by the query text, ending at the cursor. */
const WIKI_QUERY_RE = /(?:^|\s)#([^\s#]*)$/;

export interface IWikiMention {
  id: string;
  name: string;
}

/** The `#query` being typed at the cursor, or null when not mentioning. */
export function matchWikiQuery(input: string, cursorPosition?: number): string | null {
  const before = cursorPosition !== undefined ? input.slice(0, cursorPosition) : input;
  const match = before.match(WIKI_QUERY_RE);
  return match ? match[1] : null;
}

/** Replace the `#query` at the cursor with `#<name> `. */
export function replaceWikiQuery(input: string, name: string, cursorPosition?: number): string {
  const before = cursorPosition !== undefined ? input.slice(0, cursorPosition) : input;
  const after = cursorPosition !== undefined ? input.slice(cursorPosition) : '';
  const match = before.match(WIKI_QUERY_RE);
  if (!match) return `${input}#${name} `;
  const start = (match.index ?? 0) + (match[0].length - match[1].length - 1);
  return `${before.slice(0, start)}#${name} ${after}`;
}

/** Ids of mentions whose `#name` is still in the text (the user may have deleted some). */
export function resolveMentionedWikis(text: string, mentions: readonly IWikiMention[]): string[] {
  const ids = mentions.filter((m) => text.includes(`#${m.name}`)).map((m) => m.id);
  return [...new Set(ids)];
}
