/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Input, Message, Modal, Radio, Table, Tag, Typography } from '@arco-design/web-react';
import { IconPlus } from '@arco-design/web-react/icon';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '@renderer/context/AuthContext';
import { invokePark, useParkOrgId, useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

interface ILeadRow {
  lead_id: string;
  enterprise_name?: string | null;
  enterprise_org_id: string;
  source: 'inquiry' | 'manual';
  score: number | null;
  status: string;
  owner_id: string | null;
  created_at: number;
}

type IFilter = 'default' | 'all' | 'proposed' | 'mine' | 'watched';

export default function ParkLeadsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { parkOrgId, role } = useParkOrgId();
  const [filter, setFilter] = useState<IFilter>('default');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [enterpriseOrgId, setEnterpriseOrgId] = useState('');
  const [note, setNote] = useState('');

  const { data, loading, error, reload } = useParkQuery<{ items: ILeadRow[] }>(
    'listLeads',
    parkOrgId
      ? {
          parkOrgId,
          ...(filter === 'proposed' ? { status: 'proposed' } : {}),
          ...(filter === 'watched' ? { watched: true } : {}),
        }
      : undefined,
  );

  const items = (data?.items ?? []).filter(lead =>
    filter === 'default' ? lead.status === 'proposed' || lead.owner_id === user?.id
      : filter !== 'mine' || lead.owner_id === user?.id,
  )

  async function createManual() {
    if (!parkOrgId || !enterpriseOrgId.trim()) return;
    try {
      await invokePark('createManualLead', {
        parkOrgId,
        enterpriseOrgId: enterpriseOrgId.trim(),
        note,
      });
      Message.success(t('park.leads.createdManual', '线索已创建'));
      setIsCreateOpen(false);
      setEnterpriseOrgId('');
      setNote('');
      reload()
    } catch (err) {
      Message.error(err instanceof Error ? err.message : t('park.leads.updateFailed', '操作失败'))
    }
  }

  return (
    <PageWrapper
      title={t('park.leads.title', '线索池')}
      actions={
        role === 'park_ops' ? (
          <Button type='primary' icon={<IconPlus />} onClick={() => setIsCreateOpen(true)}>
            {t('park.leads.createManual', '新建线索')}
          </Button>
        ) : null
      }
    >
      <Card loading={loading}>
        <div className='mb-3 flex items-center gap-3'>
          <Radio.Group value={filter} onChange={v => setFilter(v as IFilter)}>
            <Radio value='default'>{t('park.leads.filterDefault')}</Radio>
            <Radio value='all'>{t('park.leads.filterAll', '全部')}</Radio>
            <Radio value='proposed'>{t('park.leads.filterProposed', '待确认')}</Radio>
            <Radio value='mine'>{t('park.leads.filterMine', '我的')}</Radio>
            {role === 'park_leader' ? (
              <Radio value='watched'>{t('park.leads.filterWatched', '已关注')}</Radio>
            ) : null}
          </Radio.Group>
        </div>
        {error ? (
          <Typography.Text type='error'>{t('park.common.loadFailed', '加载失败')}: {error}</Typography.Text>
        ) : (
          <Table
            rowKey='lead_id'
            data={items as never}
            pagination={{ pageSize: 20 }}
            onRow={record => ({
              onClick: () => navigate(`/park/leads/${String((record as ILeadRow).lead_id)}`),
            })}
            columns={[
              { title: t('park.common.enterprise', '企业'), dataIndex: 'enterprise_name', render: (v: string | null, record: ILeadRow) => v || record.enterprise_org_id },
              {
                title: t('park.leads.source', '来源'),
                dataIndex: 'source',
                render: (v: string) => t(`park.leads.${v}`, v),
              },
              { title: t('park.common.score', '评分'), dataIndex: 'score', render: (v: number | null) => v ?? '-' },
              {
                title: t('park.common.status', '状态'),
                dataIndex: 'status',
                render: (v: string) => <Tag>{t(`park.status.${v}`, v)}</Tag>,
              },
              {
                title: t('park.leads.owner', '负责人'),
                dataIndex: 'owner_id',
                render: (v: string | null) => v ?? t('park.leads.noOwner', '未认领'),
              },
              {
                title: t('park.common.createdAt', '创建时间'),
                dataIndex: 'created_at',
                render: (v: number) => new Date(v).toLocaleString(),
              },
            ]}
          />
        )}
      </Card>
      <Modal
        title={t('park.leads.createManual', '新建线索')}
        visible={isCreateOpen}
        onOk={() => void createManual()}
        onCancel={() => setIsCreateOpen(false)}
      >
        <div className='space-y-3'>
          <Input
            placeholder={t('park.admin.organizations.enterpriseOrgId', '企业组织 ID')}
            value={enterpriseOrgId}
            onChange={setEnterpriseOrgId}
          />
          <Input placeholder={t('park.leads.notePlaceholder')} value={note} onChange={setNote} />
        </div>
      </Modal>
    </PageWrapper>
  );
}
