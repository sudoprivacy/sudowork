/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import classNames from 'classnames';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export interface SlashCommandMenuItem {
  key: string;
  label: string;
  description?: string;
  badge?: string;
}

interface SlashCommandMenuProps {
  title: string;
  hint?: string;
  items: SlashCommandMenuItem[];
  activeIndex: number;
  loading?: boolean;
  loadingText?: string;
  onHoverItem: (index: number) => void;
  onSelectItem: (item: SlashCommandMenuItem) => void;
  emptyText?: string;
}

const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({ title, hint, items, activeIndex, loading = false, loadingText, onHoverItem, onSelectItem, emptyText }) => {
  const { t } = useTranslation();
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Use i18n loading text if not provided
  const resolvedLoadingText = loadingText || t('common.loading');
  const resolvedEmptyText = emptyText || t('messages.slash.empty', 'No commands found');

  useEffect(() => {
    const current = itemRefs.current[activeIndex];
    if (current) {
      current.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, items.length]);

  return (
    <div
      className='rounded-14px border shadow-[0_8px_24px_rgba(0,0,0,0.12)] overflow-hidden'
      style={{
        borderColor: 'var(--color-border-2)',
        background: 'color-mix(in srgb, var(--color-bg-1) 78%, transparent)',
        backdropFilter: 'blur(14px) saturate(1.1)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.1)',
      }}
    >
      <div
        className='px-3 py-2 border-b flex items-center justify-between gap-2'
        style={{
          borderColor: 'color-mix(in srgb, var(--color-border-2) 56%, transparent)',
          background: 'color-mix(in srgb, var(--color-bg-1) 84%, transparent)',
        }}
      >
        <div className='text-13px font-semibold text-foreground'>{title}</div>
        {hint && <div className='text-13px text-secondary truncate'>{hint}</div>}
      </div>
      <div role='listbox' aria-busy={loading} className='overflow-y-auto p-1.5' style={{ maxHeight: 'min(34vh, 260px)' }}>
        {loading && <div className='px-2.5 py-3 text-13px text-secondary'>{resolvedLoadingText}</div>}
        {!loading && items.length === 0 && <div className='px-2.5 py-3 text-13px text-secondary'>{resolvedEmptyText}</div>}
        {!loading &&
          items.map((item, index) => (
            <button
              key={item.key}
              type='button'
              role='option'
              aria-selected={index === activeIndex}
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
                boxShadow: undefined,
              }}
              onMouseEnter={() => onHoverItem(index)}
              onClick={() => onSelectItem(item)}
            >
              <div className='flex items-center justify-between gap-2'>
                <div className='min-w-0 flex items-baseline gap-2.5'>
                  <div className={classNames('text-14px whitespace-nowrap', index === activeIndex ? 'text-foreground font-semibold' : 'text-foreground font-medium')}>{item.label}</div>
                  {item.description && <div className='text-12px text-secondary truncate'>{item.description}</div>}
                </div>
                {item.badge && <span className={classNames('text-10px rounded-999px px-1.5 py-px shrink-0', index === activeIndex ? 'text-foreground bg-[var(--color-bg-1)]' : 'text-secondary bg-[var(--color-bg-1)]')}>{item.badge}</span>}
              </div>
            </button>
          ))}
      </div>
    </div>
  );
};

export default SlashCommandMenu;
