import classNames from 'classnames';
import React, { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AtMentionTab } from '@/renderer/hooks/useSkillSelectorController';
import type { WorkspaceFileItem } from '@/renderer/hooks/useWorkspaceFiles';
import { handleSkillIconError } from '@/renderer/utils/skillDisplay';
import { resolveFileIcon } from '@/renderer/utils/fileIcon';
import SkillSelectorSkeleton from './base/SkillSelectorSkeleton';

export interface SkillSelectorMenuItem {
  key: string;
  name: string;
  displayName: string;
  description?: string;
  icon?: string;
  emoji?: string;
  enabled?: boolean;
}

interface SkillSelectorMenuProps {
  title: string;
  hint?: string;
  items: SkillSelectorMenuItem[];
  selectedKeys: string[];
  activeIndex: number;
  loading?: boolean;
  loadingText?: string;
  onHoverItem: (index: number) => void;
  onSelectItem: (item: SkillSelectorMenuItem) => void;
  emptyText: string;
  /** Whether to show tabs (skills/files) */
  showTabs?: boolean;
  /** Current active tab */
  activeTab?: AtMentionTab;
  /** Callback when tab changes */
  onTabChange?: (tab: AtMentionTab) => void;
  /** File items for the files tab */
  fileItems?: WorkspaceFileItem[];
  /** Callback when a file item is selected */
  onSelectFile?: (file: WorkspaceFileItem) => void;
  /** Text for files tab title */
  filesTabTitle?: string;
  /** Text for skills tab title */
  skillsTabTitle?: string;
  /** Empty text for files tab */
  filesEmptyText?: string;
  /** Search query for filtering */
  searchQuery?: string;
  /** Callback when search query changes */
  onSearchChange?: (query: string) => void;
  /** Callback to dismiss/close the menu */
  onDismiss?: () => void;
  /** Placeholder text for skills search */
  skillsSearchPlaceholder?: string;
  /** Placeholder text for files search */
  filesSearchPlaceholder?: string;
  /** Text shown when search has no results */
  noSearchResultsText?: string;
}

const SkillSelectorMenu: React.FC<SkillSelectorMenuProps> = ({
  title,
  hint,
  items,
  selectedKeys,
  activeIndex,
  loading = false,
  loadingText,
  onHoverItem,
  onSelectItem,
  emptyText,
  showTabs = false,
  activeTab = 'skills',
  onTabChange,
  fileItems = [],
  onSelectFile,
  filesTabTitle = 'Files',
  skillsTabTitle = 'Skills',
  filesEmptyText = 'No files',
  searchQuery = '',
  onSearchChange,
  onDismiss,
  skillsSearchPlaceholder,
  filesSearchPlaceholder,
  noSearchResultsText,
}) => {
  const { t } = useTranslation();
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  // Use i18n for default text values
  const resolvedSkillsSearchPlaceholder = skillsSearchPlaceholder || t('messages.skills.searchSkills', '搜索技能...');
  const resolvedFilesSearchPlaceholder = filesSearchPlaceholder || t('messages.skills.searchFiles', '搜索文件...');
  const resolvedNoSearchResultsText = noSearchResultsText || t('messages.skills.noSearchResults', '未找到匹配结果');

  // Close menu when clicking outside
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismissRef.current?.();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  // Use i18n loading text if not provided
  const resolvedLoadingText = loadingText || t('common.loadingSkills');

  useEffect(() => {
    const current = itemRefs.current[activeIndex];
    if (current) {
      current.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, items.length, fileItems.length, activeTab]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const currentItems = activeTab === 'skills' ? items : fileItems;
      const itemCount = currentItems?.length ?? 0;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onHoverItem(Math.min(activeIndex + 1, itemCount - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        onHoverItem(Math.max(activeIndex - 1, 0));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (activeTab === 'skills' && items[activeIndex]) {
          onSelectItem(items[activeIndex]);
        } else if (activeTab === 'files' && fileItems?.[activeIndex]) {
          onSelectFile?.(fileItems[activeIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (searchQuery) {
          onSearchChange?.('');
        } else {
          onDismiss?.();
        }
      } else if (e.key === 'Tab' && showTabs && onTabChange) {
        e.preventDefault();
        onTabChange(activeTab === 'skills' ? 'files' : 'skills');
      }
    },
    [activeTab, items, fileItems, activeIndex, onHoverItem, onSelectItem, onSelectFile, onDismiss, onSearchChange, searchQuery, showTabs, onTabChange]
  );

  return (
    <div
      ref={menuRef}
      className='rounded-14px border shadow-[0_8px_24px_rgba(0,0,0,0.12)] overflow-hidden'
      style={{
        borderColor: 'var(--color-border-2)',
        background: 'color-mix(in srgb, var(--color-bg-1) 78%, transparent)',
        backdropFilter: 'blur(14px) saturate(1.1)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.1)',
        maxWidth: 'min(380px, calc(100vw - 64px))',
        width: 'max-content',
        minWidth: '240px',
      }}
    >
      {/* Header with optional tabs */}
      <div
        className='px-3 py-2 border-b flex items-center justify-between gap-2'
        style={{
          borderColor: 'color-mix(in srgb, var(--color-border-2) 56%, transparent)',
          background: 'color-mix(in srgb, var(--color-bg-1) 84%, transparent)',
        }}
      >
        {showTabs ? (
          <div className='flex items-center gap-0.5'>
            <button
              type='button'
              className={classNames('px-2.5 py-1 rounded-8px text-13px font-medium cursor-pointer border-none outline-none transition-colors', {
                'bg-primary text-white': activeTab === 'skills',
                'bg-transparent text-secondary hover:text-foreground hover:bg-fill-2': activeTab !== 'skills',
              })}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onTabChange?.('skills')}
            >
              {skillsTabTitle}
            </button>
            <button
              type='button'
              className={classNames('px-2.5 py-1 rounded-8px text-13px font-medium cursor-pointer border-none outline-none transition-colors', {
                'bg-primary text-white': activeTab === 'files',
                'bg-transparent text-secondary hover:text-foreground hover:bg-fill-2': activeTab !== 'files',
              })}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onTabChange?.('files')}
            >
              {filesTabTitle}
            </button>
          </div>
        ) : (
          <div className='text-13px font-semibold text-foreground'>{title}</div>
        )}
        {hint && !showTabs && <div className='text-13px text-secondary truncate'>{hint}</div>}
        {showTabs && <div className='text-11px text-secondary truncate'>{t('messages.skills.tabToSwitch', 'Tab 切换')}</div>}
      </div>

      {/* Search box */}
      {onSearchChange && (
        <div
          className='px-2 py-1.5 border-b'
          style={{
            borderColor: 'color-mix(in srgb, var(--color-border-2) 56%, transparent)',
          }}
        >
          <div
            className='flex items-center gap-1.5 px-2 py-1 rounded-8px'
            style={{
              background: 'color-mix(in srgb, var(--color-fill-2) 60%, transparent)',
            }}
          >
            <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' className='shrink-0 text-tertiary'>
              <circle cx='11' cy='11' r='8' />
              <path d='m21 21-4.35-4.35' />
            </svg>
            <input
              type='text'
              className='flex-1 min-w-0 text-13px bg-transparent border-none outline-none text-foreground placeholder:text-tertiary'
              style={{ caretColor: 'var(--color-primary)' }}
              placeholder={activeTab === 'skills' ? resolvedSkillsSearchPlaceholder : resolvedFilesSearchPlaceholder}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            {searchQuery && (
              <button type='button' className='shrink-0 size-4 f-center rounded-full text-tertiary hover:text-secondary cursor-pointer border-none outline-none text-11px bg-transparent' onMouseDown={(e) => e.preventDefault()} onClick={() => onSearchChange('')}>
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content area */}
      <div role='listbox' aria-busy={loading} className='overflow-y-auto p-1.5' style={{ maxHeight: 'min(34vh, 260px)' }}>
        {/* Skills tab content */}
        {activeTab === 'skills' && (
          <>
            {loading && items.length === 0 && <SkillSelectorSkeleton count={4} />}
            {loading && items.length > 0 && <div className='px-2.5 py-3 text-13px text-secondary'>{resolvedLoadingText}</div>}
            {!loading && items.length === 0 && <div className='px-2.5 py-3 text-13px text-secondary'>{searchQuery ? resolvedNoSearchResultsText : emptyText}</div>}
            {!loading &&
              items.map((item, index) => {
                const isSelected = selectedKeys.includes(item.key);
                return (
                  <button
                    key={item.key}
                    type='button'
                    role='option'
                    aria-selected={isSelected}
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    className={classNames('w-full text-left px-2.5 py-1.5 rounded-8px transition-all border outline-none cursor-pointer mb-0.5 last:mb-0', {
                      'border-light': index === activeIndex,
                      'border-transparent hover:bg-fill-1': index !== activeIndex,
                    })}
                    style={{
                      minHeight: '42px',
                      background: index === activeIndex ? 'color-mix(in srgb, var(--aou-2) 88%, transparent)' : isSelected ? 'color-mix(in srgb, var(--color-primary-light-1) 50%, transparent)' : 'transparent',
                      boxShadow: undefined,
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => onHoverItem(index)}
                    onClick={() => onSelectItem(item)}
                  >
                    <div className='flex items-center gap-2'>
                      {/* Icon / Emoji */}
                      <div className='size-7 flex-shrink-0 rd-6px overflow-hidden bg-fill-2 f-center text-16px'>{item.icon ? <img src={item.icon} alt={item.displayName} className='w-full h-full object-cover' onError={handleSkillIconError} /> : <span>{item.emoji || '⚡'}</span>}</div>
                      {/* Content */}
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-1.5 min-w-0'>
                          <span className={classNames('text-14px truncate', index === activeIndex ? 'text-foreground font-semibold' : 'text-foreground font-medium')}>{item.displayName}</span>
                          {isSelected && <span className='px-1 py-0 bg-primary text-white text-9px rd-3px whitespace-nowrap flex-shrink-0 leading-14px'>{t('messages.skills.added', '已添加')}</span>}
                        </div>
                        {item.description && <div className='text-11px text-secondary truncate mt-px'>{item.description}</div>}
                      </div>
                    </div>
                  </button>
                );
              })}
          </>
        )}

        {/* Files tab content */}
        {activeTab === 'files' && (
          <>
            {fileItems.length === 0 && <div className='px-2.5 py-3 text-13px text-secondary'>{searchQuery ? resolvedNoSearchResultsText : filesEmptyText}</div>}
            {fileItems.map((file, index) => (
              <button
                key={file.relativePath}
                type='button'
                role='option'
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                className={classNames('w-full text-left px-2.5 py-1.5 rounded-8px transition-all border outline-none cursor-pointer mb-0.5 last:mb-0', {
                  'border-light': index === activeIndex,
                  'border-transparent hover:bg-fill-1': index !== activeIndex,
                })}
                style={{
                  minHeight: '38px',
                  background: index === activeIndex ? 'color-mix(in srgb, var(--aou-2) 88%, transparent)' : 'transparent',
                }}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => onHoverItem(index)}
                onClick={() => onSelectFile?.(file)}
              >
                <div className='flex items-center gap-2'>
                  <div className='size-6 flex-shrink-0 rd-4px bg-fill-2 f-center overflow-hidden'>{resolveFileIcon(file.name, { size: 16, theme: 'filled' })}</div>
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-1.5 min-w-0'>
                      <span className={classNames('text-13px truncate', index === activeIndex ? 'text-foreground font-semibold' : 'text-foreground font-medium')}>{file.name}</span>
                      {file.isDraft && (
                        <span className='px-1 py-0 text-9px rd-3px whitespace-nowrap flex-shrink-0 leading-14px' style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                          {t('conversation.workspace.drafts.badge', { defaultValue: '草稿' })}
                        </span>
                      )}
                    </div>
                    <div className='text-11px text-secondary truncate mt-px'>{file.relativePath}</div>
                  </div>
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default SkillSelectorMenu;
