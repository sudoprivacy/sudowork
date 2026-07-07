import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { WorkspaceFileItem } from './useWorkspaceFiles';

// Match @ followed by query text, ending at the current cursor position
// Matches @ at start of input or after whitespace
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
  const { input, cursorPosition, skills, selectedSkills, onRemoveSkill, workspaceFiles = [], filterDisabled = false } = options;
  const query = useMemo(() => matchSkillQuery(input, cursorPosition), [input, cursorPosition]);
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
  const showTabs = workspaceFiles != null;

  // Reset state when debounced query changes
  useEffect(() => {
    if (debouncedQuery !== prevQueryRef.current) {
      setDismissed(false);
      setSearchQuery('');
      prevQueryRef.current = debouncedQuery;
    }
  }, [debouncedQuery]);

  const filteredSkills = useMemo(() => {
    if (debouncedQuery === null) {
      return [];
    }
    const rawKeyword = debouncedSearchQuery.trim() || debouncedQuery.trim();
    const keyword = rawKeyword.toLowerCase();

    let result = skills;
    if (filterDisabled) {
      result = skills.filter((skill) => skill.enabled !== false);
    }

    if (!keyword) {
      return result;
    }

    return result.filter((skill) => {
      const nameMatch = skill.name.toLowerCase().includes(keyword);
      const displayNameMatch = skill.displayName.toLowerCase().includes(keyword);
      const descriptionMatch = skill.description?.toLowerCase().includes(keyword) ?? false;
      const chineseMatch = rawKeyword ? skill.displayName.includes(rawKeyword) : false;
      return nameMatch || displayNameMatch || descriptionMatch || chineseMatch;
    });
  }, [skills, debouncedQuery, debouncedSearchQuery, filterDisabled]);

  const filteredFiles = useMemo(() => {
    if (debouncedQuery === null) {
      return [];
    }
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

  // Menu is open when query is detected and not dismissed, and either tab has content or tabs are shown
  const hasAnyContent = filteredSkills.length > 0 || filteredFiles.length > 0;
  const isOpen = query !== null && !dismissed && (hasAnyContent || showTabs);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!isOpen) return false;

      // Backspace with empty query removes the last selected skill
      if (event.key === 'Backspace' && debouncedQuery === '') {
        if (selectedSkills.length > 0) {
          onRemoveSkill?.(selectedSkills[selectedSkills.length - 1]);
          return true;
        }
      }

      return false;
    },
    [isOpen, debouncedQuery, selectedSkills, onRemoveSkill]
  );

  return {
    isOpen,
    filteredSkills,
    filteredFiles,
    activeTab,
    showTabs,
    setActiveTab: (tab: AtMentionTab) => {
      setActiveTab(tab);
      setSearchQuery('');
    },
    searchQuery,
    setSearchQuery,
    onKeyDown,
    setDismissed,
  };
}
