/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Message, Modal, Select, Table, Tag, Tooltip } from '@arco-design/web-react';
import { IconPlus } from '@arco-design/web-react/icon';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { invokePark, useParkOrgId, useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

/** 系统运营——组织与绑定（计划 3.5 admin 独立页）。 */

interface IBindingsRow {
  enterprise_org_id: string;
  enterprise_name: string;
  lifecycle: string;
}

export default function ParkAdminOrganizationsPage() {
  const { t } = useTranslation();
  const { parkOrgId } = useParkOrgId();
  const [bindOpen, setBindOpen] = useState(false);
  const [bindOrgId, setBindOrgId] = useState('');

  const enterprises = useParkQuery<{ items: IBindingsRow[] }>('listEnterprises', parkOrgId ? { parkOrgId } : undefined);
  const bindableCandidates = useParkQuery<{ items: Array<{ enterprise_org_id: string; display_name: string }> }>('listBindableEnterprises', parkOrgId ? { parkOrgId } : undefined);

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
          <Button
            size='small'
            icon={<IconPlus />}
            onClick={() => {
              bindableCandidates.reload();
              setBindOpen(true);
            }}
          >
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
            {
              title: t('park.admin.organizations.enterpriseName', '企业名称'),
              dataIndex: 'enterprise_name',
              render: (v: string | null | undefined, record: IBindingsRow) => (
                <Tooltip content={record.enterprise_org_id}>
                  <span>{v || record.enterprise_org_id}</span>
                </Tooltip>
              ),
            },
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
          void run(() => invokePark('createBinding', { parkOrgId, enterpriseOrgId: bindOrgId, lifecycle: 'prospect' }), t('park.admin.organizations.bound', '绑定成功')).then(() => {
            setBindOpen(false);
            setBindOrgId('');
            enterprises.reload();
          })
        }
        onCancel={() => setBindOpen(false)}
      >
        <Select
          showSearch
          placeholder={t('park.admin.organizations.selectEnterprise', '搜索并选择企业')}
          value={bindOrgId || undefined}
          onChange={(value) => setBindOrgId(value ? String(value) : '')}
          filterOption={(inputValue, option) =>
            String((option.props as { children?: string }).children ?? '')
              .toLowerCase()
              .includes(inputValue.toLowerCase())
          }
          options={(bindableCandidates.data?.items ?? []).map((candidate) => ({
            value: candidate.enterprise_org_id,
            label: candidate.display_name,
          }))}
        />
      </Modal>
    </PageWrapper>
  );
}
