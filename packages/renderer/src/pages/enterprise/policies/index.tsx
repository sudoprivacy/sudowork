/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Card, List, Typography } from '@arco-design/web-react';
import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

interface IPolicyWiki {
  wikis: Array<{ wiki_id: string; wiki_name: string; files: string[] }>;
}

export default function EnterprisePoliciesPage() {
  const { t } = useTranslation();
  const { data, loading, error } = useParkQuery<IPolicyWiki>('getEnterprisePolicies');

  return (
    <PageWrapper title={t('park.nav.policies', '政策信息')}>
      <Card loading={loading}>
        {error ? (
          <Typography.Text type='error'>{t('park.common.loadFailed', '加载失败')}: {error}</Typography.Text>
        ) : (
          (data?.wikis ?? []).map(wiki => (
            <div key={wiki.wiki_id} className='mb-4'>
              <Typography.Title heading={6}>{wiki.wiki_name}</Typography.Title>
              <List
                dataSource={wiki.files}
                render={(file: string) => (
                  <List.Item key={file}>
                    <div className='flex items-center gap-2 text-13px'>
                      <FileText size={14} className='text-secondary' />
                      {file}
                    </div>
                  </List.Item>
                )}
              />
            </div>
          ))
        )}
      </Card>
    </PageWrapper>
  );
}
