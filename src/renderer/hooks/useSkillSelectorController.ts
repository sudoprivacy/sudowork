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
}

export function useSkillSelectorController(options: UseSkillSelectorControllerOptions) {
  const { input, skills, selectedSkills, onSelectSkill, onRemoveSkill, workspaceFiles = [], onSelectFile } = options;
  const query = useMemo(() => matchSkillQuery(input), [input]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<AtMentionTab>('skills');
  const [searchQuery, setSearchQuery] = useState('');
  const prevQueryRef = useRef<string | null>(null);

  // Determine if tabs should be shown (always show when in conversation with workspace)
  // Per user request: remove workspaceFiles.length > 0 condition
  const showTabs = workspaceFiles !== undefined && workspaceFiles !== null;

  // Reset state when query changes
  useEffect(() => {
    if (query !== prevQueryRef.current) {
      setActiveIndex(0);
      setDismissed(false);
      setSearchQuery('');
      prevQueryRef.current = query;
    }
  }, [query]);

  // Reset active index when search query changes
  useEffect(() => {
    setActiveIndex(0);
  }, [searchQuery]);

  const filteredSkills = useMemo(() => {
    if (query === null) {
      return [];
    }
    // Use searchQuery if available, otherwise fall back to @ query
    const rawKeyword = searchQuery.trim() || query.trim();
    const keyword = rawKeyword.toLowerCase();
    if (!keyword) {
      // Show all skills when query is empty
      return skills;
    }
    // Filter by display name, internal name, or description
    return skills.filter((skill) => {
      const nameMatch = skill.name.toLowerCase().includes(keyword);
      const displayNameMatch = skill.displayName.toLowerCase().includes(keyword);
      const descriptionMatch = skill.description?.toLowerCase().includes(keyword) ?? false;
      // Also support Chinese character matching
      const chineseMatch = rawKeyword ? skill.displayName.includes(rawKeyword) : false;
      return nameMatch || displayNameMatch || descriptionMatch || chineseMatch;
    });
  }, [skills, query, searchQuery]);

  const filteredFiles = useMemo(() => {
    if (query === null) {
      return [];
    }
    // Use searchQuery if available, otherwise fall back to @ query
    const rawKeyword = searchQuery.trim() || query.trim();
    const keyword = rawKeyword.toLowerCase();
    if (!keyword) {
      return workspaceFiles;
    }
    return workspaceFiles.filter((file) => {
      const nameMatch = file.name.toLowerCase().includes(keyword);
      const pathMatch = file.relativePath.toLowerCase().includes(keyword);
      return nameMatch || pathMatch;
    });
  }, [workspaceFiles, query, searchQuery]);

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

      if (event.key === 'Backspace' && query === '') {
        // Remove last selected skill when pressing backspace with empty query
        if (selectedSkills.length > 0) {
          onRemoveSkill?.(selectedSkills[selectedSkills.length - 1]);
          return true;
        }
      }

      return false;
    },
    [activeIndex, executeSkill, currentTabItems.length, isOpen, query, selectedSkills, onRemoveSkill, showTabs, switchTab]
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
