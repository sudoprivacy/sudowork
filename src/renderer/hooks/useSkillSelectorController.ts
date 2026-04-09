/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

// Match @ at start of input or after whitespace, followed by a query string
// 匹配输入开头或空白符后的 @，后跟查询字符串
const SKILL_QUERY_RE = /(?:^|\s)@([^\s@]*)$/;

export function matchSkillQuery(input: string): string | null {
  const match = input.match(SKILL_QUERY_RE);
  return match ? match[1] : null;
}

/**
 * Strip the @query token from the input string, returning the text before it.
 * 从输入字符串中移除 @query token，返回其前面的文本。
 */
export function stripAtQuery(input: string): string {
  return input.replace(SKILL_QUERY_RE, (match) => {
    // Preserve leading whitespace if @ was preceded by a space
    return match.startsWith(' ') || match.startsWith('\t') ? ' ' : '';
  });
}

/**
 * Replace the @query token in input with the given replacement text.
 * 将输入中的 @query token 替换为给定的替换文本。
 */
export function replaceAtQuery(input: string, replacement: string): string {
  return input.replace(SKILL_QUERY_RE, (match) => {
    const prefix = match.startsWith(' ') || match.startsWith('\t') ? ' ' : '';
    return `${prefix}${replacement} `;
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

export type FileItem = {
  name: string;
  relativePath: string;
  fullPath: string;
  isDir: boolean;
};

export type AtMentionTab = 'skills' | 'files';

interface UseSkillSelectorControllerOptions {
  input: string;
  skills: SkillSelectorItem[];
  selectedSkills: string[];
  onSelectSkill: (skillName: string) => void;
  onRemoveSkill?: (skillName: string) => void;
  /** Workspace files available for @ mention */
  workspaceFiles?: FileItem[];
  /** Callback when a file is selected from the files tab */
  onSelectFile?: (file: FileItem) => void;
}

export function useSkillSelectorController(options: UseSkillSelectorControllerOptions) {
  const { input, skills, selectedSkills, onSelectSkill, onRemoveSkill, workspaceFiles = [], onSelectFile } = options;
  const query = useMemo(() => matchSkillQuery(input), [input]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<AtMentionTab>('skills');

  // Track previous query to detect real changes (avoid unnecessary resets)
  const prevQueryRef = useRef<string | null>(null);

  // Reset state when query changes (new @ trigger or query text changes)
  useEffect(() => {
    if (query !== prevQueryRef.current) {
      prevQueryRef.current = query;
      if (query !== null) {
        setActiveIndex(0);
        setDismissed(false);
      }
    }
  }, [query]);

  const filteredSkills = useMemo(() => {
    if (query === null) {
      return [];
    }
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return skills;
    }
    return skills.filter((skill) => {
      const nameMatch = skill.name.toLowerCase().includes(keyword);
      const displayNameMatch = skill.displayName.toLowerCase().includes(keyword);
      const chineseMatch = query && skill.displayName.includes(query);
      return nameMatch || displayNameMatch || chineseMatch;
    });
  }, [skills, query]);

  const filteredFiles = useMemo(() => {
    if (query === null) {
      return [];
    }
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return workspaceFiles;
    }
    return workspaceFiles.filter((file) => {
      const nameMatch = file.name.toLowerCase().includes(keyword);
      const pathMatch = file.relativePath.toLowerCase().includes(keyword);
      return nameMatch || pathMatch;
    });
  }, [workspaceFiles, query]);

  // Determine which items are active based on the current tab
  const activeItems = activeTab === 'skills' ? filteredSkills : filteredFiles;

  // Only show tabs when workspace files are available
  const showTabs = workspaceFiles.length > 0;

  // Determine if the dropdown should be open:
  // - query must exist (@ was typed)
  // - not dismissed
  // - either the active tab has items, or there are items in the other tab
  const hasAnyItems = filteredSkills.length > 0 || filteredFiles.length > 0;
  const isOpen = query !== null && !dismissed && hasAnyItems;

  // Auto-switch to the tab that has content when current tab is empty
  useEffect(() => {
    if (!isOpen) return;
    if (activeTab === 'skills' && filteredSkills.length === 0 && filteredFiles.length > 0) {
      setActiveTab('files');
      setActiveIndex(0);
    } else if (activeTab === 'files' && filteredFiles.length === 0 && filteredSkills.length > 0) {
      setActiveTab('skills');
      setActiveIndex(0);
    }
  }, [isOpen, activeTab, filteredSkills.length, filteredFiles.length]);

  const executeSkill = useCallback(
    (index: number) => {
      if (activeTab === 'files') {
        const file = filteredFiles[index];
        if (!file) return false;
        onSelectFile?.(file);
        setDismissed(true);
        return true;
      }
      const skill = filteredSkills[index];
      if (!skill) return false;
      onSelectSkill(skill.name);
      setDismissed(true);
      return true;
    },
    [activeTab, filteredFiles, filteredSkills, onSelectSkill, onSelectFile]
  );

  const switchTab = useCallback(() => {
    if (!showTabs) return;
    setActiveTab((prev) => {
      const next = prev === 'skills' ? 'files' : 'skills';
      setActiveIndex(0);
      return next;
    });
  }, [showTabs]);

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

      // Tab key switches between tabs (skills / files)
      if (event.key === 'Tab' && showTabs) {
        event.preventDefault();
        switchTab();
        return true;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        // Clamp to last item instead of wrapping
        setActiveIndex((prev) => Math.min(prev + 1, activeItems.length - 1));
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        // Clamp to first item instead of wrapping
        setActiveIndex((prev) => Math.max(prev - 1, 0));
        return true;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        return executeSkill(activeIndex);
      }

      if (event.key === 'Backspace' && query === '') {
        if (selectedSkills.length > 0) {
          onRemoveSkill?.(selectedSkills[selectedSkills.length - 1]);
          return true;
        }
      }

      return false;
    },
    [activeIndex, activeItems.length, executeSkill, isOpen, query, selectedSkills, onRemoveSkill, showTabs, switchTab]
  );

  return {
    isOpen,
    activeIndex,
    activeTab,
    showTabs,
    filteredSkills,
    filteredFiles,
    onKeyDown,
    onSelectByIndex: executeSkill,
    setDismissed,
    setActiveIndex,
    setActiveTab,
    switchTab,
  };
}
