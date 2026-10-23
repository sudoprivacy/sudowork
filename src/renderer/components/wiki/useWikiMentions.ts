/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { UsableWiki } from '@/renderer/pages/wiki/api/types';
import { matchWikiQuery, replaceWikiQuery, resolveMentionedWikis, type IWikiMention } from './wikiMention';

/**
 * `#wiki` mentions for one input box. Tracks the `#query` at the cursor (null
 * once dismissed), inserts picked names, and resolves which mentions survive
 * into the sent text.
 */
export function useWikiMentions(input: string, setInput: (value: string) => void, isEnabled: boolean, cursorPosition?: number) {
  const [mentions, setMentions] = useState<IWikiMention[]>([]);
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);
  const rawQuery = useMemo(() => (isEnabled ? matchWikiQuery(input, cursorPosition) : null), [input, cursorPosition, isEnabled]);
  const lastQueryRef = useRef<string | null>(null);

  // A new `#` (or further typing) re-opens a dismissed popover.
  if (rawQuery !== lastQueryRef.current) {
    lastQueryRef.current = rawQuery;
    if (dismissedQuery !== null && rawQuery !== dismissedQuery) setDismissedQuery(null);
  }

  const mentionQuery = rawQuery !== null && rawQuery !== dismissedQuery ? rawQuery : null;

  const pick = useCallback(
    (wiki: UsableWiki) => {
      setInput(replaceWikiQuery(input, wiki.name, cursorPosition));
      setMentions((prev) => (prev.some((m) => m.id === wiki.id) ? prev : [...prev, { id: wiki.id, name: wiki.name }]));
    },
    [input, setInput, cursorPosition]
  );

  const dismiss = useCallback(() => setDismissedQuery(rawQuery), [rawQuery]);

  /** Ids to send for `text`, then forget the mentions. */
  const consume = useCallback(
    (text: string) => {
      const ids = resolveMentionedWikis(text, mentions);
      setMentions([]);
      return ids;
    },
    [mentions]
  );

  return { mentionQuery, pick, dismiss, consume };
}
