import { Input, Popover } from '@arco-design/web-react';
import { IconSearch } from '@arco-design/web-react/icon';
import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AtMentionTab } from '@/renderer/hooks/useSkillSelectorController';
import type { WorkspaceFileItem } from '@/renderer/hooks/useWorkspaceFiles';
import { handleSkillIconError } from '@/renderer/utils/skillDisplay';
import { resolveFileIcon } from '@/renderer/utils/fileIcon';
import SkillSelectorSkeleton from './base/SkillSelectorSkeleton';
import Tabs from './ui/Tabs';

export function SkillSelectorMenuContent({
  title,
  items,
  selectedKeys,
  loading = false,
  loadingText,
  onSelectItem,
  emptyText,
  showTabs = false,
  activeTab: activeTabProp,
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
  isVisible = false,
}: ISkillSelectorMenuContentProps) {
  const { t } = useTranslation();
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [internalActiveTab, setInternalActiveTab] = useState<AtMentionTab>('skills');
  const activeTab = activeTabProp ?? internalActiveTab;

  const handleTabChange = useCallback(
    (tab: AtMentionTab) => {
      if (activeTabProp === undefined) {
        setInternalActiveTab(tab);
      }
      onTabChange?.(tab);
    },
    [activeTabProp, onTabChange]
  );

  const resolvedSkillsSearchPlaceholder = skillsSearchPlaceholder || t('messages.skills.searchSkills', '搜索技能...');
  const resolvedFilesSearchPlaceholder = filesSearchPlaceholder || t('messages.skills.searchFiles', '搜索文件...');
  const resolvedNoSearchResultsText = noSearchResultsText || t('messages.skills.noSearchResults', '未找到匹配结果');
  const resolvedLoadingText = loadingText || t('common.loadingSkills');

  // Reset active index when item list or active tab changes
  useEffect(() => {
    setActiveIndex(0);
  }, [items.length, fileItems.length, activeTab]);

  // Scroll active item into view
  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Global capture-phase keydown — intercepts before the textarea when visible
  useEffect(() => {
    if (!isVisible) return;

    const handler = (e: KeyboardEvent) => {
      const currentItems = activeTab === 'skills' ? items : fileItems;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, currentItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Tab' && showTabs) {
        e.preventDefault();
        handleTabChange(activeTab === 'skills' ? 'files' : 'skills');
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (activeTab === 'skills' && items[activeIndex]) {
          onSelectItem(items[activeIndex]);
        } else if (activeTab === 'files' && fileItems[activeIndex]) {
          onSelectFile?.(fileItems[activeIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (searchQuery) {
          onSearchChange?.('');
        } else {
          onDismiss?.();
        }
      }
    };

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [isVisible, activeTab, items, fileItems, activeIndex, showTabs, handleTabChange, onSelectItem, onSelectFile, onDismiss, onSearchChange, searchQuery]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Navigation is handled by the global listener; only intercept Escape to clear search
      if (e.key === 'Escape' && searchQuery) {
        e.stopPropagation();
      }
    },
    [searchQuery]
  );

  return (
    <div className='w-72'>
      {/* Header with optional tabs */}
      <div className='flex items-center justify-between gap-2 px-2'>
        {showTabs ? (
          <Tabs
            variant='line'
            className='gap-0.5'
            value={activeTab}
            items={[
              { value: 'skills', label: skillsTabTitle },
              { value: 'files', label: filesTabTitle },
            ]}
            onChange={(v) => handleTabChange(v as AtMentionTab)}
            onMouseDown={(e) => e.preventDefault()}
          />
        ) : (
          <div className='text-13px font-semibold text-foreground'>{title}</div>
        )}
        {showTabs && <div className='text-11px text-secondary truncate'>{t('messages.skills.tabToSwitch', 'Tab 切换')}</div>}
      </div>

      {/* Search box */}
      {onSearchChange && <Input className='my-3' size='small' prefix={<IconSearch />} allowClear placeholder={activeTab === 'skills' ? resolvedSkillsSearchPlaceholder : resolvedFilesSearchPlaceholder} value={searchQuery} onChange={onSearchChange} onKeyDown={handleSearchKeyDown} />}

      {/* Content area */}
      <div role='listbox' aria-busy={loading} className='overflow-y-auto h-260px'>
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
                    className={classNames('w-full bg-transparent text-left p-2.5 rounded-xl transition-all cursor-pointer hover:bg-subtle')}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => onSelectItem(item)}
                  >
                    <div className='flex items-center gap-2'>
                      <div className='size-8 flex-shrink-0 rd-6px f-center text-16px'>{item.icon ? <img src={item.icon} alt={item.displayName} className='w-full h-full object-cover' onError={handleSkillIconError} /> : <span>{item.emoji || '⚡'}</span>}</div>
                      <div className='min-w-0 flex-1 space-y-1'>
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
                className={classNames('w-full bg-transparent text-left p-2.5 rounded-xl transition-all cursor-pointer hover:bg-subtle')}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
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
}

export default function SkillSelectorPopover({ popupVisible, onVisibleChange, children, ...contentProps }: ISkillSelectorPopoverProps) {
  return (
    <Popover popupVisible={popupVisible} trigger={[]} position='top' onVisibleChange={onVisibleChange} content={<SkillSelectorMenuContent {...contentProps} isVisible={popupVisible} />} className='[&_.arco-popover-content]:!py-1 [&_.arco-popover-content]:!px-3'>
      {children}
    </Popover>
  );
}

interface ISkillSelectorPopoverProps extends ISkillSelectorMenuContentProps {
  /** Controls popover visibility */
  popupVisible: boolean;
  /** Callback when visibility changes (e.g. click outside) */
  onVisibleChange?: (visible: boolean) => void;
  /** Trigger element */
  children: React.ReactNode;
}

export interface SkillSelectorMenuItem {
  key: string;
  name: string;
  displayName: string;
  description?: string;
  icon?: string;
  emoji?: string;
  enabled?: boolean;
}

interface ISkillSelectorMenuContentProps {
  title: string;
  hint?: string;
  items: SkillSelectorMenuItem[];
  selectedKeys: string[];
  loading?: boolean;
  loadingText?: string;
  onSelectItem: (item: SkillSelectorMenuItem) => void;
  emptyText: string;
  showTabs?: boolean;
  activeTab?: AtMentionTab;
  onTabChange?: (tab: AtMentionTab) => void;
  fileItems?: WorkspaceFileItem[];
  onSelectFile?: (file: WorkspaceFileItem) => void;
  filesTabTitle?: string;
  skillsTabTitle?: string;
  filesEmptyText?: string;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  onDismiss?: () => void;
  skillsSearchPlaceholder?: string;
  filesSearchPlaceholder?: string;
  noSearchResultsText?: string;
  /** Whether the menu is currently visible — activates keyboard listener */
  isVisible?: boolean;
}
