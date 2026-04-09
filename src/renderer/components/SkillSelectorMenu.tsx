/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import classNames from 'classnames';
import React, { useEffect, useRef } from 'react';
import type { AtMentionTab, FileItem } from '@/renderer/hooks/useSkillSelectorController';

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
  /** Tab support for skills + files */
  showTabs?: boolean;
  activeTab?: AtMentionTab;
  onTabChange?: (tab: AtMentionTab) => void;
  fileItems?: FileItem[];
  onSelectFile?: (file: FileItem) => void;
  fileEmptyText?: string;
  tabLabels?: { skills: string; files: string };
}

const SkillSelectorMenu: React.FC<SkillSelectorMenuProps> = ({ title, hint, items, selectedKeys, activeIndex, loading = false, loadingText = 'Loading...', onHoverItem, onSelectItem, emptyText, showTabs = false, activeTab = 'skills', onTabChange, fileItems = [], onSelectFile, fileEmptyText = 'No files', tabLabels = { skills: 'Skills', files: 'Files' } }) => {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Scroll active item into view
  useEffect(() => {
    const current = itemRefs.current[activeIndex];
    if (current) {
      current.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, items.length, fileItems.length, activeTab]);

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
      {/* Header with optional tabs */}
      <div
        className='px-12px py-8px border-b border-solid'
        style={{
          borderColor: 'color-mix(in srgb, var(--color-border-2) 56%, transparent)',
          background: 'color-mix(in srgb, var(--color-bg-1) 84%, transparent)',
        }}
      >
        {showTabs ? (
          <div className='flex items-center gap-0'>
            {(['skills', 'files'] as const).map((tab) => (
              <button
                key={tab}
                type='button'
                className={classNames('px-10px py-4px text-13px font-medium cursor-pointer border-none outline-none rounded-6px transition-colors', {
                  'bg-fill-2 text-t-primary font-semibold': activeTab === tab,
                  'bg-transparent text-t-secondary hover:text-t-primary': activeTab !== tab,
                })}
                // Prevent mousedown from stealing focus from the input
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onTabChange?.(tab)}
              >
                {tabLabels[tab]}
              </button>
            ))}
            {hint && <div className='text-13px text-t-secondary truncate ml-auto'>{hint}</div>}
          </div>
        ) : (
          <div className='flex items-center justify-between gap-8px'>
            <div className='text-13px font-semibold text-t-primary'>{title}</div>
            {hint && <div className='text-13px text-t-secondary truncate'>{hint}</div>}
          </div>
        )}
      </div>

      {/* Content area - skills or files based on active tab */}
      <div role='listbox' aria-busy={loading} className='overflow-y-auto p-6px' style={{ maxHeight: 'min(34vh, 260px)' }}>
        {activeTab === 'skills' && (
          <>
            {loading && <div className='px-10px py-12px text-13px text-t-secondary'>{loadingText}</div>}
            {!loading && items.length === 0 && <div className='px-10px py-12px text-13px text-t-secondary'>{emptyText}</div>}
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
                    className={classNames('w-full text-left px-10px py-6px rounded-8px transition-all border border-solid outline-none cursor-pointer mb-2px last:mb-0', {
                      'border-[var(--color-border-2)]': index === activeIndex,
                      'border-transparent hover:bg-[var(--color-fill-1)]': index !== activeIndex,
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
                    <div className='flex items-center gap-8px'>
                      <div className='w-28px h-28px flex-shrink-0 rd-6px overflow-hidden bg-fill-2 flex items-center justify-center text-16px'>{item.icon ? <img src={item.icon} alt={item.displayName} className='w-full h-full object-cover' /> : <span>{item.emoji || '⚡'}</span>}</div>
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-6px min-w-0'>
                          <span className={classNames('text-14px truncate', index === activeIndex ? 'text-t-primary font-semibold' : 'text-t-primary font-medium')}>{item.displayName}</span>
                          {isSelected && <span className='px-4px py-0px bg-primary text-white text-9px rd-3px whitespace-nowrap flex-shrink-0 leading-14px'>已添加</span>}
                        </div>
                        {item.description && <div className='text-11px text-t-secondary truncate mt-1px'>{item.description}</div>}
                      </div>
                    </div>
                  </button>
                );
              })}
          </>
        )}

        {activeTab === 'files' && (
          <>
            {fileItems.length === 0 && <div className='px-10px py-12px text-13px text-t-secondary'>{fileEmptyText}</div>}
            {fileItems.map((file, index) => (
              <button
                key={file.fullPath}
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
                  minHeight: '36px',
                  background: index === activeIndex ? 'color-mix(in srgb, var(--aou-2) 88%, transparent)' : 'transparent',
                }}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => onHoverItem(index)}
                onClick={() => onSelectFile?.(file)}
              >
                <div className='flex items-center gap-8px'>
                  <div className='w-24px h-24px flex-shrink-0 rd-4px overflow-hidden bg-fill-2 flex items-center justify-center text-14px'>
                    <span>📄</span>
                  </div>
                  <div className='min-w-0 flex-1'>
                    <div className='text-14px text-t-primary truncate'>{file.name}</div>
                    {file.relativePath !== file.name && <div className='text-11px text-t-secondary truncate mt-1px'>{file.relativePath}</div>}
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
