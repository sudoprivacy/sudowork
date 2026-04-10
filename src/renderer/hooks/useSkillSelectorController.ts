/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { WorkspaceFileItem } from './useWorkspaceFiles';

// Match @ followed by query at any position in input (at start or after whitespace)
const AT_QUERY_RE = /(?:^|\s)@([^\s@]*)$/;

export function matchSkillQuery(input: string): string | null {
  const match = input.match(AT_QUERY_RE);
  return match ? match[1] : null;
}

/**
 * Replace the @query at the end of input with @replacement + trailing space
 */
export function replaceAtQuery(input: string, replacement: string): string {
  const match = input.match(AT_QUERY_RE);
  if (!match) return input;
  const query = match[1];
  const atIndex = input.length - query.length - 1;
  return input.slice(0, atIndex) + '@' + replacement + ' ';
}

/**
 * Strip the @query from the end of input, keeping text before it
 */
export function stripAtQuery(input: string): string {
  const match = input.match(AT_QUERY_RE);
  if (!match) return input;
  const query = match[1];
  const atIndex = input.length - query.length - 1;
  return input.slice(0, atIndex);
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
  workspaceFiles?: WorkspaceFileItem[];
  onSelectFile?: (file: WorkspaceFileItem) => void;
}

export function useSkillSelectorController(options: UseSkillSelectorControllerOptions) {
  const { input, skills, selectedSkills, onSelectSkill, onRemoveSkill, workspaceFiles = [], onSelectFile } = options;
  const query = useMemo(() => matchSkillQuery(input), [input]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<'skills' | 'files'>('skills');

  const showTabs = workspaceFiles.length > 0;

  // Track previous query to detect new @ trigger (reset tab to skills)
  const prevQueryNullRef = useRef(query === null);

  // Reset state when query changes
  useEffect(() => {
    setActiveIndex((prev) => (prev !== 0 ? 0 : prev));
    setDismissed((prev) => (prev !== false ? false : prev));
  }, [query]);

  // Reset tab to skills when dropdown opens from closed state
  useEffect(() => {
    const wasNull = prevQueryNullRef.current;
    prevQueryNullRef.current = query === null;
    if (wasNull && query !== null) {
      setActiveTab('skills');
    }
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

  const filteredFiles = useMemo(() => {
    if (query === null) {
      return [];
    }
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return workspaceFiles;
    }
    return workspaceFiles.filter((file) => {
      return file.name.toLowerCase().includes(keyword) || file.relativePath.toLowerCase().includes(keyword);
    });
  }, [workspaceFiles, query]);

  const currentItems = activeTab === 'skills' ? filteredSkills : filteredFiles;

  // Dropdown is open when:
  // 1. There is an active @ query
  // 2. Not dismissed
  // 3. Either there are items to show OR tabs are available (user can switch to the other tab)
  const hasAnyContent = filteredSkills.length > 0 || filteredFiles.length > 0;
  const isOpen = query !== null && !dismissed && (hasAnyContent || showTabs);

  const executeSelection = useCallback(
    (index: number) => {
      if (activeTab === 'skills') {
        const skill = filteredSkills[index];
        if (!skill) {
          return false;
        }
        onSelectSkill(skill.name);
        setDismissed(true);
        return true;
      } else {
        const file = filteredFiles[index];
        if (!file) {
          return false;
        }
        onSelectFile?.(file);
        setDismissed(true);
        return true;
      }
    },
    [activeTab, filteredSkills, filteredFiles, onSelectSkill, onSelectFile]
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

      if (event.key === 'Tab' && showTabs) {
        event.preventDefault();
        setActiveTab((prev) => (prev === 'skills' ? 'files' : 'skills'));
        setActiveIndex(0);
        return true;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, currentItems.length - 1));
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
        return true;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        return executeSelection(activeIndex);
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
    [activeIndex, currentItems.length, executeSelection, isOpen, query, selectedSkills, onRemoveSkill, showTabs]
  );

  return {
    isOpen,
    activeIndex,
    filteredSkills,
    filteredFiles,
    activeTab,
    showTabs,
    setActiveTab,
    onKeyDown,
    onSelectByIndex: executeSelection,
    setDismissed,
    setActiveIndex,
  };
}
