/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { WorkspaceFileItem } from '@/renderer/hooks/useWorkspaceFiles';

// Match @ at the beginning of input or after whitespace, followed by query chars until end
// 匹配输入开头或空白字符后的 @，后跟查询字符直到结尾
const SKILL_QUERY_RE = /(?:^|\s)@([^\s@]*)$/;

/**
 * Extract the @ query from the input string (supports mid-input @)
 * 从输入中提取 @ 查询（支持输入中间位置的 @）
 */
export function matchSkillQuery(input: string): string | null {
  const match = input.match(SKILL_QUERY_RE);
  return match ? match[1] : null;
}

/**
 * Strip the @ query portion from the input, keeping everything before it
 * 移除输入中的 @ 查询部分，保留前面的内容
 */
export function stripAtQuery(input: string): string {
  return input.replace(SKILL_QUERY_RE, (m) => {
    // Preserve the leading whitespace if the match starts with a space
    return m.startsWith(' ') || m.startsWith('\t') || m.startsWith('\n') ? m[0] : '';
  });
}

/**
 * Replace the @ query portion with a new value
 * 将 @ 查询部分替换为新值
 */
export function replaceAtQuery(input: string, replacement: string): string {
  return input.replace(SKILL_QUERY_RE, (m) => {
    const prefix = m.startsWith(' ') || m.startsWith('\t') || m.startsWith('\n') ? m[0] : '';
    return `${prefix}${replacement} `;
  });
}

export type SkillSelectorItem = {
  name: string;
  displayName: string;
  description?: string;
  icon?: string;
  emoji?: string;
  enabled?: boolean;
};

export type ActiveTab = 'skills' | 'files';

type UseSkillSelectorControllerOptions = {
  input: string;
  skills: SkillSelectorItem[];
  selectedSkills: string[];
  onSelectSkill: (skillName: string) => void;
  onRemoveSkill?: (skillName: string) => void;
  workspaceFiles?: WorkspaceFileItem[];
  onSelectFile?: (file: WorkspaceFileItem) => void;
};

export function useSkillSelectorController(options: UseSkillSelectorControllerOptions) {
  const { input, skills, selectedSkills, onSelectSkill, onRemoveSkill, workspaceFiles = [], onSelectFile } = options;
  const query = useMemo(() => matchSkillQuery(input), [input]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('skills');
  const prevQueryRef = useRef<string | null>(null);

  // Whether to show file tab (always show when workspace files are available)
  const showTabs = workspaceFiles.length > 0;

  // Reset state when query changes
  useEffect(() => {
    if (query !== prevQueryRef.current) {
      prevQueryRef.current = query;
      setActiveIndex(0);
      setDismissed(false);
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
      const nameMatch = file.name.toLowerCase().includes(keyword);
      const pathMatch = file.relativePath.toLowerCase().includes(keyword);
      return nameMatch || pathMatch;
    });
  }, [workspaceFiles, query]);

  // Current tab items for navigation
  const currentItems = activeTab === 'skills' ? filteredSkills : filteredFiles;

  // Determine if the dropdown should be open
  // Show when we have a query AND (there are items in any tab OR we have tabs to show)
  const hasAnyContent = filteredSkills.length > 0 || filteredFiles.length > 0;
  const isOpen = query !== null && !dismissed && (hasAnyContent || showTabs);

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

      // Tab key switches between tabs
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
        if (activeTab === 'skills') {
          return executeSkill(activeIndex);
        }
        return executeFile(activeIndex);
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
    [activeIndex, activeTab, currentItems.length, executeFile, executeSkill, isOpen, onRemoveSkill, query, selectedSkills, showTabs]
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
    onSelectFileByIndex: executeFile,
    setDismissed,
    setActiveIndex,
    setActiveTab,
  };
}
