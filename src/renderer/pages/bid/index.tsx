import { FileText } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import EmptyState from '@renderer/components/base/EmptyState';

export default function BidPage() {
  const { t } = useTranslation();

  return (
    <div className='size-full f-center'>
      <EmptyState simple icon={<FileText size={56} className='text-secondary' />} title={t('common.siderMenu.bidGeneration')} description={t('common.comingSoon')} />
    </div>
  );
}
