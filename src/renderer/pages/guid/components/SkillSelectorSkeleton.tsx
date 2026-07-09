import React from 'react';
import { Skeleton } from '@arco-design/web-react';

interface SkillSelectorSkeletonProps {
  /**
   * Number of skeleton items to display
   * @default 4
   */
  count?: number;
}

/**
 * Skeleton placeholder for SkillSelectorMenu while skills are loading.
 */
const SkillSelectorSkeleton: React.FC<SkillSelectorSkeletonProps> = ({ count = 4 }) => {
  return (
    <div className='flex flex-col gap-0.5 p-1.5'>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className='w-full p-2.5 px-0 rounded-xl'>
          <div className='flex items-center gap-2'>
            <Skeleton animation text={false} image={{ style: { width: 32, height: 32, borderRadius: 6, marginRight: 0 } }} className='shrink-0' />
            <div className='min-w-0 flex-1 space-y-1'>
              <Skeleton animation text={{ rows: 1, width: '56%' }} image={false} />
              <Skeleton animation text={{ rows: 1, width: '78%' }} image={false} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SkillSelectorSkeleton;
