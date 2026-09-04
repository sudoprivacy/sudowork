/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Input, Popover } from '@arco-design/web-react';
import type { RefInputType } from '@arco-design/web-react/es/Input/interface';
import { IconSearch } from '@arco-design/web-react/icon';
import { useDebounce } from 'ahooks';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AtMentionTab, SkillSelectorItem } from '@renderer/pages/guid/hooks/useSkillSelectorController';
import type { WorkspaceFileItem } from '@renderer/hooks/useWorkspaceFiles';
import { handleSkillIconError } from '@renderer/utils/skillDisplay';
import { resolveFileIcon } from '@renderer/utils/fileIcon';
import Tabs from '@renderer/components/ui/Tabs';
import SkillSelectorSkeleton from './SkillSelectorSkeleton';

function SkillSelectorMenuContent({ skills, selectedKeys, loading = false, onSelectItem, workspaceFiles, onSelectFile, onDismiss, popupVisible = false }: Omit<ISkillSelectorPopoverProps, 'onVisibleChange' | 'onAfterClose' | 'children'>) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<AtMentionTab>('skills');
  const [searchQuery, setSearchQuery] = useState('');

  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchInputRef = useRef<RefInputType | null>(null);

  const { t } = useTranslation();

  const debouncedSearch = useDebounce(searchQuery, { wait: 150 });

  const showTabs = workspaceFiles != null;

  const filteredSkills = useMemo(() => {
    const result = skills.filter((s) => s.enabled !== false);
    const keyword = debouncedSearch.trim().toLowerCase();
    if (!keyword) return result;
    return result.filter((s) => {
      const raw = debouncedSearch.trim();
      return s.name.toLowerCase().includes(keyword) || s.displayName.toLowerCase().includes(keyword) || (s.description?.toLowerCase().includes(keyword) ?? false) || s.displayName.includes(raw);
    });
  }, [skills, debouncedSearch]);

  const filteredFiles = useMemo(() => {
    if (!workspaceFiles) return [];
    const keyword = debouncedSearch.trim().toLowerCase();
    if (!keyword) return workspaceFiles;
    return workspaceFiles.filter((f) => f.name.toLowerCase().includes(keyword) || f.relativePath.toLowerCase().includes(keyword));
  }, [workspaceFiles, debouncedSearch]);

  const currentItems = activeTab === 'skills' ? filteredSkills : filteredFiles;

  // Reset search and tab when menu opens, and auto-focus search input
  useEffect(() => {
    if (popupVisible) {
      setSearchQuery('');
      setActiveTab('skills');
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [popupVisible]);

  // Reset active index when list or tab changes
  useEffect(() => {
    itemRefs.current = [];
    setActiveIndex(0);
  }, [activeTab, debouncedSearch, currentItems.length]);

  // Scroll active item into view
  useEffect(() => {
    if (currentItems.length === 0) return;
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, currentItems.length]);

  // Global capture-phase keydown
  useEffect(() => {
    if (!popupVisible) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (currentItems.length === 0 ? 0 : Math.min(prev + 1, currentItems.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Tab' && showTabs) {
        e.preventDefault();
        setActiveTab((prev) => (prev === 'skills' ? 'files' : 'skills'));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (activeTab === 'skills' && filteredSkills[activeIndex]) {
          onSelectItem(filteredSkills[activeIndex]);
        } else if (activeTab === 'files' && filteredFiles[activeIndex]) {
          onSelectFile?.(filteredFiles[activeIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (searchQuery) {
          setSearchQuery('');
        } else {
          onDismiss?.();
        }
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [popupVisible, activeTab, filteredSkills, filteredFiles, activeIndex, showTabs, onSelectItem, onSelectFile, onDismiss, searchQuery, currentItems.length]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape' && searchQuery) {
        e.stopPropagation();
      }
    },
    [searchQuery]
  );

  return (
    <div className='w-72'>
      {/* Header */}
      <div className='flex items-center justify-between gap-2 px-2'>
        {showTabs ? (
          <Tabs
            variant='line'
            className='gap-0.5'
            value={activeTab}
            items={[
              { value: 'skills', label: t('messages.skills.tabSkills', 'Skills') },
              { value: 'files', label: t('messages.skills.tabFiles', 'Files') },
            ]}
            onChange={(v) => setActiveTab(v as AtMentionTab)}
            onMouseDown={(e) => e.preventDefault()}
          />
        ) : (
          <div className='text-13px font-semibold text-foreground'>{t('messages.skills.title', 'Skills')}</div>
        )}
        {showTabs && <div className='text-11px text-secondary truncate'>{t('messages.skills.tabToSwitch', 'Tab 切换')}</div>}
      </div>

      {/* Search box */}
      <Input
        ref={searchInputRef}
        className='my-3'
        size='small'
        prefix={<IconSearch />}
        allowClear
        placeholder={activeTab === 'skills' ? t('messages.skills.searchSkills', '搜索技能...') : t('messages.skills.searchFiles', '搜索文件...')}
        value={searchQuery}
        onChange={setSearchQuery}
        onKeyDown={handleSearchKeyDown}
      />

      {/* Content area */}
      <div role='listbox' aria-busy={loading} className='overflow-y-auto h-260px'>
        {activeTab === 'skills' && (
          <>
            {loading && filteredSkills.length === 0 && <SkillSelectorSkeleton count={4} />}
            {loading && filteredSkills.length > 0 && <div className='px-2.5 py-3 text-13px text-secondary'>{t('common.loadingSkills')}</div>}
            {!loading && filteredSkills.length === 0 && <div className='px-2.5 py-3 text-13px text-secondary'>{searchQuery ? t('messages.skills.noSearchResults', '未找到匹配结果') : t('messages.skills.empty', 'No skills found')}</div>}
            {!loading &&
              filteredSkills.map((skill, index) => {
                const isSelected = selectedKeys.includes(skill.name);
                return (
                  <button
                    key={skill.name}
                    type='button'
                    role='option'
                    aria-selected={isSelected}
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    className={classNames('w-full bg-transparent text-left p-2.5 rounded-xl transition-all cursor-pointer', {
                      'bg-fill-2': index === activeIndex,
                    })}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => onSelectItem(skill)}
                  >
                    <div className='flex items-center gap-2'>
                      <div className='size-8 flex-shrink-0 rd-6px f-center text-16px'>{skill.icon ? <img src={skill.icon} alt={skill.displayName} className='w-full h-full object-cover' onError={handleSkillIconError} /> : <span>{skill.emoji || '⚡'}</span>}</div>
                      <div className='min-w-0 flex-1 space-y-1'>
                        <div className='flex items-center gap-1.5 min-w-0'>
                          <span className={classNames('text-14px truncate text-foreground font-medium')}>{skill.displayName}</span>
                          {isSelected && <span className='bg-primary text-white text-10px px-2 font-medium py-1 rd-full'>{t('messages.skills.added', '已添加')}</span>}
                        </div>
                        {skill.description && <div className='text-11px text-secondary truncate mt-px'>{skill.description}</div>}
                      </div>
                    </div>
                  </button>
                );
              })}
          </>
        )}

        {/* Files tab */}
        {activeTab === 'files' && (
          <>
            {filteredFiles.length === 0 && <div className='px-2.5 py-3 text-13px text-secondary'>{searchQuery ? t('messages.skills.noSearchResults', '未找到匹配结果') : t('messages.skills.filesEmpty', 'No files in workspace')}</div>}
            {filteredFiles.map((file, index) => (
              <button
                key={file.relativePath}
                type='button'
                role='option'
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                className={classNames('w-full bg-transparent text-left p-2.5 rounded-xl transition-all cursor-pointer', {
                  'bg-fill-2': index === activeIndex,
                })}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => onSelectFile?.(file)}
              >
                <div className='flex items-center gap-2'>
                  <div className='size-6 flex-shrink-0 rd-4px bg-fill-2 f-center overflow-hidden'>{resolveFileIcon(file.name, { size: 16, theme: 'filled' })}</div>
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-1.5 min-w-0'>
                      <span className={classNames('text-13px truncate text-foreground font-medium')}>{file.name}</span>
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

export default function SkillSelectorPopover({ popupVisible, onVisibleChange, onAfterClose, children, ...contentProps }: ISkillSelectorPopoverProps) {
  const prevVisibleRef = useRef(false);

  useEffect(() => {
    if (!popupVisible && prevVisibleRef.current) {
      onAfterClose?.();
    }
    prevVisibleRef.current = popupVisible;
  }, [popupVisible, onAfterClose]);

  return (
    <Popover popupVisible={popupVisible} trigger={[]} position='top' onVisibleChange={onVisibleChange} content={<SkillSelectorMenuContent {...contentProps} popupVisible={popupVisible} />} className='[&_.arco-popover-content]:!py-1 [&_.arco-popover-content]:!px-3'>
      {children}
    </Popover>
  );
}

interface ISkillSelectorPopoverProps {
  skills: SkillSelectorItem[];
  selectedKeys: string[];
  loading?: boolean;
  onSelectItem: (skill: SkillSelectorItem) => void;
  workspaceFiles?: WorkspaceFileItem[];
  onSelectFile?: (file: WorkspaceFileItem) => void;
  onDismiss?: () => void;
  popupVisible: boolean;
  onVisibleChange?: (visible: boolean) => void;
  /** Called when the popover closes — use to restore focus to the external input */
  onAfterClose?: () => void;
  children: React.ReactNode;
}
