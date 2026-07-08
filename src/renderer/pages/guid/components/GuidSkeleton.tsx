import React from 'react';
import { Skeleton } from '@arco-design/web-react';

/**
 * Skeleton placeholder for the AgentPillBar while agents are loading.
 * Mimics the pill bar container with 5 circular shimmer elements.
 */
export const AgentPillBarSkeleton: React.FC = () => {
  return (
    <div className='w-full flex justify-center'>
      <div className='inline-flex items-center bg-faint px-2 py-1 mb-4 gap-3 rd-full'>
        {/* First pill is wider to mimic the selected state */}
        <Skeleton animation text={false} image={{ style: { width: 48, height: 28, borderRadius: 20, marginRight: 0 } }} />
        {[28, 28, 28, 28].map((size, i) => (
          <Skeleton key={i} animation text={false} image={{ shape: 'circle', style: { width: size, height: size, marginRight: 0 } }} />
        ))}
      </div>
    </div>
  );
};

/**
 * Skeleton placeholder for the AssistantSelectionArea while custom agents load.
 * Shows 3 pill-shaped shimmer elements with varying widths.
 */
export const AssistantsSkeleton: React.FC = () => {
  const widths = [80, 100, 90];
  return (
    <div className='mt-4 w-full'>
      <div className='f-center flex-wrap gap-2'>
        {widths.map((w, i) => (
          <Skeleton key={i} animation text={false} image={{ style: { width: w, height: 28, borderRadius: 100, marginRight: 0 } }} />
        ))}
      </div>
    </div>
  );
};
