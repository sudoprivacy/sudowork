/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Drawer, Empty, Input, List, Message, Spin, Typography } from '@arco-design/web-react';
import { FileText } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MarkdownView from '@/renderer/components/Markdown';
import type { WikiApi } from '../api/wikiApi';
import type { WikiSearchMatch } from '../api/types';
import { wikiErrorMessage } from '../utils/errors';

/** Read-only view of a built wiki: its markdown files plus full-text search. */
export default function WikiViewerDrawer({ api, wiki, onClose }: IWikiViewerDrawerProps) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<WikiSearchMatch[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const openFile = useCallback(
    async (wikiId: string, path: string) => {
      setActiveFile(path);
      setIsLoadingContent(true);
      try {
        setContent(await api.readWikiFile(wikiId, path));
      } catch (err) {
        setContent('');
        Message.error(wikiErrorMessage(t, err));
      } finally {
        setIsLoadingContent(false);
      }
    },
    [api, t]
  );

  useEffect(() => {
    setFiles([]);
    setActiveFile(null);
    setContent('');
    setQuery('');
    setMatches(null);
    if (!wiki) return;
    let isCancelled = false;
    setIsLoadingFiles(true);
    api
      .listWikiFiles(wiki.id)
      .then((list) => {
        if (isCancelled) return;
        const markdown = list.filter((f) => f.endsWith('.md')).sort((a, b) => (a === 'WIKI.md' ? -1 : b === 'WIKI.md' ? 1 : a.localeCompare(b)));
        setFiles(markdown);
        if (markdown[0]) void openFile(wiki.id, markdown[0]);
      })
      .catch((err) => {
        if (!isCancelled) Message.error(wikiErrorMessage(t, err));
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingFiles(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [api, wiki, openFile, t]);

  const onSearch = async (value: string) => {
    if (!wiki) return;
    const q = value.trim();
    if (!q) {
      setMatches(null);
      return;
    }
    setIsSearching(true);
    try {
      setMatches(await api.searchWiki(wiki.id, q));
    } catch (err) {
      Message.error(wikiErrorMessage(t, err));
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <Drawer width='min(1100px, 92vw)' title={wiki?.name ?? ''} visible={!!wiki} onCancel={onClose} footer={null} unmountOnExit>
      <div className='flex flex-col gap-12px h-full min-h-0'>
        <Input.Search allowClear value={query} onChange={setQuery} onSearch={onSearch} loading={isSearching} placeholder={t('wiki.viewer.searchPlaceholder')} />
        <div className='grid grid-cols-[240px_minmax(0,1fr)] gap-12px flex-1 min-h-0'>
          <div className='overflow-auto border border-solid border-[var(--color-border-2)] rd-8px'>
            {matches !== null ? (
              <List
                size='small'
                dataSource={matches}
                noDataElement={<Empty description={t('wiki.viewer.noMatches')} />}
                render={(m, index) => (
                  <List.Item key={`${m.file}:${m.line_no}:${index}`} className='cursor-pointer hover:bg-[var(--color-fill-2)]' onClick={() => wiki && void openFile(wiki.id, m.file)}>
                    <div className='text-12px text-[var(--color-text-3)]'>
                      {m.file}:{m.line_no}
                    </div>
                    <div className='text-13px line-clamp-2'>{m.line}</div>
                  </List.Item>
                )}
              />
            ) : (
              <Spin loading={isLoadingFiles} className='w-full'>
                <List
                  size='small'
                  dataSource={files}
                  noDataElement={<Empty description={t('wiki.viewer.noFiles')} />}
                  render={(file) => (
                    <List.Item key={file} className={`cursor-pointer hover:bg-[var(--color-fill-2)] ${file === activeFile ? 'bg-[var(--color-fill-2)]' : ''}`} onClick={() => wiki && void openFile(wiki.id, file)}>
                      <span className='inline-flex items-center gap-6px text-13px'>
                        <FileText size={14} />
                        {file}
                      </span>
                    </List.Item>
                  )}
                />
              </Spin>
            )}
          </div>
          <div className='overflow-auto px-8px'>
            <Spin loading={isLoadingContent} className='w-full'>
              {activeFile ? (
                <>
                  <Typography.Text type='secondary' className='text-12px'>
                    {activeFile}
                  </Typography.Text>
                  <MarkdownView>{content}</MarkdownView>
                </>
              ) : (
                <Empty description={t('wiki.viewer.pickFile')} />
              )}
            </Spin>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

interface IWikiViewerDrawerProps {
  api: WikiApi;
  /** The wiki to show; null closes the drawer. */
  wiki: { id: string; name: string } | null;
  onClose: () => void;
}
