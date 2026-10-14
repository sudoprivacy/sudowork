/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Input, Message, Modal, Table } from '@arco-design/web-react';
import { IconPlus } from '@arco-design/web-react/icon';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { invokePark, useParkOrgId, useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

/** 系统运营——Assistant 分配（计划 3.5 admin 独立页）。 */

interface IAssignmentRow {
  assistant_id: string;
  enterprise_org_id: string;
}

export default function ParkAdminAssistantPage() {
  const { t } = useTranslation();
  const { parkOrgId } = useParkOrgId();
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignAssistantId, setAssignAssistantId] = useState('');
  const [assignEntId, setAssignEntId] = useState('');

  const assignments = useParkQuery<{ items: IAssignmentRow[] }>(
    'listAssignments',
    parkOrgId ? { parkOrgId } : undefined,
  );

  async function run(action: () => Promise<unknown>, successMsg: string) {
    try {
      await action();
      Message.success(successMsg);
    } catch (err) {
      Message.error(err instanceof Error ? err.message : t('park.leads.updateFailed', '操作失败'));
    }
  }

  return (
    <PageWrapper title={t('park.nav.adminAssistant', 'Assistant 分配')}>
      <Card
        title={t('park.admin.assistant.title', 'Assistant 分配')}
        extra={
          <Button size='small' icon={<IconPlus />} onClick={() => setAssignOpen(true)}>
            {t('park.admin.assistant.assign', '分配')}
          </Button>
        }
      >
        <Table
          rowKey={row => `${(row as IAssignmentRow).assistant_id}:${(row as IAssignmentRow).enterprise_org_id}`}
          data={(assignments.data?.items ?? []) as never}
          pagination={false}
          loading={assignments.loading}
          columns={[
            { title: t('park.admin.assistant.assistantId', 'Assistant ID'), dataIndex: 'assistant_id' },
            { title: t('park.admin.assistant.enterpriseOrgId', '企业组织 ID'), dataIndex: 'enterprise_org_id' },
            {
              title: t('park.common.actions', '操作'),
              render: (_: unknown, record: IAssignmentRow) => (
                <Button
                  size='mini'
                  status='danger'
                  onClick={() =>
                    void run(
                      () =>
                        invokePark('unassignAssistant', {
                          parkOrgId,
                          assistantId: record.assistant_id,
                          enterpriseOrgId: record.enterprise_org_id,
                        }),
                      t('park.admin.assistant.unassigned', '已取消分配'),
                    ).then(assignments.reload)
                  }
                >
                  {t('park.admin.assistant.unassign', '取消分配')}
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={t('park.admin.assistant.assign', '分配')}
        visible={assignOpen}
        onOk={() =>
          void run(
            () =>
              invokePark('assignAssistant', {
                parkOrgId,
                assistantId: assignAssistantId,
                enterpriseOrgId: assignEntId,
              }),
            t('park.admin.assistant.assigned', '已分配'),
          ).then(() => {
            setAssignOpen(false);
            setAssignAssistantId('');
            setAssignEntId('');
            assignments.reload();
          })
        }
        onCancel={() => setAssignOpen(false)}
      >
        <div className='space-y-3'>
          <Input
            placeholder={t('park.admin.assistant.assistantId', 'Assistant ID')}
            value={assignAssistantId}
            onChange={setAssignAssistantId}
          />
          <Input
            placeholder={t('park.admin.assistant.enterpriseOrgId', '企业组织 ID')}
            value={assignEntId}
            onChange={setAssignEntId}
          />
        </div>
      </Modal>
    </PageWrapper>
  );
}
