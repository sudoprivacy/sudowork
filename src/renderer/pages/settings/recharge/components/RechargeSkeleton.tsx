import { Skeleton } from '@arco-design/web-react';
import React from 'react';

const PANEL_CLASS = 'border border-border bg-card p-6 rd-16px';
const PLACEHOLDERS = [0, 1, 2];

export default function RechargeSkeleton({ variant }: IRechargeSkeletonProps) {
  if (variant === 'points') {
    return (
      <div className={PANEL_CLASS} aria-hidden='true'>
        <Skeleton animation text={false} image={{ style: { width: 72, height: 17, borderRadius: 4, marginRight: 0, marginBottom: 24 } }} />
        <div className='grid grid-cols-3'>
          {PLACEHOLDERS.map((item) => (
            <div key={item} className='flex flex-col gap-2'>
              <Skeleton animation text={false} image={{ style: { width: 64, height: 16, borderRadius: 4, marginRight: 0 } }} />
              <Skeleton animation text={false} image={{ style: { width: 112, height: 32, borderRadius: 6, marginRight: 0 } }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={PANEL_CLASS} aria-hidden='true'>
      <Skeleton animation text={false} image={{ style: { width: 112, height: 17, borderRadius: 4, marginRight: 0, marginBottom: 16 } }} />
      <div className='grid grid-cols-3 gap-3'>
        {PLACEHOLDERS.map((item) => (
          <Skeleton key={item} animation text={false} image={{ style: { width: '100%', height: 88, borderRadius: 12, marginRight: 0 } }} />
        ))}
      </div>
      <div className='pt-4'>
        <Skeleton animation text={false} image={{ style: { width: 64, height: 17, borderRadius: 4, marginRight: 0, marginBottom: 12 } }} />
        <div className='flex gap-6'>
          {PLACEHOLDERS.slice(0, 2).map((item) => (
            <Skeleton key={item} animation text={false} image={{ style: { width: 104, height: 36, borderRadius: 12, marginRight: 0 } }} />
          ))}
        </div>
      </div>
      <div className='flex justify-end pt-4'>
        <Skeleton animation text={false} image={{ style: { width: 88, height: 32, borderRadius: 4, marginRight: 0 } }} />
      </div>
    </div>
  );
}

interface IRechargeSkeletonProps {
  variant: 'points' | 'packages';
}
