/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

// Match @ followed by query text at any position in input
// Captures trailing @query at end of input (after start-of-string or whitespace)
const SKILL_QUERY_RE = /(?:^|\s)@([^\s@]*)$/;

/**
 * Extract the @query portion from the end of the input string.
 * Returns the query string (without @) or null if no match.
 */
export function matchSkillQuery(input: string): string | null {
  const match = input.match(SKILL_QUERY_RE);
  return match ? match[1] : null;
}

/**
 * Strip the trailing @query portion from the input string.
 * Returns the input with the @query removed (preserving preceding text).
 */
export function stripAtQuery(input: string): string {
  return input.replace(/(?:^|\s)@[^\s@]*$/, (m) => {
    // Keep the leading whitespace if it was part of the match
    const trimmed = m.trimStart();
    return m.slice(0, m.length - trimmed.length);
  });
}

/**
 * Replace the trailing @query portion with a new value.
 */
export function replaceAtQuery(input: string, replacement: string): string {
  const stripped = stripAtQuery(input);
  const needsSpace = stripped.length > 0 && !stripped.endsWith(' ');
  return stripped + (needsSpace ? ' ' : '') + replacement + ' ';
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

export interface FileItem {
  /** Relative path within workspace */
  relativePath: string;
  /** File name */
  name: string;
  /** Whether it's a directory */
  isDir: boolean;
}

interface UseSkillSelectorControllerOptions {
  input: string;
  skills: SkillSelectorItem[];
  selectedSkills: string[];
  onSelectSkill: (skillName: string) => void;
  onRemoveSkill?: (skillName: string) => void;
  /** Workspace files for the files tab */
  files?: FileItem[];
  /** Callback when a file is selected */
  onSelectFile?: (relativePath: string) => void;
}

export function useSkillSelectorController(options: UseSkillSelectorControllerOptions) {
  const { input, skills, selectedSkills, onSelectSkill, onRemoveSkill, files = [], onSelectFile } = options;
  const query = useMemo(() => matchSkillQuery(input), [input]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<AtMentionTab>('skills');

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

  const filteredFiles = useMemo(() => {
    if (query === null) {
      return [];
    }
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return files;
    }
    return files.filter((file) => {
      return file.name.toLowerCase().includes(keyword) || file.relativePath.toLowerCase().includes(keyword);
    });
  }, [files, query]);

  // Determine which items are active based on current tab
  const activeItems = activeTab === 'skills' ? filteredSkills : filteredFiles;

  const hasSkills = filteredSkills.length > 0 || (query !== null && skills.length > 0);
  const hasFiles = files.length > 0;
  const isOpen = query !== null && !dismissed && (filteredSkills.length > 0 || filteredFiles.length > 0 || hasFiles);

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
      onSelectFile?.(file.relativePath);
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

      // Tab key to switch between tabs
      if (event.key === 'Tab') {
        event.preventDefault();
        setActiveTab((prev) => (prev === 'skills' ? 'files' : 'skills'));
        setActiveIndex(0);
        return true;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % Math.max(activeItems.length, 1));
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) => (prev - 1 + Math.max(activeItems.length, 1)) % Math.max(activeItems.length, 1));
        return true;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (activeTab === 'skills') {
          return executeSkill(activeIndex);
        } else {
          return executeFile(activeIndex);
        }
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
    [activeIndex, activeItems.length, activeTab, executeSkill, executeFile, isOpen, query, selectedSkills, onRemoveSkill]
  );

  return {
    isOpen,
    activeIndex,
    activeTab,
    setActiveTab,
    filteredSkills,
    filteredFiles,
    hasFiles,
    hasSkills,
    onKeyDown,
    onSelectByIndex: executeSkill,
    onSelectFileByIndex: executeFile,
    setDismissed,
    setActiveIndex,
    query,
  };
}
