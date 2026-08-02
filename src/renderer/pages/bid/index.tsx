import { FileSearch, FileText, ListChecks, ShieldCheck, Sparkles, WandSparkles, Workflow } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import PageWrapper from '@renderer/components/base/PageWrapper';

export default function BidPage() {
  const { t } = useTranslation();

  const workflow = [
    {
      icon: FileSearch,
      title: t('common.bid.importTitle'),
      description: t('common.bid.importDescription'),
    },
    {
      icon: ListChecks,
      title: t('common.bid.outlineTitle'),
      description: t('common.bid.outlineDescription'),
    },
    {
      icon: WandSparkles,
      title: t('common.bid.generateTitle'),
      description: t('common.bid.generateDescription'),
    },
  ];

  const capabilities = [t('common.bid.requirementExtraction'), t('common.bid.outlinePlanning'), t('common.bid.riskReview'), t('common.bid.documentExport')];

  return (
    <PageWrapper className='h-full' title={t('common.siderMenu.bidGeneration')}>
      <section className='py-6'>
        <div className='grid min-h-64 grid-cols-1 items-center gap-8 md:grid-cols-[1fr_18rem]'>
          <div className='max-w-130'>
            <div className='mb-4 inline-flex items-center gap-1.5 rounded-full bg-brand-surface px-3 py-1 text-12px text-brand font-500'>
              <Sparkles size={14} />
              {t('common.bid.status')}
            </div>
            <h3 className='m-0 text-28px text-foreground font-600 leading-tight'>{t('common.bid.headline')}</h3>
            <p className='mb-0 mt-4 max-w-120 text-14px text-foreground-secondary leading-6'>{t('common.bid.description')}</p>
          </div>

          <div className='relative mx-auto h-44 w-52'>
            <div className='absolute left-4 top-5 h-36 w-28 -rotate-10 rounded-xl border border-shallow bg-muted' />
            <div className='absolute right-4 top-5 h-36 w-28 rotate-10 rounded-xl border border-shallow bg-muted' />
            <div className='absolute left-1/2 top-0 flex h-40 w-32 -translate-x-1/2 flex-col rounded-xl border border-medium bg-card p-5'>
              <div className='mb-5 flex size-11 items-center justify-center rounded-xl bg-brand-surface text-brand'>
                <FileText size={24} strokeWidth={1.8} />
              </div>
              <div className='mb-3 h-2 w-18 rounded-full bg-fill-deep' />
              <div className='mb-2 h-1.5 w-full rounded-full bg-fill-medium' />
              <div className='mb-2 h-1.5 w-4/5 rounded-full bg-fill-medium' />
              <div className='h-1.5 w-3/5 rounded-full bg-fill-medium' />
            </div>
            <div className='absolute right-2 top-1 flex size-9 items-center justify-center rounded-full border border-shallow bg-card text-brand'>
              <Sparkles size={17} />
            </div>
          </div>
        </div>
      </section>

      <section className='py-7'>
        <h3 className='mb-5 mt-0 flex items-center gap-2 text-16px text-foreground font-600'>
          <Workflow size={18} className='text-brand' />
          {t('common.bid.workflowTitle')}
        </h3>
        <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
          {workflow.map(({ icon: Icon, title, description }) => (
            <div key={title} className='flex items-start gap-3 py-2 md:pr-6'>
              <div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand'>
                <Icon size={18} strokeWidth={1.8} />
              </div>
              <div className='min-w-0 pt-0.5'>
                <div className='text-14px text-foreground font-500'>{title}</div>
                <p className='mb-0 mt-1.5 text-12px text-foreground-secondary leading-5'>{description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className='py-7'>
        <h3 className='mb-5 mt-0 flex items-center gap-2 text-16px text-foreground font-600'>
          <ShieldCheck size={18} className='text-brand' />
          {t('common.bid.capabilities')}
        </h3>
        <div className='flex flex-wrap items-center gap-2'>
          {capabilities.map((capability) => (
            <span key={capability} className='rounded-full bg-secondary px-3 py-1 text-12px text-foreground-secondary'>
              {capability}
            </span>
          ))}
        </div>
      </section>
    </PageWrapper>
  );
}
