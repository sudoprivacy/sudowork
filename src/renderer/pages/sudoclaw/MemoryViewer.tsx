/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import MarkdownView from '@/renderer/components/Markdown';
import { Button, DatePicker, Empty, Input, Spin, Tag } from '@arco-design/web-react';
import { Left } from '@icon-park/react';
import dayjs from 'dayjs';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { MemoryEntry } from './types';

/**
 * Stub loader for daily memory entries.
 *
 * Returns an empty array until the MemoryLog IPC provider from #214 is
 * available.  When #214 lands, replace this with a real IPC call such as:
 *
 * ```ts
 * const res = await memoryLogIpc.getEntriesByDate.invoke({ date });
 * return res?.success ? res.data : [];
 * ```
 */
async function loadEntriesForDate(_date: string): Promise<MemoryEntry[]> {
  // TODO(#214): wire up to MemoryLog IPC
  return [];
}

/**
 * MemoryViewer — browse daily memory log entries by date.
 *
 * Features:
 * - Date picker to select the day
 * - Full-text search across entry content
 * - Markdown-rendered content for each entry
 * - Category and tag display
 */
const MemoryViewer: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [selectedDate, setSelectedDate] = useState<string>(dayjs().format('YYYY-MM-DD'));
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /** Load entries for the selected date */
  const loadEntries = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const data = await loadEntriesForDate(date);
      setEntries(data);
      setExpandedId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Handle date change */
  const handleDateChange = useCallback(
    (_dateString: string, date: dayjs.Dayjs) => {
      const formatted = date.format('YYYY-MM-DD');
      setSelectedDate(formatted);
      void loadEntries(formatted);
    },
    [loadEntries]
  );

  /** Jump to today */
  const handleToday = useCallback(() => {
    const today = dayjs().format('YYYY-MM-DD');
    setSelectedDate(today);
    void loadEntries(today);
  }, [loadEntries]);

  /** Filter entries by search query */
  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter((entry) => entry.content.toLowerCase().includes(q) || entry.category.toLowerCase().includes(q) || entry.tags?.some((tag) => tag.toLowerCase().includes(q)));
  }, [entries, searchQuery]);

  const hasEntries = entries.length > 0;
  const hasResults = filteredEntries.length > 0;

  return (
    <div className='p-24px max-w-800px mx-auto flex flex-col gap-20px'>
      {/* Header with back button */}
      <div className='flex items-center gap-12px'>
        <Button type='text' icon={<Left theme='outline' size='18' />} onClick={() => navigate('/sudoclaw')} className='!p-4px' />
        <h2 className='text-20px font-600 color-[var(--color-text-1)] m-0'>{t('sudoclaw.memory.title')}</h2>
      </div>

      {/* Controls: date picker + search */}
      <div className='flex items-center gap-12px flex-wrap'>
        <DatePicker value={selectedDate} onChange={handleDateChange} disabledDate={(current) => current.isAfter(dayjs())} allowClear={false} style={{ width: 200 }} />
        <Button type='outline' size='small' onClick={handleToday}>
          {t('sudoclaw.memory.today')}
        </Button>
        <Input.Search value={searchQuery} onChange={setSearchQuery} placeholder={t('sudoclaw.memory.searchPlaceholder')} allowClear style={{ flex: 1, minWidth: 200 }} />
      </div>

      {/* Entry count */}
      {hasEntries && <span className='text-12px color-[var(--color-text-3)]'>{t('sudoclaw.memory.entryCount', { count: filteredEntries.length })}</span>}

      {/* Content area */}
      {loading ? (
        <div className='flex items-center justify-center py-48px'>
          <Spin size={24} tip={t('sudoclaw.memory.loading')} />
        </div>
      ) : !hasEntries ? (
        <Empty description={t('sudoclaw.memory.noEntries')} className='py-48px' />
      ) : !hasResults ? (
        <Empty description={t('sudoclaw.memory.noResults')} className='py-48px' />
      ) : (
        <div className='flex flex-col gap-12px'>
          {filteredEntries.map((entry) => (
            <div key={entry.id} className='border border-solid border-[var(--color-border)] rounded-8px overflow-hidden transition-all'>
              {/* Entry header */}
              <div className='flex items-center justify-between px-16px py-10px bg-[var(--color-fill-1)] cursor-pointer select-none' onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}>
                <div className='flex items-center gap-8px'>
                  <Tag size='small' color='arcoblue'>
                    {entry.category}
                  </Tag>
                  <span className='text-12px color-[var(--color-text-3)]'>{dayjs(entry.timestamp).format('HH:mm:ss')}</span>
                </div>
                <div className='flex items-center gap-6px'>
                  {entry.tags?.map((tag) => (
                    <Tag key={tag} size='small' color='gray'>
                      {tag}
                    </Tag>
                  ))}
                </div>
              </div>

              {/* Entry content — expanded */}
              {expandedId === entry.id && (
                <div className='px-16px py-12px'>
                  <MarkdownView>{entry.content}</MarkdownView>
                </div>
              )}

              {/* Entry content — collapsed preview */}
              {expandedId !== entry.id && (
                <div className='px-16px py-8px'>
                  <span className='text-13px color-[var(--color-text-2)] line-clamp-2'>{entry.content}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MemoryViewer;
