/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { WorkspaceFileItem } from './useWorkspaceFiles';

// Match @ at start of input or after whitespace, followed by query text
// Supports @ at any position in input (not just start)
const AT_QUERY_RE = /(?:^|\s)@([^\s@]*)$/;

/**
 * Extract the @ query from input text.
 * Returns the query string after @, or null if no @ trigger found.
 */
export function matchSkillQuery(input: string): string | null {
  const match = input.match(AT_QUERY_RE);
  return match ? match[1] : null;
}

/**
 * Strip the @query portion from input text, keeping everything before @.
 */
export function stripAtQuery(input: string): string {
  const match = input.match(/(?:^|\s)@[^\s@]*$/);
  if (!match) return input;
  const matchStart = match.index ?? 0;
  // Keep everything before the @ (including the leading space if any)
  const prefix = input.slice(0, matchStart);
  // If the match started with a space, keep it
  if (match[0].startsWith(' ') || match[0].startsWith('\t') || match[0].startsWith('\n')) {
    return prefix + match[0][0];
  }
  return prefix;
}

/**
 * Replace the @query portion in input text with a new value.
 */
export function replaceAtQuery(input: string, replacement: string): string {
  const match = input.match(/(?:^|\s)@[^\s@]*$/);
  if (!match) return input + replacement;
  const matchStart = match.index ?? 0;
  const prefix = input.slice(0, matchStart);
  if (match[0].startsWith(' ') || match[0].startsWith('\t') || match[0].startsWith('\n')) {
    return prefix + match[0][0] + replacement + ' ';
  }
  return prefix + replacement + ' ';
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
  skills: SkillSelectorItem[];
  selectedSkills: string[];
  onSelectSkill: (skillName: string) => void;
  onRemoveSkill?: (skillName: string) => void;
  /** Workspace files for @ file references */
  workspaceFiles?: WorkspaceFileItem[];
  /** Callback when a file is selected */
  onSelectFile?: (file: WorkspaceFileItem) => void;
  /** Whether to filter out disabled skills (for guide page) */
  filterDisabled?: boolean;
}

// 防抖延迟时间（毫秒）
const DEBOUNCE_DELAY = 150;

export function useSkillSelectorController(options: UseSkillSelectorControllerOptions) {
  const { input, skills, selectedSkills, onSelectSkill, onRemoveSkill, workspaceFiles = [], onSelectFile, filterDisabled = false } = options;
  const query = useMemo(() => matchSkillQuery(input), [input]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<AtMentionTab>('skills');
  const [searchQuery, setSearchQuery] = useState('');
  const prevQueryRef = useRef<string | null>(null);

  // 防抖状态：用于延迟过滤技能/文件列表
  const [debouncedQuery, setDebouncedQuery] = useState<string | null>(query);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  // 防抖定时器 ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 清理定时器
  const clearDebounceTimer = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  // 组件卸载时清理定时器
  useEffect(() => {
    return clearDebounceTimer;
  }, [clearDebounceTimer]);

  // 防抖处理：延迟更新过滤条件，减少频繁计算
  useEffect(() => {
    clearDebounceTimer();
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(query);
      setDebouncedSearchQuery(searchQuery);
    }, DEBOUNCE_DELAY);
  }, [query, searchQuery, clearDebounceTimer]);

  // Determine if tabs should be shown (always show when in conversation with workspace)
  // Per user request: remove workspaceFiles.length > 0 condition
  const showTabs = workspaceFiles !== undefined && workspaceFiles !== null;

  // Reset state when debounced query changes
  useEffect(() => {
    if (debouncedQuery !== prevQueryRef.current) {
      setActiveIndex(0);
      setDismissed(false);
      setSearchQuery('');
      prevQueryRef.current = debouncedQuery;
    }
  }, [debouncedQuery]);

  // Reset active index when search query changes
  useEffect(() => {
    setActiveIndex(0);
  }, [searchQuery]);

  const filteredSkills = useMemo(() => {
    if (debouncedQuery === null) {
      return [];
    }
    // Use searchQuery if available, otherwise fall back to @ query
    const rawKeyword = debouncedSearchQuery.trim() || debouncedQuery.trim();
    const keyword = rawKeyword.toLowerCase();

    // Start with all skills, or filter by enabled status if filterDisabled is true
    let result = skills;
    if (filterDisabled) {
      result = skills.filter((skill) => skill.enabled !== false);
    }

    if (!keyword) {
      // Show all (enabled) skills when query is empty
      return result;
    }

    // Filter by display name, internal name, or description
    return result.filter((skill) => {
      const nameMatch = skill.name.toLowerCase().includes(keyword);
      const displayNameMatch = skill.displayName.toLowerCase().includes(keyword);
      const descriptionMatch = skill.description?.toLowerCase().includes(keyword) ?? false;
      // Also support Chinese character matching
      const chineseMatch = rawKeyword ? skill.displayName.includes(rawKeyword) : false;
      return nameMatch || displayNameMatch || descriptionMatch || chineseMatch;
    });
  }, [skills, debouncedQuery, debouncedSearchQuery, filterDisabled]);

  const filteredFiles = useMemo(() => {
    if (debouncedQuery === null) {
      return [];
    }
    // Use searchQuery if available, otherwise fall back to @ query
    const rawKeyword = debouncedSearchQuery.trim() || debouncedQuery.trim();
    const keyword = rawKeyword.toLowerCase();
    if (!keyword) {
      return workspaceFiles;
    }
    return workspaceFiles.filter((file) => {
      const nameMatch = file.name.toLowerCase().includes(keyword);
      const pathMatch = file.relativePath.toLowerCase().includes(keyword);
      return nameMatch || pathMatch;
    });
  }, [workspaceFiles, debouncedQuery, debouncedSearchQuery]);

  // Get items for current tab
  const currentTabItems = activeTab === 'skills' ? filteredSkills : filteredFiles;

  // Menu is open when query is detected and not dismissed, and either tab has content or tabs are shown
  const hasAnyContent = filteredSkills.length > 0 || filteredFiles.length > 0;
  const isOpen = query !== null && !dismissed && (hasAnyContent || showTabs);

  const executeSkill = useCallback(
    (index: number) => {
      if (activeTab === 'skills') {
        const skill = filteredSkills[index];
        if (!skill) return false;
        onSelectSkill(skill.name);
        setDismissed(true);
        return true;
      } else {
        const file = filteredFiles[index];
        if (!file) return false;
        onSelectFile?.(file);
        setDismissed(true);
        return true;
      }
    },
    [activeTab, filteredSkills, filteredFiles, onSelectSkill, onSelectFile]
  );

  const switchTab = useCallback(() => {
    if (!showTabs) return;
    setActiveTab((prev) => (prev === 'skills' ? 'files' : 'skills'));
    setActiveIndex(0);
    setSearchQuery('');
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

      // Tab key switches between tabs
      if (event.key === 'Tab' && showTabs) {
        event.preventDefault();
        switchTab();
        return true;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, currentTabItems.length - 1));
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
        return true;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        return executeSkill(activeIndex);
      }

      if (event.key === 'Backspace' && debouncedQuery === '') {
        // Remove last selected skill when pressing backspace with empty query
        if (selectedSkills.length > 0) {
          onRemoveSkill?.(selectedSkills[selectedSkills.length - 1]);
          return true;
        }
      }

      return false;
    },
    [activeIndex, executeSkill, currentTabItems.length, isOpen, debouncedQuery, selectedSkills, onRemoveSkill, showTabs, switchTab]
  );

  return {
    isOpen,
    activeIndex,
    filteredSkills,
    filteredFiles,
    activeTab,
    showTabs,
    setActiveTab: (tab: AtMentionTab) => {
      setActiveTab(tab);
      setActiveIndex(0);
      setSearchQuery('');
    },
    searchQuery,
    setSearchQuery,
    onKeyDown,
    onSelectByIndex: executeSkill,
    setDismissed,
    setActiveIndex,
  };
}
