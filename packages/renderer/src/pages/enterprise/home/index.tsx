/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

interface IEnterpriseHomeProfile {
  enterprise_name: string;
  lifecycle: string;
  industry: string | null;
  contact_name: string | null;
}

export default function EnterpriseHomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, loading, error } = useParkQuery<IEnterpriseHomeProfile>('getEnterpriseProfile');

  return (
    <PageWrapper title={t('park.nav.enterpriseHome', '企业工作台')}>
      <Card loading={loading}>
        {error ? (
          <Typography.Text type='error'>{t('park.common.loadFailed', '加载失败')}: {error}</Typography.Text>
        ) : data ? (
          <div className='space-y-2'>
            <Typography.Title heading={5}>{data.enterprise_name}</Typography.Title>
            <div className='text-13px text-secondary'>
              {t('park.status.' + data.lifecycle, data.lifecycle)}
              {data.industry ? ` · ${data.industry}` : ''}
              {data.contact_name ? ` · ${data.contact_name}` : ''}
            </div>
            <div className='flex gap-3 pt-2'>
              <Button type='text' onClick={() => navigate('/enterprise/assistant')}>
                {t('park.nav.assistant', '园区咨询')}
              </Button>
              <Button type='text' onClick={() => navigate('/enterprise/policies')}>
                {t('park.nav.policies', '政策信息')}
              </Button>
              <Button type='text' onClick={() => navigate('/enterprise/inquiries')}>
                {t('park.nav.inquiries', '我的咨询记录')}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </PageWrapper>
  );
}
