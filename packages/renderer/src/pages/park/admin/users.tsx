/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Input, Message, Modal, Select, Table } from '@arco-design/web-react';
import { IconPlus } from '@arco-design/web-react/icon';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { invokePark, useParkOrgId, useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

/** 系统运营——用户与角色（计划 3.5 admin 独立页）。 */

interface IMemberRow {
  user_id: string;
  park_role: string;
}

const ROLE_OPTIONS = ['park_leader', 'park_ops', 'park_system_operator'];

export default function ParkAdminUsersPage() {
  const { t } = useTranslation();
  const { parkOrgId } = useParkOrgId();
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberUserId, setMemberUserId] = useState('');
  const [memberRole, setMemberRole] = useState('park_ops');

  const members = useParkQuery<{ items: IMemberRow[] }>(
    'listMembers',
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
    <PageWrapper title={t('park.nav.adminUsers', '用户与角色')}>
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
                      t('park.admin.users.removed', '已移除'),
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

      <Modal
        title={t('park.admin.users.addMember', '添加成员')}
        visible={memberOpen}
        onOk={() =>
          void run(
            () => invokePark('addMember', { parkOrgId, userId: memberUserId, parkRole: memberRole }),
            t('park.admin.users.added', '已添加'),
          ).then(() => {
            setMemberOpen(false);
            setMemberUserId('');
            members.reload();
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
    </PageWrapper>
  );
}
