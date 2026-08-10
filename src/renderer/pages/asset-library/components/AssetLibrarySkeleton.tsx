import { Skeleton } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

const PLACEHOLDERS = [0, 1, 2, 3, 4, 5];

export default function AssetLibrarySkeleton() {
  const { t } = useTranslation();

  return (
    <div role='status' aria-label={t('common.loading')} className='flex flex-col gap-8'>
      <section aria-hidden='true'>
        <div className='mb-3 flex items-center gap-2'>
          <Skeleton animation text={false} image={{ style: { width: 48, height: 16, borderRadius: 4, marginRight: 0 } }} />
          <Skeleton animation text={false} image={{ style: { width: 16, height: 14, borderRadius: 4, marginRight: 0 } }} />
          <div className='h-px flex-1 bg-border' />
        </div>
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {PLACEHOLDERS.map((item) => (
            <div key={item} data-testid='asset-library-skeleton-item' className='box-border flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-3 py-3'>
              <Skeleton animation text={false} image={{ style: { width: 26, height: 26, borderRadius: 6, marginRight: 0 } }} className='shrink-0' />
              <div className='min-w-0 flex-1'>
                <Skeleton animation text={{ rows: 1, width: '58%' }} image={false} />
                <div className='mt-2'>
                  <Skeleton animation text={{ rows: 1, width: '82%' }} image={false} />
                </div>
              </div>
              <div className='flex shrink-0 flex-col items-end gap-2'>
                <Skeleton animation text={false} image={{ style: { width: 44, height: 18, borderRadius: 9, marginRight: 0 } }} />
                <Skeleton animation text={false} image={{ style: { width: 28, height: 28, borderRadius: 6, marginRight: 0 } }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
