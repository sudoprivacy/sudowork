/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { FolderOpen } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { GeneratedFileEntry } from '@/common/generatedFiles';
import GeneratedFileCards from '@/renderer/messages/GeneratedFileCard';

interface DeliverablesPanelProps {
  conversationId?: string;
  teamId?: string;
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
const DeliverablesPanel: React.FC<DeliverablesPanelProps> = ({ conversationId, teamId }) => {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<GeneratedFileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Cold-load whenever the conversation/team changes.
  useEffect(() => {
    const key = teamId ? { teamId } : conversationId ? { conversationId } : null;
    if (!key) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    ipcBridge.deliverables.list
      .invoke(key)
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
  }, [conversationId, teamId]);

  // Live appends from AcpAgent at turn-finish.
  useEffect(() => {
    if (!teamId && !conversationId) return;
    const unsubscribe = ipcBridge.deliverables.changed.on((event) => {
      const matches = teamId ? event.teamId === teamId : event.conversationId === conversationId;
      if (!matches) return;
      setEntries((prev) => mergeEntries(prev, event.files));
    });
    return () => {
      unsubscribe();
    };
  }, [conversationId, teamId]);

  const grouped = useMemo(() => groupByDay(entries, t), [entries, t]);

  return (
    <div className='flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-3 py-4'>
      {entries.length === 0 ? (
        <EmptyState loading={loading} />
      ) : (
        <div className='flex flex-col gap-5'>
          {grouped.map((group) => (
            <section key={group.label} className='min-w-0'>
              <div className='mb-2 flex items-center gap-2 px-1'>
                <div className='shrink-0 text-13px font-semibold text-foreground-secondary'>{group.label}</div>
                <div className='h-px flex-1 bg-border' />
                <div className='shrink-0 text-10px tabular-nums text-foreground-tertiary'>{group.entries.length}</div>
              </div>
              <GeneratedFileCards entries={group.entries} layout='stack' fullWidth />
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

const EmptyState: React.FC<{ loading: boolean }> = ({ loading }) => {
  const { t } = useTranslation();
  if (loading) {
    return <div className='flex-1 f-center text-12px text-foreground-secondary'>{t('conversation.rightPanel.deliverables.loading')}</div>;
  }
  return (
    <div className='flex-1 f-center flex-col text-center px-6'>
      <div className='f-center flex-col gap-2.5'>
        <FolderOpen size={36} className='text-foreground-quaternary' />
        <div className='text-13px font-semibold text-foreground'>{t('conversation.rightPanel.deliverables.emptyTitle')}</div>
        <div className='max-w-55 text-12px leading-18px text-foreground-secondary opacity-80'>{t('conversation.rightPanel.deliverables.emptyHint')}</div>
      </div>
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
