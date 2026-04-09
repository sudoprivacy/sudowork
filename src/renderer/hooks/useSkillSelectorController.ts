/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

// Match @ followed by query text at any position (start of input or after whitespace)
// 匹配输入中任意位置（开头或空白字符后）的 @ 及其后跟的查询文本
const AT_QUERY_RE = /(?:^|\s)@([^\s@]*)$/;

export function matchSkillQuery(input: string): string | null {
  const match = input.match(AT_QUERY_RE);
  return match ? match[1] : null;
}

/**
 * Strip the @query token from the end of input, preserving preceding text.
 * 从输入末尾移除 @query 令牌，保留前面的文本。
 */
export function stripAtQuery(input: string): string {
  return input.replace(AT_QUERY_RE, (match) => {
    const firstChar = match[0];
    return /\s/.test(firstChar) ? firstChar : '';
  });
}

/**
 * Replace the @query token at the end of input with a replacement string.
 * 将输入末尾的 @query 令牌替换为指定字符串。
 */
export function replaceAtQuery(input: string, replacement: string): string {
  return input.replace(AT_QUERY_RE, (match) => {
    const firstChar = match[0];
    const prefix = /\s/.test(firstChar) ? firstChar : '';
    return prefix + replacement;
  });
}

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
  skills: SkillSelectorItem[];
  selectedSkills: string[];
  onSelectSkill: (skillName: string) => void;
  onRemoveSkill?: (skillName: string) => void;
}

export function useSkillSelectorController(options: UseSkillSelectorControllerOptions) {
  const { input, skills, selectedSkills, onSelectSkill, onRemoveSkill } = options;
  const query = useMemo(() => matchSkillQuery(input), [input]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Reset state only when query changes
  useEffect(() => {
    setActiveIndex((prev) => (prev !== 0 ? 0 : prev));
    setDismissed((prev) => (prev !== false ? false : prev));
  }, [query]);

  const filteredSkills = useMemo(() => {
    if (query === null) {
      return [];
    }
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      // Show all skills when query is empty
      return skills;
    }
    // Filter by display name or internal name
    return skills.filter((skill) => {
      const nameMatch = skill.name.toLowerCase().includes(keyword);
      const displayNameMatch = skill.displayName.toLowerCase().includes(keyword);
      // Also support Chinese character matching
      const chineseMatch = query && skill.displayName.includes(query);
      return nameMatch || displayNameMatch || chineseMatch;
    });
  }, [skills, query]);

  const isOpen = query !== null && !dismissed && filteredSkills.length > 0;

  const executeSkill = useCallback(
    (index: number) => {
      const skill = filteredSkills[index];
      if (!skill) {
        return false;
      }
      onSelectSkill(skill.name);
      setDismissed(true);
      return true;
    },
    [filteredSkills, onSelectSkill]
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!isOpen) {
        return false;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissed(true);
        return true;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % filteredSkills.length);
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) => (prev - 1 + filteredSkills.length) % filteredSkills.length);
        return true;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        return executeSkill(activeIndex);
      }

      if (event.key === 'Backspace' && query === '') {
        // Remove last selected skill when pressing backspace with empty query
        if (selectedSkills.length > 0) {
          onRemoveSkill?.(selectedSkills[selectedSkills.length - 1]);
          return true;
        }
      }

      return false;
    },
    [activeIndex, executeSkill, filteredSkills.length, isOpen, query, selectedSkills, onRemoveSkill]
  );

  return {
    isOpen,
    activeIndex,
    filteredSkills,
    onKeyDown,
    onSelectByIndex: executeSkill,
    setDismissed,
    setActiveIndex,
  };
}
