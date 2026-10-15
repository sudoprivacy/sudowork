/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Card, Statistic, Table, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useParkOrgId, useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

interface IParkMetrics {
  funnel: Record<string, number>;
  lead_status: Record<string, number>;
  high_score_leads: Array<{ lead_id: string; enterprise_org_id: string; enterprise_name: string | null; score: number; status: string }>;
  totals: { enterprises: number; inquiries: number; leads: number };
}

const FUNNEL_ORDER = ['prospect', 'active', 'exiting', 'exited'];

export default function ParkOverviewPage() {
  const { t } = useTranslation();
  const { parkOrgId } = useParkOrgId();
  const { data, loading, error } = useParkQuery<IParkMetrics>('getMetrics', parkOrgId ? { parkOrgId } : undefined);

  return (
    <PageWrapper title={t('park.overview.title', '园区总览')}>
      {error ? (
        <Typography.Text type='error'>
          {t('park.common.loadFailed', '加载失败')}: {error}
        </Typography.Text>
      ) : (
        <div className='space-y-4'>
          <div className='grid grid-cols-3 gap-4'>
            <Card loading={loading}>
              <Statistic title={t('park.overview.enterprises', '企业')} value={data?.totals?.enterprises ?? 0} />
            </Card>
            <Card loading={loading}>
              <Statistic title={t('park.overview.inquiries', '咨询')} value={data?.totals?.inquiries ?? 0} />
            </Card>
            <Card loading={loading}>
              <Statistic title={t('park.overview.leads', '线索')} value={data?.totals?.leads ?? 0} />
            </Card>
          </div>
          <Card title={t('park.overview.funnel', '招留管退漏斗')} loading={loading}>
            <div className='flex gap-4'>
              {FUNNEL_ORDER.map((stage) => (
                <div key={stage} className='flex flex-col items-center gap-1'>
                  <Tag color='arcoblue'>{data?.funnel?.[stage] ?? 0}</Tag>
                  <span className='text-13px text-secondary'>{t(`park.status.${stage}`, stage)}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title={t('park.overview.leadStatus', '线索状态分布')} loading={loading}>
            <div className='flex flex-wrap gap-3'>
              {Object.entries(data?.lead_status ?? {}).map(([status, count]) => (
                <Tag key={status}>
                  {t(`park.status.${status}`, status)}: {count}
                </Tag>
              ))}
            </div>
          </Card>
          <Card title={t('park.overview.highScore', '高意向线索')} loading={loading}>
            <Table
              rowKey='lead_id'
              data={(data?.high_score_leads ?? []) as never}
              pagination={false}
              columns={[
                {
                  title: t('park.common.enterprise', '企业'),
                  dataIndex: 'enterprise_name',
                  render: (v: string | null, record: { enterprise_org_id: string }) => v || record.enterprise_org_id,
                },
                { title: t('park.common.score', '评分'), dataIndex: 'score' },
                {
                  title: t('park.common.status', '状态'),
                  dataIndex: 'status',
                  render: (v: string) => t(`park.status.${v}`, v),
                },
              ]}
            />
          </Card>
        </div>
      )}
    </PageWrapper>
  );
}
