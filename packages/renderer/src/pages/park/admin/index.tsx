/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Input, Message, Modal, Table, Tag, Typography } from '@arco-design/web-react';
import { IconPlus } from '@arco-design/web-react/icon';
import { Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { invokePark, useParkOrgId, useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

/** 系统运营管理页（P0 合并为单页分区：绑定 / 角色分配 / Assistant 分配 / 政策说明 / 审计）。 */

interface IBindingsRow {
  enterprise_org_id: string;
  lifecycle: string;
}

interface IMemberRow {
  user_id: string;
  park_role: string;
}

interface IAssignmentRow {
  assistant_id: string;
  enterprise_org_id: string;
}

interface IAuditRow {
  audit_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  actor_user_id: string;
  reason: string | null;
  created_at: number;
}

const ROLE_OPTIONS = ['park_leader', 'park_ops', 'park_system_operator']

export default function ParkAdminPage() {
  const { t } = useTranslation();
  const { parkOrgId } = useParkOrgId();
  const [bindOpen, setBindOpen] = useState(false)
  const [bindOrgId, setBindOrgId] = useState('')
  const [memberOpen, setMemberOpen] = useState(false)
  const [memberUserId, setMemberUserId] = useState('')
  const [memberRole, setMemberRole] = useState('park_ops')
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignAssistantId, setAssignAssistantId] = useState('')
  const [assignEntId, setAssignEntId] = useState('')

  const args = parkOrgId ? { parkOrgId } : undefined
  const enterprises = useParkQuery<{ items: IBindingsRow[] }>(
    'listEnterprises', args)
  const members = useParkQuery<{ items: IMemberRow[] }>('listMembers', args)
  const assignments = useParkQuery<{ items: IAssignmentRow[] }>('listAssignments', args)
  const audits = useParkQuery<{ items: IAuditRow[] }>('listAuditEvents', args)

  async function run(action: () => Promise<unknown>, successMsg: string) {
    try {
      await action()
      Message.success(successMsg)
    } catch (err) {
      Message.error(err instanceof Error ? err.message : t('park.leads.updateFailed', '操作失败'))
    }
  }

  return (
    <PageWrapper title={t('park.nav.admin', '系统管理')}>
      <div className='space-y-4'>
        <Card
          title={t('park.admin.organizations.title', '组织与绑定')}
          extra={
            <Button size='small' icon={<IconPlus />} onClick={() => setBindOpen(true)}>
              {t('park.admin.organizations.bindEnterprise', '绑定企业')}
            </Button>
          }
        >
          <Table
            rowKey='enterprise_org_id'
            data={(enterprises.data?.items ?? []) as never}
            pagination={false}
            loading={enterprises.loading}
            columns={[
              { title: t('park.admin.organizations.enterpriseOrgId', '企业组织 ID'), dataIndex: 'enterprise_org_id' },
              {
                title: t('park.admin.organizations.lifecycle', '生命周期'),
                dataIndex: 'lifecycle',
                render: (v: string) => <Tag>{t(`park.status.${v}`, v)}</Tag>,
              },
            ]}
          />
        </Card>

        <Card
          title={t('park.admin.users.title', '用户与角色')}
          extra={
            <Button size='small' icon={<IconPlus />} onClick={() => setMemberOpen(true)}>
              {t('park.admin.users.addMember', '添加成员')}
            </Button>
          }
        >
          <Table
            rowKey='user_id'
            data={(members.data?.items ?? []) as never}
            pagination={false}
            loading={members.loading}
            columns={[
              { title: t('park.admin.users.userId', '用户 ID'), dataIndex: 'user_id' },
              {
                title: t('park.admin.users.role', '园区角色'),
                dataIndex: 'park_role',
                render: (v: string) => t(`park.role.${v}`, v),
              },
              {
                title: t('park.common.actions', '操作'),
                render: (_: unknown, record: IMemberRow) => (
                  <Button
                    size='mini'
                    status='danger'
                    onClick={() =>
                      void run(
                        () => invokePark('removeMember', { parkOrgId, userId: record.user_id }),
                        t('park.admin.users.added', '已添加'),
                      ).then(members.reload)
                    }
                  >
                    {t('park.admin.users.remove', '移除')}
                  </Button>
                ),
              },
            ]}
          />
        </Card>

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
                        t('park.admin.users.added', '已添加'),
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

        <Card title={t('park.admin.policies.title', '政策知识库')}>
          <Typography.Paragraph type='secondary' className='text-13px'>
            {t('park.admin.policies.uploadNote', '')}
          </Typography.Paragraph>
          <Typography.Paragraph type='secondary' className='text-13px'>
            {t('park.admin.policies.rebuildNote', '')}
          </Typography.Paragraph>
        </Card>

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
                  `${record.target_type}${record.target_id ? `:${record.target_id}` : ''}`,
              },
              { title: t('park.admin.audit.actor', '操作人'), dataIndex: 'actor_user_id' },
              { title: t('park.admin.audit.reason', '理由'), dataIndex: 'reason', render: (v: string | null) => v ?? '-' },
              {
                title: t('park.admin.audit.time', '时间'),
                dataIndex: 'created_at',
                render: (v: number) => new Date(v).toLocaleString(),
              },
            ]}
          />
        </Card>
      </div>

      <Modal
        title={t('park.admin.organizations.bindEnterprise', '绑定企业')}
        visible={bindOpen}
        onOk={() =>
          void run(
            () => invokePark('createBinding', { parkOrgId, enterpriseOrgId: bindOrgId, lifecycle: 'prospect' }),
            t('park.admin.organizations.bound', '绑定成功'),
          ).then(() => {
            setBindOpen(false)
            setBindOrgId('')
            enterprises.reload()
          })
        }
        onCancel={() => setBindOpen(false)}
      >
        <Input
          placeholder={t('park.admin.organizations.enterpriseOrgId', '企业组织 ID')}
          value={bindOrgId}
          onChange={setBindOrgId}
        />
      </Modal>

      <Modal
        title={t('park.admin.users.addMember', '添加成员')}
        visible={memberOpen}
        onOk={() =>
          void run(
            () => invokePark('addMember', { parkOrgId, userId: memberUserId, parkRole: memberRole }),
            t('park.admin.users.added', '已添加'),
          ).then(() => {
            setMemberOpen(false)
            setMemberUserId('')
            members.reload()
          })
        }
        onCancel={() => setMemberOpen(false)}
      >
        <div className='space-y-3'>
          <Input placeholder={t('park.admin.users.userId', '用户 ID')} value={memberUserId} onChange={setMemberUserId} />
          <Select value={memberRole} onChange={setMemberRole}>
            {ROLE_OPTIONS.map(role => (
              <Select.Option key={role} value={role}>
                {t(`park.role.${role}`, role)}
              </Select.Option>
            ))}
          </Select>
        </div>
      </Modal>

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
            t('park.admin.users.added', '已添加'),
          ).then(() => {
            setAssignOpen(false)
            setAssignAssistantId('')
            setAssignEntId('')
            assignments.reload()
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
