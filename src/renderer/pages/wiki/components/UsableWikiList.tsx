/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Empty, Input, Select, Table } from '@arco-design/web-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsableWiki } from '../api/types';
import { formatTime } from '../utils/files';
import WikiScopeTag, { wikiOrigin, type WikiOrigin } from './WikiScopeTag';
import WikiStatusBadge from './WikiStatusBadge';

/** Every wiki the user may use (tenant, shared with me, my own), read-only. */
export default function UsableWikiList({ wikis, isLoading, onView }: IUsableWikiListProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState<WikiOrigin | 'all'>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return wikis.filter((w) => (origin === 'all' || wikiOrigin(w) === origin) && (!q || `${w.name} ${w.description ?? ''}`.toLowerCase().includes(q)));
  }, [wikis, query, origin]);

  return (
    <div className='flex flex-col gap-12px'>
      <div className='flex items-center gap-8px'>
        <Input.Search allowClear className='max-w-320px' value={query} onChange={setQuery} placeholder={t('wiki.usable.searchPlaceholder')} />
        <Select className='w-140px' value={origin} onChange={setOrigin}>
          <Select.Option value='all'>{t('wiki.usable.allOrigins')}</Select.Option>
          <Select.Option value='tenant'>{t('wiki.origin.tenant')}</Select.Option>
          <Select.Option value='shared'>{t('wiki.origin.shared')}</Select.Option>
          <Select.Option value='mine'>{t('wiki.origin.mine')}</Select.Option>
        </Select>
      </div>
      <Table
        size='small'
        rowKey='id'
        loading={isLoading}
        data={filtered}
        pagination={filtered.length > 20 ? { pageSize: 20, size: 'mini' } : false}
        noDataElement={<Empty description={t('wiki.usable.empty')} />}
        columns={[
          {
            title: t('wiki.myWikis.name'),
            render: (_: unknown, wiki: UsableWiki) => (
              <div className='min-w-0'>
                <div className='truncate font-medium'>{wiki.name}</div>
                {wiki.description && <div className='truncate text-12px text-[var(--color-text-3)]'>{wiki.description}</div>}
              </div>
            ),
          },
          { title: t('wiki.usable.origin'), width: 90, render: (_: unknown, wiki: UsableWiki) => <WikiScopeTag wiki={wiki} /> },
          { title: t('wiki.myWikis.status'), width: 150, render: (_: unknown, wiki: UsableWiki) => <WikiStatusBadge status={wiki.build_status} /> },
          { title: t('wiki.usable.updatedAt'), width: 170, render: (_: unknown, wiki: UsableWiki) => formatTime(wiki.updated_at) },
          {
            title: '',
            width: 80,
            render: (_: unknown, wiki: UsableWiki) => (
              <Button size='mini' type='text' disabled={!wiki.has_built} onClick={() => onView(wiki)}>
                {t('wiki.common.view')}
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}

interface IUsableWikiListProps {
  wikis: UsableWiki[];
  isLoading: boolean;
  onView: (wiki: UsableWiki) => void;
}
