/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

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
    <div className='flex flex-col gap-2px px-6px py-6px'>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className='flex items-center gap-8px px-10px py-6px rounded-8px'
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
              borderRadius: 6,
              flexShrink: 0,
            }}
          />
          {/* Content placeholders */}
          <div className='min-w-0 flex-1 flex flex-col gap-6px'>
            {/* Display name placeholder (wider) */}
            <div
              className={styles.skeletonText}
              style={{
                height: 14,
                width: '60%',
                borderRadius: 4,
              }}
            />
            {/* Description placeholder (narrower) */}
            <div
              className={styles.skeletonText}
              style={{
                height: 11,
                width: '40%',
                borderRadius: 4,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default SkillSelectorSkeleton;
