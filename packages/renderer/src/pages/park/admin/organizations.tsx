/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Input, Message, Modal, Table, Tag } from '@arco-design/web-react';
import { IconPlus } from '@arco-design/web-react/icon';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { invokePark, useParkOrgId, useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

/** 系统运营——组织与绑定（计划 3.5 admin 独立页）。 */

interface IBindingsRow {
  enterprise_org_id: string;
  lifecycle: string;
}

export default function ParkAdminOrganizationsPage() {
  const { t } = useTranslation();
  const { parkOrgId } = useParkOrgId();
  const [bindOpen, setBindOpen] = useState(false);
  const [bindOrgId, setBindOrgId] = useState('');

  const enterprises = useParkQuery<{ items: IBindingsRow[] }>(
    'listEnterprises',
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
    <PageWrapper title={t('park.nav.adminOrganizations', '组织与绑定')}>
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

      <Modal
        title={t('park.admin.organizations.bindEnterprise', '绑定企业')}
        visible={bindOpen}
        onOk={() =>
          void run(
            () => invokePark('createBinding', { parkOrgId, enterpriseOrgId: bindOrgId, lifecycle: 'prospect' }),
            t('park.admin.organizations.bound', '绑定成功'),
          ).then(() => {
            setBindOpen(false);
            setBindOrgId('');
            enterprises.reload();
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
    </PageWrapper>
  );
}
