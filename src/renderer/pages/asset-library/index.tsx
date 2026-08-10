import { Input, Select } from '@arco-design/web-react';
import { Search } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import type { AssetLibraryEntry } from '@/common/generatedFiles';
import PageWrapper from '@renderer/components/base/PageWrapper';
import { getRendererSessionMode } from '@renderer/pages/guid/hooks/useGuidAgentSelection';
import { FILE_EXTENSION_MAP, getFileExtension } from '@renderer/pages/conversation/preview/utils/fileUtils';
import { addEventListener } from '@renderer/utils/emitter';
import AssetLibraryItem from './components/AssetLibraryItem';
import AssetLibrarySkeleton from './components/AssetLibrarySkeleton';

const SKELETON_MIN_DURATION_MS = 300;

export default function AssetLibraryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<AssetLibraryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<AssetCategory>('all');
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(() => {
    setIsLoading(true);
    return Promise.all([ipcBridge.deliverables.listForUser.invoke({ sessionMode: getRendererSessionMode() }).catch((): null => null), new Promise<void>((resolve) => setTimeout(resolve, SKELETON_MIN_DURATION_MS))])
      .then(([result]) => setEntries(result?.success && Array.isArray(result.data) ? result.data : []))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    void refresh();
    const removeDeliverablesListener = ipcBridge.deliverables.changed.on(() => void refresh());
    const removeConversationListener = ipcBridge.database.conversationChanged.on(() => void refresh());
    const removeHistoryListener = addEventListener('chat.history.refresh', () => void refresh());
    const removeSessionModeListener = addEventListener('sessionMode.changed', () => void refresh());

    return () => {
      removeDeliverablesListener();
      removeConversationListener();
      removeHistoryListener();
      removeSessionModeListener();
    };
  }, [refresh]);

  const onMissingEntry = useCallback((path: string) => {
    setEntries((current) => current.filter((entry) => entry.path !== path));
  }, []);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (category !== 'all' && getAssetCategory(entry) !== category) return false;
      return !normalizedQuery || `${entry.path} ${entry.relativePath ?? ''} ${entry.conversationName}`.toLowerCase().includes(normalizedQuery);
    });
  }, [category, entries, query]);

  const groupedEntries = useMemo(() => groupByDate(filteredEntries, t), [filteredEntries, t]);

  return (
    <PageWrapper className='h-full' title={t('common.siderMenu.assetLibrary')} subtitle={t('common.assetLibrary.subtitle')}>
      <div className='mb-6 flex flex-wrap items-center justify-between gap-4'>
        <div className='flex min-w-0 flex-1 items-center gap-3'>
          <Select aria-label={t('common.assetLibrary.typeFilter')} className='w-32 shrink-0' value={category} onChange={(value) => setCategory(value as AssetCategory)}>
            <Select.Option value='all'>{t('common.assetLibrary.typeAll')}</Select.Option>
            <Select.Option value='image'>{t('common.assetLibrary.typeImage')}</Select.Option>
            <Select.Option value='document'>{t('common.assetLibrary.typeDocument')}</Select.Option>
            <Select.Option value='video'>{t('common.assetLibrary.typeVideo')}</Select.Option>
            <Select.Option value='other'>{t('common.assetLibrary.typeOther')}</Select.Option>
          </Select>
          <Input allowClear className='max-w-120 flex-1' prefix={<Search size={16} className='text-foreground-tertiary' />} placeholder={t('common.assetLibrary.searchPlaceholder')} value={query} onChange={setQuery} />
        </div>
        <span className='shrink-0 text-13px text-foreground-secondary'>{t('common.assetLibrary.count', { count: filteredEntries.length })}</span>
      </div>

      {isLoading ? (
        <AssetLibrarySkeleton />
      ) : filteredEntries.length === 0 ? (
        <div className='flex min-h-64 flex-col items-center justify-center text-center'>
          <div className='text-16px font-600 text-foreground'>{t(query || category !== 'all' ? 'common.assetLibrary.noSearchResults' : 'common.assetLibrary.emptyTitle')}</div>
          <div className='mt-2 max-w-100 text-13px text-foreground-secondary'>{t(query || category !== 'all' ? 'common.assetLibrary.noSearchResultsHint' : 'common.assetLibrary.emptyHint')}</div>
        </div>
      ) : (
        <div className='flex flex-col gap-8'>
          {groupedEntries.map((group) => (
            <section key={group.label}>
              <div className='mb-3 flex items-center gap-2'>
                <h3 className='m-0 text-14px font-600 text-foreground-secondary'>{group.label}</h3>
                <span className='text-12px text-foreground-tertiary'>{group.entries.length}</span>
                <div className='h-px flex-1 bg-border' />
              </div>
              <div className='grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3'>
                {group.entries.map((entry) => (
                  <AssetLibraryItem key={entry.path} entry={entry} onOpenConversation={() => void navigate(`/conversation/${entry.conversationId}`)} onMissing={onMissingEntry} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageWrapper>
  );
}

type AssetCategory = 'all' | 'image' | 'document' | 'video' | 'other';

const IMAGE_EXTENSIONS = new Set(FILE_EXTENSION_MAP.image);
const VIDEO_EXTENSIONS = new Set(FILE_EXTENSION_MAP.video);
const DOCUMENT_EXTENSIONS = new Set([...FILE_EXTENSION_MAP.markdown, ...FILE_EXTENSION_MAP.pdf, ...FILE_EXTENSION_MAP.word, ...FILE_EXTENSION_MAP.ppt, ...FILE_EXTENSION_MAP.excel, 'txt', 'rtf']);

export function getAssetCategory(entry: Pick<AssetLibraryEntry, 'ext' | 'path'>): Exclude<AssetCategory, 'all'> {
  const extension = (entry.ext || getFileExtension(entry.path)).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return 'other';
}

interface IAssetDateGroup {
  label: string;
  entries: AssetLibraryEntry[];
}

function groupByDate(entries: AssetLibraryEntry[], t: (key: string) => string): IAssetDateGroup[] {
  const groups = new Map<string, IAssetDateGroup>();
  const today = startOfDay(Date.now());
  const yesterday = today - 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    const day = startOfDay(entry.createdAt);
    const label = day === today ? t('common.assetLibrary.today') : day === yesterday ? t('common.assetLibrary.yesterday') : new Date(entry.createdAt).toLocaleDateString();
    const group = groups.get(label) ?? { label, entries: [] };
    group.entries.push(entry);
    groups.set(label, group);
  }

  return [...groups.values()];
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
