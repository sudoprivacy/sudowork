/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { AutoComplete, Button, Card, Message, Modal, Select, Table, Tooltip } from '@arco-design/web-react';
import { IconPlus } from '@arco-design/web-react/icon';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { invokePark, useParkOrgId, useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

/** 系统运营——用户与角色（计划 3.5 admin 独立页）。 */

interface IMemberRow {
  user_id: string;
  user_name: string | null;
  park_role: string;
}

const ROLE_OPTIONS = ['park_leader', 'park_ops', 'park_system_operator'];

export default function ParkAdminUsersPage() {
  const { t } = useTranslation();
  const { parkOrgId } = useParkOrgId();
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberUserId, setMemberUserId] = useState('');
  const [memberRole, setMemberRole] = useState('park_ops');

  const members = useParkQuery<{ items: IMemberRow[] }>('listMembers', parkOrgId ? { parkOrgId } : undefined);
  // AutoComplete 一体式（计划 4.4 #15）：输入关键字即搜；直接键入 ID 原样提交（保底手输）
  const candidates = useParkQuery<{ items: Array<{ user_id: string; display_name: string }> }>('searchMemberCandidates', parkOrgId && memberQuery.trim() ? { parkOrgId, q: memberQuery.trim() } : undefined);

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
            {
              title: t('park.admin.users.userName', '用户'),
              dataIndex: 'user_name',
              render: (v: string | null, record: IMemberRow) => (
                <Tooltip content={record.user_id}>
                  <span>{v || record.user_id}</span>
                </Tooltip>
              ),
            },
            {
              title: t('park.admin.users.role', '园区角色'),
              dataIndex: 'park_role',
              render: (v: string) => t(`park.role.${v}`, v),
            },
            {
              title: t('park.common.actions', '操作'),
              render: (_: unknown, record: IMemberRow) => (
                <Button size='mini' status='danger' onClick={() => void run(() => invokePark('removeMember', { parkOrgId, userId: record.user_id }), t('park.admin.users.removed', '已移除')).then(members.reload)}>
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
          void run(() => invokePark('addMember', { parkOrgId, userId: memberUserId, parkRole: memberRole }), t('park.admin.users.added', '已添加')).then(() => {
            setMemberOpen(false);
            setMemberQuery('');
            setMemberUserId('');
            members.reload();
          })
        }
        onCancel={() => setMemberOpen(false)}
      >
        <div className='space-y-3'>
          <AutoComplete
            placeholder={t('park.admin.users.searchUserPlaceholder', '输入姓名 / 手机号 / 邮箱 / 用户 ID 搜索')}
            value={memberQuery}
            filterOption={false}
            onSearch={setMemberQuery}
            onChange={(value, option) => {
              if (!option) setMemberUserId(value);
            }}
            onSelect={(value) => {
              setMemberUserId(value);
              setMemberQuery(candidates.data?.items.find((candidate) => candidate.user_id === value)?.display_name ?? value);
            }}
            data={(candidates.data?.items ?? []).map((candidate) => ({
              value: candidate.user_id,
              name: candidate.display_name,
            }))}
          />
          <Select value={memberRole} onChange={setMemberRole}>
            {ROLE_OPTIONS.map((role) => (
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
