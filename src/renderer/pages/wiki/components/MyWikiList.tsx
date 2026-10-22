/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Empty, Message, Popconfirm, Space, Switch, Table, Tooltip, Typography } from '@arco-design/web-react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WikiBuildStatusResponse, WikiRecord } from '../api/types';
import type { WikiApi } from '../api/wikiApi';
import { wikiErrorMessage } from '../utils/errors';
import { isBuildActive } from '../utils/buildState';
import { formatTime } from '../utils/files';
import WikiStatusBadge from './WikiStatusBadge';

/** The user's private wikis with build, enable, edit, delete and view actions. */
export default function MyWikiList({ api, wikis, isLoading, buildStatuses, onCreate, onEdit, onView, onChanged, onBuildStarted }: IMyWikiListProps) {
  const { t } = useTranslation();

  const run = async (action: () => Promise<unknown>, successKey?: string) => {
    try {
      await action();
      if (successKey) Message.success(t(successKey));
      onChanged();
    } catch (err) {
      Message.error(wikiErrorMessage(t, err));
    }
  };

  return (
    <div className='flex flex-col gap-12px'>
      <div className='flex items-center justify-between'>
        <Typography.Text bold>{t('wiki.myWikis.title')}</Typography.Text>
        <Button size='small' type='primary' icon={<Plus size={14} />} onClick={onCreate}>
          {t('wiki.myWikis.create')}
        </Button>
      </div>
      <Table
        size='small'
        rowKey='id'
        loading={isLoading}
        data={wikis}
        pagination={false}
        noDataElement={<Empty description={t('wiki.myWikis.empty')} />}
        columns={[
          {
            title: t('wiki.myWikis.name'),
            dataIndex: 'name',
            render: (_: unknown, wiki: WikiRecord) => (
              <div className='min-w-0'>
                <div className='truncate font-medium'>{wiki.name}</div>
                {wiki.description && <div className='truncate text-12px text-[var(--color-text-3)]'>{wiki.description}</div>}
              </div>
            ),
          },
          {
            title: t('wiki.myWikis.status'),
            width: 190,
            render: (_: unknown, wiki: WikiRecord) => {
              const live = buildStatuses[wiki.id];
              const status = live?.wiki_build_status ?? wiki.buildStatus;
              const error = live?.last_build_error ?? wiki.lastBuildError;
              const badge = <WikiStatusBadge status={status} isStale={wiki.needsRebuild} progress={live?.latest_job?.progress} />;
              return status === 'failed' && error ? <Tooltip content={error}>{badge}</Tooltip> : badge;
            },
          },
          { title: t('wiki.myWikis.lastBuilt'), width: 170, render: (_: unknown, wiki: WikiRecord) => formatTime(wiki.lastBuiltAt) },
          {
            title: t('wiki.myWikis.enabled'),
            width: 80,
            render: (_: unknown, wiki: WikiRecord) => <Switch size='small' checked={wiki.enabled !== false} onChange={(checked) => run(() => api.setWikiEnabled(wiki.id, checked))} />,
          },
          {
            title: '',
            width: 300,
            render: (_: unknown, wiki: WikiRecord) => {
              const live = buildStatuses[wiki.id];
              const isBuilding = isBuildActive(live, wiki.buildStatus);
              const jobId = live?.latest_job?.id;
              return (
                <Space size={4}>
                  {isBuilding && jobId ? (
                    <Button size='mini' type='text' onClick={() => run(() => api.cancelBuildJob(jobId), 'wiki.myWikis.cancelled')}>
                      {t('wiki.myWikis.cancel')}
                    </Button>
                  ) : (
                    <Button
                      size='mini'
                      type='text'
                      disabled={isBuilding || wiki.enabled === false}
                      onClick={() =>
                        run(async () => {
                          await api.buildWiki(wiki.id);
                          onBuildStarted();
                        }, 'wiki.myWikis.buildStarted')
                      }
                    >
                      {wiki.hasBuilt ? t('wiki.myWikis.rebuild') : t('wiki.myWikis.build')}
                    </Button>
                  )}
                  <Button size='mini' type='text' disabled={!wiki.hasBuilt} onClick={() => onView(wiki)}>
                    {t('wiki.common.view')}
                  </Button>
                  <Button size='mini' type='text' onClick={() => onEdit(wiki)}>
                    {t('wiki.common.edit')}
                  </Button>
                  <Popconfirm title={t('wiki.myWikis.deleteConfirm', { name: wiki.name })} onOk={() => run(() => api.deleteWiki(wiki.id))}>
                    <Button size='mini' type='text' status='danger'>
                      {t('wiki.common.delete')}
                    </Button>
                  </Popconfirm>
                </Space>
              );
            },
          },
        ]}
      />
    </div>
  );
}

interface IMyWikiListProps {
  api: WikiApi;
  wikis: WikiRecord[];
  isLoading: boolean;
  /** Live build state keyed by wiki id (from useBuildTracker). */
  buildStatuses: Record<string, WikiBuildStatusResponse>;
  onCreate: () => void;
  onEdit: (wiki: WikiRecord) => void;
  onView: (wiki: WikiRecord) => void;
  onChanged: () => void;
  /** A build was started; restarts progress tracking. */
  onBuildStarted: () => void;
}
