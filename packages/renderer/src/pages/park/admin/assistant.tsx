/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Message, Modal, Select, Table, Tooltip } from '@arco-design/web-react';
import { IconPlus } from '@arco-design/web-react/icon';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { invokePark, useParkOrgId, useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

/** 系统运营——Assistant 分配（计划 3.5 admin 独立页）。 */

interface IAssignmentRow {
  assistant_id: string;
  assistant_name: string | null;
  enterprise_org_id: string;
  enterprise_name: string | null;
}

interface IAssistantCandidate {
  assistant_id: string;
  name: string;
  display_name: string;
}

export default function ParkAdminAssistantPage() {
  const { t } = useTranslation();
  const { parkOrgId } = useParkOrgId();
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignAssistantId, setAssignAssistantId] = useState('');
  const [assignEntId, setAssignEntId] = useState('');

  const assignments = useParkQuery<{ items: IAssignmentRow[] }>('listAssignments', parkOrgId ? { parkOrgId } : undefined);
  const assistantCandidates = useParkQuery<{ items: IAssistantCandidate[] }>('listAssistantCandidates', parkOrgId ? { parkOrgId } : undefined);
  const enterpriseCandidates = useParkQuery<{ items: Array<{ enterprise_org_id: string; enterprise_name: string }> }>('listEnterprises', parkOrgId ? { parkOrgId } : undefined);

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
          rowKey={(row) => `${(row as IAssignmentRow).assistant_id}:${(row as IAssignmentRow).enterprise_org_id}`}
          data={(assignments.data?.items ?? []) as never}
          pagination={false}
          loading={assignments.loading}
          columns={[
            {
              title: t('park.admin.assistant.assistantName', '助手名称'),
              dataIndex: 'assistant_name',
              render: (v: string | null, record: IAssignmentRow) => (
                <Tooltip content={record.assistant_id}>
                  <span>{v || record.assistant_id}</span>
                </Tooltip>
              ),
            },
            {
              title: t('park.admin.assistant.enterpriseName', '企业名称'),
              dataIndex: 'enterprise_name',
              render: (v: string | null, record: IAssignmentRow) => (
                <Tooltip content={record.enterprise_org_id}>
                  <span>{v || record.enterprise_org_id}</span>
                </Tooltip>
              ),
            },
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
                      t('park.admin.assistant.unassigned', '已取消分配')
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
            t('park.admin.assistant.assigned', '已分配')
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
          <Select
            showSearch
            placeholder={t('park.admin.assistant.selectAssistant', '搜索并选择助手')}
            value={assignAssistantId || undefined}
            onChange={(value) => setAssignAssistantId(value ? String(value) : '')}
            filterOption={(inputValue, option) =>
              String((option.props as { children?: string }).children ?? '')
                .toLowerCase()
                .includes(inputValue.toLowerCase())
            }
            options={(assistantCandidates.data?.items ?? []).map((candidate) => ({
              value: candidate.assistant_id,
              label: candidate.display_name || candidate.name,
            }))}
          />
          <Select
            showSearch
            placeholder={t('park.admin.assistant.selectEnterprise', '搜索并选择企业')}
            value={assignEntId || undefined}
            onChange={(value) => setAssignEntId(value ? String(value) : '')}
            filterOption={(inputValue, option) =>
              String((option.props as { children?: string }).children ?? '')
                .toLowerCase()
                .includes(inputValue.toLowerCase())
            }
            options={(enterpriseCandidates.data?.items ?? []).map((candidate) => ({
              value: candidate.enterprise_org_id,
              label: candidate.enterprise_name,
            }))}
          />
        </div>
      </Modal>
    </PageWrapper>
  );
}
