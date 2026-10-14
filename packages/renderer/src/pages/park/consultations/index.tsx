/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Card, DatePicker, Select, Space, Table, Tag, Typography } from '@arco-design/web-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParkOrgId, useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

interface IConsultationRow {
  inquiry_id: string;
  enterprise_name?: string;
  enterprise_org_id: string;
  redacted_question: string | null;
  redacted_answer: string | null;
  category: 'consultation' | 'service_request';
  intent: string | null;
  confidence: number | null;
  hasLead?: boolean;
  created_at: number;
}

interface IEnterpriseRow {
  enterprise_org_id: string;
  enterprise_name: string;
}

const DAY_END_MS = 24 * 60 * 60 * 1000 - 1;

export default function ParkConsultationsPage() {
  const { t } = useTranslation();
  const { parkOrgId } = useParkOrgId();
  const [enterpriseOrgId, setEnterpriseOrgId] = useState<string | undefined>(undefined);
  const [dateRange, setDateRange] = useState<[string, string] | undefined>(undefined);
  const enterprises = useParkQuery<{ items: IEnterpriseRow[] }>('listEnterprises', parkOrgId ? { parkOrgId } : undefined);
  const { data, loading, error } = useParkQuery<{ items: IConsultationRow[] }>(
    'listConsultations',
    parkOrgId
      ? {
          parkOrgId,
          ...(enterpriseOrgId ? { enterpriseOrgId } : {}),
          ...(dateRange?.[0] ? { afterCreatedAt: new Date(dateRange[0]).getTime() } : {}),
          ...(dateRange?.[1] ? { beforeCreatedAt: new Date(dateRange[1]).getTime() + DAY_END_MS } : {}),
        }
      : undefined
  );

  return (
    <PageWrapper title={t('park.consultations.title', '咨询摘要')}>
      <Card loading={loading}>
        {error ? (
          <Typography.Text type='error'>
            {t('park.common.loadFailed', '加载失败')}: {error}
          </Typography.Text>
        ) : (
          <>
            <Space className='mb-3'>
              <Select
                style={{ width: 220 }}
                showSearch
                allowClear
                value={enterpriseOrgId}
                placeholder={t('park.consultations.filterEnterprise', '按企业筛选')}
                onChange={(v) => setEnterpriseOrgId(v || undefined)}
                options={(enterprises.data?.items ?? []).map((enterprise) => ({
                  value: enterprise.enterprise_org_id,
                  label: enterprise.enterprise_name,
                }))}
              />
              <DatePicker.RangePicker
                style={{ width: 260 }}
                allowClear
                format='YYYY-MM-DD'
                onChange={(dateString) => {
                  const [start, end] = Array.isArray(dateString) ? dateString : [undefined, undefined];
                  setDateRange(start && end ? [start, end] : undefined);
                }}
              />
            </Space>
            <Table
              rowKey='inquiry_id'
              data={(data?.items ?? []) as never}
              pagination={{ pageSize: 20 }}
              columns={[
                { title: t('park.common.enterprise', '企业'), dataIndex: 'enterprise_name' },
                {
                  title: t('park.consultations.question', '咨询内容（脱敏）'),
                  dataIndex: 'redacted_question',
                  render: (v: string | null) => <span className='text-13px'>{v ?? '-'}</span>,
                },
                {
                  title: t('park.consultations.intent', '意图'),
                  dataIndex: 'intent',
                  render: (v: string | null) => v ?? '-',
                },
                { title: t('park.consultations.confidence', '置信度'), dataIndex: 'confidence', render: (v: number | null) => v ?? '-' },
                {
                  title: t('park.common.status', '状态'),
                  dataIndex: 'hasLead',
                  render: (v: boolean | undefined) => (v ? <Tag color='green'>{t('park.consultations.hasLead', '已产生线索')}</Tag> : <Tag>{t('park.consultations.noLead', '未产生线索')}</Tag>),
                },
                {
                  title: t('park.common.createdAt', '创建时间'),
                  dataIndex: 'created_at',
                  render: (v: number) => new Date(v).toLocaleString(),
                },
              ]}
            />
          </>
        )}
      </Card>
    </PageWrapper>
  );
}
