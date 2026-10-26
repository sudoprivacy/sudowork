/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Checkbox, Empty, Input, Popover, Spin, Tag } from '@arco-design/web-react';
import { Library } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ActionChip from '@/renderer/components/ui/ActionChip';
import type { UsableWiki } from '@/renderer/pages/wiki/api/types';
import WikiScopeTag from '@/renderer/pages/wiki/components/WikiScopeTag';

/**
 * Wiki chip + popover for remote chats. Two modes share one popover:
 * - select: the chip opens a checkbox list editing the conversation's sticky set;
 * - mention: typing `#query` opens a filtered list; picking inserts a one-message mention.
 */
export default function WikiPicker({ wikis, isLoading, selectedIds, mentionQuery, onChange, onMentionPick, onMentionDismiss, onOpen }: IWikiPickerProps) {
  const { t } = useTranslation();
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [search, setSearch] = useState('');
  const isMentioning = mentionQuery !== null;
  const isOpen = isSelectOpen || isMentioning;

  const visible = useMemo(() => {
    const q = (isMentioning ? mentionQuery : search).trim().toLowerCase();
    return wikis.filter((w) => w.has_built && (!q || w.name.toLowerCase().includes(q)));
  }, [wikis, isMentioning, mentionQuery, search]);

  const toggle = (id: string) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  };

  const content = (
    <div className='w-320px flex flex-col gap-8px'>
      {isMentioning ? <div className='text-12px text-[var(--color-text-3)]'>{t('wiki.chat.mentionHint')}</div> : <Input size='small' allowClear value={search} onChange={setSearch} placeholder={t('wiki.chat.searchPlaceholder')} />}
      <Spin loading={isLoading} className='w-full'>
        <div className='max-h-280px overflow-auto flex flex-col'>
          {visible.length === 0 ? (
            <Empty description={t('wiki.chat.empty')} />
          ) : (
            visible.map((wiki) => (
              <div key={wiki.id} className='flex items-center gap-8px px-8px py-6px rd-6px cursor-pointer hover:bg-[var(--color-fill-2)]' onMouseDown={(e) => e.preventDefault()} onClick={() => (isMentioning ? onMentionPick(wiki) : toggle(wiki.id))}>
                {!isMentioning && <Checkbox checked={selectedIds.includes(wiki.id)} />}
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-13px'>{wiki.name}</div>
                  {wiki.description && <div className='truncate text-12px text-[var(--color-text-3)]'>{wiki.description}</div>}
                </div>
                <WikiScopeTag wiki={wiki} />
              </div>
            ))
          )}
        </div>
      </Spin>
    </div>
  );

  return (
    <Popover
      trigger='click'
      position='top'
      popupVisible={isOpen}
      onVisibleChange={(visibleNow) => {
        if (visibleNow) {
          setIsSelectOpen(true);
          onOpen?.();
        } else {
          setIsSelectOpen(false);
          if (isMentioning) onMentionDismiss();
        }
      }}
      content={content}
    >
      <ActionChip icon={<Library size={14} />} active={selectedIds.length > 0} label={selectedIds.length > 0 ? t('wiki.chat.chipWithCount', { count: selectedIds.length }) : t('wiki.chat.chip')} />
    </Popover>
  );
}

/** Selected wikis as closable tags; ids no longer usable show as unavailable. */
export function WikiChips({ wikis, selectedIds, onRemove }: IWikiChipsProps) {
  const { t } = useTranslation();
  if (selectedIds.length === 0) return null;
  const byId = new Map(wikis.map((w) => [w.id, w]));
  return (
    <div className='flex flex-wrap items-center gap-6px mb-8px'>
      {selectedIds.map((id) => {
        const wiki = byId.get(id);
        return (
          <Tag key={id} size='small' color={wiki ? 'arcoblue' : 'gray'} closable={!!onRemove} onClose={() => onRemove?.(id)} icon={<Library size={12} />}>
            {wiki ? wiki.name : t('wiki.chat.unavailable')}
          </Tag>
        );
      })}
    </div>
  );
}

interface IWikiPickerProps {
  wikis: UsableWiki[];
  isLoading: boolean;
  selectedIds: string[];
  /** Text after `#` at the cursor; null when not mentioning. */
  mentionQuery: string | null;
  onChange: (ids: string[]) => void;
  onMentionPick: (wiki: UsableWiki) => void;
  onMentionDismiss: () => void;
  /** Called when the popover opens (refresh the list). */
  onOpen?: () => void;
}

interface IWikiChipsProps {
  wikis: UsableWiki[];
  selectedIds: string[];
  onRemove?: (id: string) => void;
}
