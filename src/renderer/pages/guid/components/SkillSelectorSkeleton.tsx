import React from 'react';
import styles from '../../pages/guid/index.module.css';

interface SkillSelectorSkeletonProps {
  /**
   * Number of skeleton items to display
   * @default 4
   */
  count?: number;
}

/**
 * Skeleton placeholder for SkillSelectorMenu while skills are loading.
 * Mimics the skill item layout with icon + displayName + description.
 */
const SkillSelectorSkeleton: React.FC<SkillSelectorSkeletonProps> = ({ count = 4 }) => {
  return (
    <div className='flex flex-col gap-0.5 p-1.5'>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className='flex items-center gap-2 px-2.5 py-1.5 rounded-8px'
          style={{
            minHeight: '42px',
          }}
        >
          {/* Icon placeholder */}
          <div
            className={styles.skeleton}
            style={{
              width: 28,
              height: 28,
              borderRadius: 'var(--radius-sm)',
              flexShrink: 0,
            }}
          />
          {/* Content placeholders */}
          <div className='min-w-0 flex-1 flex flex-col gap-1.5'>
            {/* Display name placeholder (wider) */}
            <div
              className={styles.skeletonText}
              style={{
                height: 14,
                width: '60%',
                borderRadius: 'var(--radius-sm)',
              }}
            />
            {/* Description placeholder (narrower) */}
            <div
              className={styles.skeletonText}
              style={{
                height: 11,
                width: '40%',
                borderRadius: 'var(--radius-sm)',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default SkillSelectorSkeleton;
