import React from 'react';
import { useTranslation } from 'react-i18next';
import PageWrapper from '@renderer/components/base/PageWrapper';

export default function AssetLibraryPage() {
  const { t } = useTranslation();

  return (
    <PageWrapper className='h-full' title={t('common.siderMenu.assetLibrary')}>
      <div />
    </PageWrapper>
  );
}
