/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { WorkspaceFileItem } from './useWorkspaceFiles';

// Match @ followed by query text anywhere in the input (at start or after whitespace)
// Captures the query text after @ until end of input
const AT_QUERY_RE = /(?:^|\s)@([^\s]*)$/;

/**
 * Extract the @query from the input (at end of string, preceded by start or whitespace).
 * Returns the query text (without @) or null if no match.
 */
export function matchAtQuery(input: string): string | null {
  const match = input.match(AT_QUERY_RE);
  return match ? match[1] : null;
}

/**
 * Strip the @query from the end of input.
 * Example: "hello @ski" → "hello "
 */
export function stripAtQuery(input: string): string {
  return input.replace(AT_QUERY_RE, (match) => {
    // Preserve leading whitespace, remove @query
    const firstChar = match[0];
    if (firstChar === ' ' || firstChar === '\t' || firstChar === '\n') {
      return firstChar;
    }
    return '';
  });
}

/**
 * Replace the @query at end of input with a new @reference.
 * Example: "hello @fi" + "file.txt" → "hello @file.txt "
 */
export function replaceAtQuery(input: string, replacement: string): string {
  return input.replace(AT_QUERY_RE, (match) => {
    const firstChar = match[0];
    const prefix = firstChar === ' ' || firstChar === '\t' || firstChar === '\n' ? firstChar : '';
    return prefix + '@' + replacement + ' ';
  });
}

export type AtSelectorTab = 'skills' | 'files';

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
  files?: WorkspaceFileItem[];
  selectedSkills: string[];
  onSelectSkill: (skillName: string) => void;
  onSelectFile?: (file: WorkspaceFileItem, newInput: string) => void;
  onRemoveSkill?: (skillName: string) => void;
  hasFiles?: boolean;
}

export function useSkillSelectorController(options: UseSkillSelectorControllerOptions) {
  const { input, skills, files = [], selectedSkills, onSelectSkill, onSelectFile, onRemoveSkill, hasFiles = false } = options;
  const query = useMemo(() => matchAtQuery(input), [input]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<AtSelectorTab>('skills');

  // Whether the files tab should be available
  const showFilesTab = hasFiles || files.length > 0;

  // Reset state when query changes
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

  const filteredFiles = useMemo(() => {
    if (query === null || files.length === 0) {
      return [];
    }
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return files;
    }
    return files.filter((file) => {
      const nameMatch = file.name.toLowerCase().includes(keyword);
      const pathMatch = file.relativePath.toLowerCase().includes(keyword);
      return nameMatch || pathMatch;
    });
  }, [files, query]);

  // Items for the currently active tab
  const currentItemCount = activeTab === 'skills' ? filteredSkills.length : filteredFiles.length;

  const isOpen = query !== null && !dismissed && (filteredSkills.length > 0 || filteredFiles.length > 0 || showFilesTab);

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
      const newInput = replaceAtQuery(input, file.relativePath);
      onSelectFile?.(file, newInput);
      setDismissed(true);
      return true;
    },
    [filteredFiles, input, onSelectFile]
  );

  const executeByIndex = useCallback(
    (index: number) => {
      if (activeTab === 'skills') {
        return executeSkill(index);
      }
      return executeFile(index);
    },
    [activeTab, executeSkill, executeFile]
  );

  const switchTab = useCallback((tab: AtSelectorTab) => {
    setActiveTab(tab);
    setActiveIndex(0);
  }, []);

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
      if (event.key === 'Tab' && showFilesTab) {
        event.preventDefault();
        const nextTab = activeTab === 'skills' ? 'files' : 'skills';
        switchTab(nextTab);
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
        return executeByIndex(activeIndex);
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
    [activeIndex, activeTab, currentItemCount, executeByIndex, isOpen, onRemoveSkill, query, selectedSkills, showFilesTab, switchTab]
  );

  return {
    isOpen,
    activeIndex,
    activeTab,
    filteredSkills,
    filteredFiles,
    showFilesTab,
    onKeyDown,
    onSelectByIndex: executeByIndex,
    setDismissed,
    setActiveIndex,
    setActiveTab: switchTab,
  };
}
