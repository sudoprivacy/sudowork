import { FileText, Sparkles } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import PageWrapper from '@renderer/components/base/PageWrapper';

export default function BidPage() {
  const { t } = useTranslation();

  return (
    <PageWrapper className='h-full' contentClassName='h-full flex flex-col' title={t('common.siderMenu.bidGeneration')}>
      <section className='flex w-full flex-1 flex-col items-center justify-center self-center px-6 text-center'>
        <div className='relative mb-10 h-44 w-52'>
          <div className='absolute left-4 top-5 h-36 w-28 -rotate-10 rounded-xl border border-shallow bg-muted shadow-sm' />
          <div className='absolute right-4 top-5 h-36 w-28 rotate-10 rounded-xl border border-shallow bg-muted shadow-sm' />

          <div className='absolute left-1/2 top-0 flex h-40 w-32 -translate-x-1/2 flex-col rounded-xl border border-medium bg-card p-5 shadow-xl'>
            <div className='mb-5 flex size-11 items-center justify-center rounded-xl bg-brand-surface text-brand'>
              <FileText size={24} strokeWidth={1.8} />
            </div>
            <div className='mb-3 h-2 w-18 rounded-full bg-fill-deep' />
            <div className='mb-2 h-1.5 w-full rounded-full bg-fill-medium' />
            <div className='mb-2 h-1.5 w-4/5 rounded-full bg-fill-medium' />
            <div className='h-1.5 w-3/5 rounded-full bg-fill-medium' />
          </div>

          <div className='absolute right-2 top-1 flex size-9 items-center justify-center rounded-full border border-shallow bg-card text-brand shadow-md'>
            <Sparkles size={17} />
          </div>
        </div>

        <p className='m-0 text-18px font-500 text-foreground'>{t('common.comingSoon')}</p>
      </section>
    </PageWrapper>
  );
}
