/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Card, Table, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

interface IServiceCatalog {
  version: string;
  items: Array<{ name: string; description?: string }>;
}

export default function EnterpriseServicesPage() {
  const { t } = useTranslation();
  const { data, loading, error } = useParkQuery<IServiceCatalog>('getEnterpriseServices');

  return (
    <PageWrapper title={t('park.nav.services', '入驻服务')}>
      <Card loading={loading}>
        {error ? (
          <Typography.Text type='error'>{t('park.common.loadFailed', '加载失败')}: {error}</Typography.Text>
        ) : (
          <Table
            rowKey='name'
            data={(data?.items ?? []) as never}
            pagination={false}
            columns={[
              { title: t('park.services.name', '服务名称'), dataIndex: 'name' },
              { title: t('park.services.description', '服务说明'), dataIndex: 'description' },
            ]}
          />
        )}
      </Card>
    </PageWrapper>
  );
}
