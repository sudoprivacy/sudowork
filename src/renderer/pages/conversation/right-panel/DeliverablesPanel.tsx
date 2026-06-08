/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { GeneratedFileEntry } from '@/common/generatedFiles';
import { iconColors } from '@/renderer/theme/colors';
import { GeneratedFileCard } from '@/renderer/messages/GeneratedFileCard';
import { FileCabinet } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface DeliverablesPanelProps {
  conversationId?: string;
  active?: boolean;
}

/**
 * Aggregated view of every file the AI has generated over this conversation,
 * newest first. Cold-loaded from the persisted message history via
 * `ipcBridge.deliverables.list`; live updates arrive through the
 * `deliverables.changed` emitter so a new turn appends without refetching.
 *
 * Dedupe semantics match the backend service: latest-wins per absolute path,
 * so re-generating a file shows the newest snapshot, not a log.
 */
const DeliverablesPanel: React.FC<DeliverablesPanelProps> = ({ conversationId }) => {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<GeneratedFileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Cold-load whenever the conversation changes.
  useEffect(() => {
    if (!conversationId) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    ipcBridge.deliverables.list
      .invoke({ conversationId })
      .then((res) => {
        if (cancelled) return;
        if (res?.success && Array.isArray(res.data)) setEntries(res.data);
      })
      .catch(() => {
        // ignore — empty state is the right fallback
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Live appends from AcpAgent at turn-finish.
  useEffect(() => {
    if (!conversationId) return;
    const unsubscribe = ipcBridge.deliverables.changed.on(({ conversationId: id, files }) => {
      if (id !== conversationId) return;
      setEntries((prev) => mergeEntries(prev, files));
    });
    return () => {
      unsubscribe();
    };
  }, [conversationId]);

  const grouped = useMemo(() => groupByDay(entries, t), [entries, t]);

  return (
    <div className='flex flex-col h-full min-h-0 overflow-y-auto px-12px py-10px gap-12px'>
      {entries.length === 0 ? (
        <EmptyState loading={loading} />
      ) : (
        grouped.map((group) => (
          <div key={group.label} className='flex flex-col gap-6px'>
            <div className='text-11px text-t-secondary opacity-70 uppercase tracking-wider'>{group.label}</div>
            <div className='flex flex-col gap-6px'>
              {group.entries.map((entry) => (
                <GeneratedFileCard key={entry.path} entry={entry} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

const EmptyState: React.FC<{ loading: boolean }> = ({ loading }) => {
  const { t } = useTranslation();
  if (loading) {
    return <div className='flex-1 flex items-center justify-center text-12px text-t-secondary'>{t('conversation.rightPanel.deliverables.loading')}</div>;
  }
  return (
    <div className='flex-1 flex flex-col items-center justify-center text-center px-24px gap-8px'>
      <FileCabinet size={36} fill={iconColors.disabled} />
      <div className='text-13px text-t-primary font-medium'>{t('conversation.rightPanel.deliverables.emptyTitle')}</div>
      <div className='text-12px text-t-secondary opacity-70'>{t('conversation.rightPanel.deliverables.emptyHint')}</div>
    </div>
  );
};

function mergeEntries(prev: GeneratedFileEntry[], incoming: GeneratedFileEntry[]): GeneratedFileEntry[] {
  const byPath = new Map<string, GeneratedFileEntry>();
  for (const entry of prev) byPath.set(entry.path, entry);
  for (const entry of incoming) byPath.set(entry.path, entry); // latest wins
  return [...byPath.values()].sort((a, b) => b.createdAt - a.createdAt);
}

interface DayGroup {
  label: string;
  entries: GeneratedFileEntry[];
}

function groupByDay(entries: GeneratedFileEntry[], t: (key: string) => string): DayGroup[] {
  if (entries.length === 0) return [];

  const now = new Date();
  const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const yesterday = today - 24 * 60 * 60 * 1000;

  const groups = new Map<string, DayGroup>();
  for (const entry of entries) {
    const entryDayStart = startOfDay(new Date(entry.createdAt));
    let label: string;
    if (entryDayStart === today) label = t('conversation.rightPanel.deliverables.groupToday');
    else if (entryDayStart === yesterday) label = t('conversation.rightPanel.deliverables.groupYesterday');
    else label = new Date(entry.createdAt).toLocaleDateString();
    let group = groups.get(label);
    if (!group) {
      group = { label, entries: [] };
      groups.set(label, group);
    }
    group.entries.push(entry);
  }
  // Order: Today > Yesterday > anything else (date-string lexical desc)
  return [...groups.values()].sort((a, b) => {
    const todayLabel = t('conversation.rightPanel.deliverables.groupToday');
    const yesterdayLabel = t('conversation.rightPanel.deliverables.groupYesterday');
    const rank = (label: string): number => {
      if (label === todayLabel) return 0;
      if (label === yesterdayLabel) return 1;
      return 2;
    };
    const ra = rank(a.label);
    const rb = rank(b.label);
    if (ra !== rb) return ra - rb;
    return b.label.localeCompare(a.label);
  });
}

export default DeliverablesPanel;
