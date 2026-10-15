/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Card, Table, Tooltip } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useParkOrgId, useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

/** 系统运营——审计日志（计划 3.5 admin 独立页）。 */

interface IAuditRow {
  audit_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  target_name: string | null;
  actor_user_id: string;
  actor_name: string | null;
  reason: string | null;
  created_at: number;
}

export default function ParkAdminAuditPage() {
  const { t } = useTranslation();
  const { parkOrgId } = useParkOrgId();

  const audits = useParkQuery<{ items: IAuditRow[] }>('listAuditEvents', parkOrgId ? { parkOrgId } : undefined);

  return (
    <PageWrapper title={t('park.nav.adminAudit', '审计日志')}>
      <Card title={t('park.admin.audit.title', '审计日志')}>
        <Table
          rowKey='audit_id'
          data={(audits.data?.items ?? []) as never}
          pagination={{ pageSize: 15 }}
          loading={audits.loading}
          columns={[
            { title: t('park.admin.audit.action', '操作'), dataIndex: 'action' },
            {
              title: t('park.admin.audit.target', '对象'),
              render: (_: unknown, record: IAuditRow) =>
                record.target_id ? (
                  <Tooltip content={record.target_id}>
                    <span>
                      {record.target_type}: {record.target_name || record.target_id}
                    </span>
                  </Tooltip>
                ) : (
                  record.target_type
                ),
            },
            {
              title: t('park.admin.audit.actor', '操作人'),
              dataIndex: 'actor_name',
              render: (v: string | null, record: IAuditRow) => (
                <Tooltip content={record.actor_user_id}>
                  <span>{v || record.actor_user_id}</span>
                </Tooltip>
              ),
            },
            { title: t('park.admin.audit.reason', '理由'), dataIndex: 'reason', render: (v: string | null) => v ?? '-' },
            {
              title: t('park.admin.audit.time', '时间'),
              dataIndex: 'created_at',
              render: (v: number) => new Date(v).toLocaleString(),
            },
          ]}
        />
      </Card>
    </PageWrapper>
  );
}
