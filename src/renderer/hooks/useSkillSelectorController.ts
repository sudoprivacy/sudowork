/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { FileItem } from '@/renderer/hooks/useWorkspaceFiles';

// Match @ followed by query at any position in input (preceded by start of string or whitespace)
// 匹配输入中任意位置的 @（前面是字符串开头或空白字符）
const SKILL_QUERY_RE = /(?:^|\s)@([^\s@]*)$/;

export function matchSkillQuery(input: string): string | null {
  const match = input.match(SKILL_QUERY_RE);
  return match ? match[1] : null;
}

/**
 * Replace the @query portion at the end of input with a replacement string
 * 替换输入末尾的 @query 部分
 * @param input - Current input string
 * @param replacement - Replacement text (e.g., '' for skills, '@filepath' for files)
 */
export function replaceAtQuery(input: string, replacement: string): string {
  const match = input.match(/(?:^|\s)(@[^\s@]*)$/);
  if (!match) return input;
  const atPart = match[1]; // e.g., "@que"
  const lastIndex = input.lastIndexOf(atPart);
  if (lastIndex === -1) return input;
  const before = input.substring(0, lastIndex);
  if (replacement) {
    return before + replacement + ' ';
  }
  return before.trimEnd();
}

export type ActiveTab = 'skills' | 'files';

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
  fileItems?: FileItem[];
  onSelectFile?: (file: FileItem) => void;
}

export function useSkillSelectorController(options: UseSkillSelectorControllerOptions) {
  const { input, skills, selectedSkills, onSelectSkill, onRemoveSkill, fileItems = [], onSelectFile } = options;
  const query = useMemo(() => matchSkillQuery(input), [input]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('skills');

  const showTabs = fileItems.length > 0;

  // Reset state when query changes
  useEffect(() => {
    setActiveIndex((prev) => (prev !== 0 ? 0 : prev));
    setDismissed((prev) => (prev !== false ? false : prev));
  }, [query]);

  // Reset active index when tab changes
  useEffect(() => {
    setActiveIndex(0);
  }, [activeTab]);

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

  const filteredFiles = useMemo(() => {
    if (query === null || fileItems.length === 0) {
      return [];
    }
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return fileItems;
    }
    return fileItems.filter((file) => {
      const nameMatch = file.name.toLowerCase().includes(keyword);
      const pathMatch = file.relativePath.toLowerCase().includes(keyword);
      return nameMatch || pathMatch;
    });
  }, [fileItems, query]);

  // Get current tab's item count for navigation
  const currentItemCount = activeTab === 'skills' ? filteredSkills.length : filteredFiles.length;

  // Menu should be open when @ query is detected and not dismissed
  // Show even if current tab has no items (user can switch tabs)
  const hasAnyItems = filteredSkills.length > 0 || filteredFiles.length > 0;
  const isOpen = query !== null && !dismissed && hasAnyItems;

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

  const executeFile = useCallback(
    (index: number) => {
      const file = filteredFiles[index];
      if (!file) {
        return false;
      }
      onSelectFile?.(file);
      setDismissed(true);
      return true;
    },
    [filteredFiles, onSelectFile]
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

      // Tab key switches between tabs when tabs are visible
      if (event.key === 'Tab' && showTabs) {
        event.preventDefault();
        setActiveTab((prev) => (prev === 'skills' ? 'files' : 'skills'));
        return true;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (currentItemCount > 0) {
          setActiveIndex((prev) => (prev + 1) % currentItemCount);
        }
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (currentItemCount > 0) {
          setActiveIndex((prev) => (prev - 1 + currentItemCount) % currentItemCount);
        }
        return true;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (activeTab === 'skills') {
          return executeSkill(activeIndex);
        }
        return executeFile(activeIndex);
      }

      if (event.key === 'Backspace' && query === '' && activeTab === 'skills') {
        // Remove last selected skill when pressing backspace with empty query
        if (selectedSkills.length > 0) {
          onRemoveSkill?.(selectedSkills[selectedSkills.length - 1]);
          return true;
        }
      }

      return false;
    },
    [activeIndex, activeTab, currentItemCount, executeFile, executeSkill, isOpen, query, selectedSkills, showTabs, onRemoveSkill]
  );

  return {
    isOpen,
    activeIndex,
    activeTab,
    filteredSkills,
    filteredFiles,
    showTabs,
    onKeyDown,
    onSelectByIndex: executeSkill,
    onSelectFileByIndex: executeFile,
    setDismissed,
    setActiveIndex,
    setActiveTab,
  };
}
