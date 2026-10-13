/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Card, Table, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useParkOrgId, useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

interface IEnterpriseRow {
  enterprise_org_id: string;
  enterprise_name: string;
  lifecycle: string;
  industry?: string | null;
  contact_name?: string | null;
  tags: string[];
  created_at: number;
}

export default function ParkEnterprisesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { parkOrgId } = useParkOrgId();
  const { data, loading, error } = useParkQuery<{ items: IEnterpriseRow[] }>(
    'listEnterprises',
    parkOrgId ? { parkOrgId } : undefined,
  );

  return (
    <PageWrapper title={t('park.enterprises.title', '企业列表')}>
      <Card loading={loading}>
        {error ? (
          <Typography.Text type='error'>{t('park.common.loadFailed', '加载失败')}: {error}</Typography.Text>
        ) : (
          <Table
            rowKey='enterprise_org_id'
            data={(data?.items ?? []) as never}
            pagination={{ pageSize: 20 }}
            onRow={record => ({
              onClick: () => navigate(`/park/enterprises/${String((record as IEnterpriseRow).enterprise_org_id)}`),
            })}
            columns={[
              { title: t('park.enterprises.name', '企业名称'), dataIndex: 'enterprise_name' },
              {
                title: t('park.enterprises.lifecycle', '生命周期'),
                dataIndex: 'lifecycle',
                render: (v: string) => <Tag>{t(`park.status.${v}`, v)}</Tag>,
              },
              { title: t('park.enterprises.industry', '行业'), dataIndex: 'industry', render: (v: string | null | undefined) => v ?? '-' },
              { title: t('park.enterprises.contact', '联系人'), dataIndex: 'contact_name', render: (v: string | null | undefined) => v ?? '-' },
              {
                title: t('park.enterprises.tags', '标签'),
                dataIndex: 'tags',
                render: (v: string[]) => v.join(', ') || '-',
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
    </PageWrapper>
  );
}
