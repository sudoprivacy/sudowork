/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Card, Table, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

interface IInquiriesResponse {
  items: Array<{
    inquiry_id: string;
    redacted_question: string | null;
    redacted_answer: string | null;
    category: 'consultation' | 'service_request';
    intent: string | null;
    confidence: number | null;
    created_at: number;
  }>;
}

export default function EnterpriseInquiriesPage() {
  const { t } = useTranslation();
  const { data, loading, error } = useParkQuery<IInquiriesResponse>('getEnterpriseInquiries');

  return (
    <PageWrapper title={t('park.nav.inquiries', '我的咨询记录')}>
      <Card loading={loading}>
        {error ? (
          <Typography.Text type='error'>{t('park.common.loadFailed', '加载失败')}: {error}</Typography.Text>
        ) : (
          <Table
            rowKey='inquiry_id'
            data={(data?.items ?? []) as never}
            columns={[
              {
                title: t('park.inquiries.question', '我的提问'),
                dataIndex: 'redacted_question',
                render: (v: string | null) => <span className='text-13px'>{v ?? '-'}</span>,
              },
              {
                title: t('park.inquiries.answer', '园区答复'),
                dataIndex: 'redacted_answer',
                render: (v: string | null) => <span className='text-13px'>{v ?? '-'}</span>,
              },
              {
                title: t('park.common.status', '状态'),
                dataIndex: 'category',
                render: (v: string) => (
                  <Tag>{t(`park.consultations.category.${v}`, v)}</Tag>
                ),
              },
              {
                title: t('park.inquiries.time', '咨询时间'),
                dataIndex: 'created_at',
                render: (v: number) => new Date(v).toLocaleString(),
              },
            ]}
          />
        )}
      </Card>
    </PageWrapper>
  );
}
