/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SkillSelectorMenuItem } from '@/renderer/components/SkillSelectorMenu';
import type { WorkspaceFileItem } from '@/renderer/hooks/useWorkspaceFiles';
import classNames from 'classnames';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export type AtMentionTab = 'skills' | 'files';

type AtMentionDropdownProps = {
  /** Currently active tab */
  activeTab: AtMentionTab;
  /** Callback when tab is changed */
  onTabChange: (tab: AtMentionTab) => void;

  /** Skill menu items */
  skillItems: SkillSelectorMenuItem[];
  /** Keys of selected skills */
  selectedSkillKeys: string[];
  /** Callback when a skill item is selected */
  onSelectSkill: (item: SkillSelectorMenuItem) => void;

  /** Workspace file items */
  fileItems: WorkspaceFileItem[];
  /** Whether files are loading */
  filesLoading?: boolean;
  /** Whether workspace is available */
  hasWorkspace?: boolean;
  /** Callback when a file item is selected */
  onSelectFile: (item: WorkspaceFileItem) => void;

  /** Index of the currently highlighted item */
  activeIndex: number;
  /** Callback when hover changes active index */
  onHoverItem: (index: number) => void;
};

/** File extension to icon emoji mapping */
function getFileEmoji(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const mapping: Record<string, string> = {
    ts: '📘',
    tsx: '📘',
    js: '📒',
    jsx: '📒',
    json: '📋',
    md: '📝',
    css: '🎨',
    scss: '🎨',
    html: '🌐',
    py: '🐍',
    rs: '🦀',
    go: '🔷',
    java: '☕',
    sql: '🗃️',
    yaml: '⚙️',
    yml: '⚙️',
    toml: '⚙️',
    xml: '📄',
    txt: '📄',
    svg: '🖼️',
    png: '🖼️',
    jpg: '🖼️',
    jpeg: '🖼️',
    gif: '🖼️',
    webp: '🖼️',
  };
  return mapping[ext] || '📄';
}

const AtMentionDropdown: React.FC<AtMentionDropdownProps> = ({ activeTab, onTabChange, skillItems, selectedSkillKeys, onSelectSkill, fileItems, filesLoading = false, hasWorkspace = false, onSelectFile, activeIndex, onHoverItem }) => {
  const { t } = useTranslation();
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hasSkills = skillItems.length > 0;
  const hasFiles = fileItems.length > 0 || hasWorkspace;

  // Scroll active item into view
  useEffect(() => {
    const current = itemRefs.current[activeIndex];
    if (current) {
      current.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  // Reset refs when items change
  useEffect(() => {
    itemRefs.current = [];
  }, [activeTab, skillItems.length, fileItems.length]);

  return (
    <div
      className='rounded-14px border border-solid shadow-[0_8px_24px_rgba(0,0,0,0.12)] overflow-hidden'
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
      {/* Tab headers */}
      <div
        className='px-12px py-6px border-b border-solid flex items-center gap-4px'
        style={{
          borderColor: 'color-mix(in srgb, var(--color-border-2) 56%, transparent)',
          background: 'color-mix(in srgb, var(--color-bg-1) 84%, transparent)',
        }}
      >
        <button type='button' className={classNames('px-8px py-4px rd-6px text-13px transition-colors cursor-pointer border-none outline-none', activeTab === 'skills' ? 'font-semibold text-t-primary bg-fill-2' : 'font-medium text-t-secondary bg-transparent hover:bg-fill-1')} onClick={() => onTabChange('skills')}>
          {t('messages.atMention.tabSkills', { defaultValue: 'Skills' })}
        </button>
        {hasFiles && (
          <button type='button' className={classNames('px-8px py-4px rd-6px text-13px transition-colors cursor-pointer border-none outline-none', activeTab === 'files' ? 'font-semibold text-t-primary bg-fill-2' : 'font-medium text-t-secondary bg-transparent hover:bg-fill-1')} onClick={() => onTabChange('files')}>
            {t('messages.atMention.tabFiles', { defaultValue: 'Files' })}
          </button>
        )}
        <div className='flex-1' />
        <div className='text-11px text-t-tertiary'>
          {t('messages.atMention.hint', {
            defaultValue: 'Tab to switch',
          })}
        </div>
      </div>

      {/* Content area */}
      <div role='listbox' className='overflow-y-auto p-6px' style={{ maxHeight: 'min(34vh, 260px)' }}>
        {/* Skills tab */}
        {activeTab === 'skills' && (
          <>
            {skillItems.length === 0 && (
              <div className='px-10px py-12px text-13px text-t-secondary'>
                {t('messages.atMention.emptySkills', {
                  defaultValue: 'No skills found',
                })}
              </div>
            )}
            {skillItems.map((item, index) => {
              const isSelected = selectedSkillKeys.includes(item.key);
              return (
                <button
                  key={item.key}
                  type='button'
                  role='option'
                  aria-selected={isSelected}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  className={classNames('w-full text-left px-10px py-6px rounded-8px transition-all border border-solid outline-none cursor-pointer mb-2px last:mb-0', {
                    'border-[var(--color-border-2)]': index === activeIndex,
                    'border-transparent hover:bg-[var(--color-fill-1)]': index !== activeIndex,
                  })}
                  style={{
                    minHeight: '42px',
                    background: index === activeIndex ? 'color-mix(in srgb, var(--aou-2) 88%, transparent)' : isSelected ? 'color-mix(in srgb, var(--color-primary-light-1) 50%, transparent)' : 'transparent',
                  }}
                  onMouseEnter={() => onHoverItem(index)}
                  onClick={() => onSelectSkill(item)}
                >
                  <div className='flex items-center gap-8px'>
                    <div className='w-28px h-28px flex-shrink-0 rd-6px overflow-hidden bg-fill-2 flex items-center justify-center text-16px'>{item.icon ? <img src={item.icon} alt={item.displayName} className='w-full h-full object-cover' /> : <span>{item.emoji || '⚡'}</span>}</div>
                    <div className='min-w-0 flex-1'>
                      <div className='flex items-center gap-6px min-w-0'>
                        <span className={classNames('text-14px truncate', index === activeIndex ? 'text-t-primary font-semibold' : 'text-t-primary font-medium')}>{item.displayName}</span>
                        {isSelected && (
                          <span className='px-4px py-0px bg-primary text-white text-9px rd-3px whitespace-nowrap flex-shrink-0 leading-14px'>
                            {t('messages.atMention.added', {
                              defaultValue: 'Added',
                            })}
                          </span>
                        )}
                      </div>
                      {item.description && <div className='text-11px text-t-secondary truncate mt-1px'>{item.description}</div>}
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
            {filesLoading && (
              <div className='px-10px py-12px text-13px text-t-secondary'>
                {t('messages.atMention.loadingFiles', {
                  defaultValue: 'Loading files...',
                })}
              </div>
            )}
            {!filesLoading && !hasWorkspace && (
              <div className='px-10px py-12px text-13px text-t-secondary'>
                {t('messages.atMention.noWorkspace', {
                  defaultValue: 'No workspace selected',
                })}
              </div>
            )}
            {!filesLoading && hasWorkspace && fileItems.length === 0 && (
              <div className='px-10px py-12px text-13px text-t-secondary'>
                {t('messages.atMention.emptyFiles', {
                  defaultValue: 'No files found',
                })}
              </div>
            )}
            {!filesLoading &&
              fileItems.map((item, index) => (
                <button
                  key={item.relativePath}
                  type='button'
                  role='option'
                  aria-selected={false}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  className={classNames('w-full text-left px-10px py-6px rounded-8px transition-all border border-solid outline-none cursor-pointer mb-2px last:mb-0', {
                    'border-[var(--color-border-2)]': index === activeIndex,
                    'border-transparent hover:bg-[var(--color-fill-1)]': index !== activeIndex,
                  })}
                  style={{
                    minHeight: '38px',
                    background: index === activeIndex ? 'color-mix(in srgb, var(--aou-2) 88%, transparent)' : 'transparent',
                  }}
                  onMouseEnter={() => onHoverItem(index)}
                  onClick={() => onSelectFile(item)}
                >
                  <div className='flex items-center gap-8px'>
                    <span className='text-16px flex-shrink-0'>{getFileEmoji(item.name)}</span>
                    <div className='min-w-0 flex-1'>
                      <div className={classNames('text-14px truncate', index === activeIndex ? 'text-t-primary font-semibold' : 'text-t-primary font-medium')}>{item.name}</div>
                      {item.relativePath !== item.name && <div className='text-11px text-t-tertiary truncate mt-1px'>{item.relativePath}</div>}
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

export default AtMentionDropdown;
