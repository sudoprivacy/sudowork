/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { emitter } from '@/renderer/utils/emitter';

// Match @ followed by query text, ending at the current cursor position
const AT_QUERY_RE = /(?:^|\s)@([^\s@]*)$/;

/**
 * Extract the @ query from input text based on cursor position.
 * Returns the query string after @, or null if no @ trigger found.
 */
export function matchSkillQuery(input: string, cursorPosition?: number): string | null {
  const textBeforeCursor = cursorPosition !== undefined ? input.slice(0, cursorPosition) : input;
  const match = textBeforeCursor.match(AT_QUERY_RE);
  return match ? match[1] : null;
}

/**
 * Strip the @query portion from input text at specific position.
 */
export function stripAtQuery(input: string, cursorPosition?: number): string {
  const textBeforeCursor = cursorPosition !== undefined ? input.slice(0, cursorPosition) : input;
  const textAfterCursor = cursorPosition !== undefined ? input.slice(cursorPosition) : '';

  const match = textBeforeCursor.match(/(?:^|\s)@[^\s@]*$/);
  if (!match) return input;

  const matchStart = match.index ?? 0;
  const prefix = textBeforeCursor.slice(0, matchStart);

  let resultPrefix = prefix;
  if (match[0].startsWith(' ') || match[0].startsWith('\t') || match[0].startsWith('\n')) {
    resultPrefix = prefix + match[0][0];
  }

  return resultPrefix + textAfterCursor;
}

/**
 * Replace the @query portion in input text with a new value.
 */
export function replaceAtQuery(input: string, replacement: string, cursorPosition?: number): string {
  const textBeforeCursor = cursorPosition !== undefined ? input.slice(0, cursorPosition) : input;
  const textAfterCursor = cursorPosition !== undefined ? input.slice(cursorPosition) : '';

  const match = textBeforeCursor.match(/(?:^|\s)@[^\s@]*$/);
  if (!match) return input + replacement;

  const matchStart = match.index ?? 0;
  const prefix = textBeforeCursor.slice(0, matchStart);

  let resultPrefix = prefix;
  if (match[0].startsWith(' ') || match[0].startsWith('\t') || match[0].startsWith('\n')) {
    resultPrefix = prefix + match[0][0];
  }

  return resultPrefix + replacement + ' ' + textAfterCursor;
}

export type AtMentionTab = 'skills' | 'files';

export interface SkillSelectorItem {
  name: string;
  displayName: string;
  description?: string;
  icon?: string;
  emoji?: string;
  enabled?: boolean;
}

interface UseSkillSelectorControllerOptions {
  input: string;
  cursorPosition?: number;
  selectedSkills: string[];
  onRemoveSkill?: (skillName: string) => void;
}

export function useSkillSelectorController(options: UseSkillSelectorControllerOptions) {
  const { input, cursorPosition, selectedSkills, onRemoveSkill } = options;
  const query = useMemo(() => matchSkillQuery(input, cursorPosition), [input, cursorPosition]);
  const [dismissed, setDismissed] = useState(false);
  const prevQueryRef = useRef<string | null>(null);

  // Reset dismissed state when a new @ query appears
  if (query !== prevQueryRef.current) {
    if (query !== null) setDismissed(false);
    prevQueryRef.current = query;
  }

  const isOpen = query !== null && !dismissed;

  // Emit event when skill selector opens via @ trigger
  const prevIsOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      emitter.emit('skill-selector.open');
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!isOpen) return false;

      if (event.key === 'Backspace' && query === '') {
        if (selectedSkills.length > 0) {
          onRemoveSkill?.(selectedSkills[selectedSkills.length - 1]);
          return true;
        }
      }

      return false;
    },
    [isOpen, query, selectedSkills, onRemoveSkill]
  );

  return {
    isOpen,
    setDismissed,
    onKeyDown,
  };
}
