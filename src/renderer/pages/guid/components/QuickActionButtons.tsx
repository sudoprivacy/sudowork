/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import styles from '../index.module.css';

type QuickActionButtonsProps = {
  onOpenLink: (url: string) => void;
  inactiveBorderColor: string;
  activeShadow: string;
};

const QuickActionButtons: React.FC<QuickActionButtonsProps> = () => {
  // Removed feedback, like, and remote connection buttons as requested
  return (
    <div className={`absolute left-50% -translate-x-1/2 flex flex-col justify-center items-center ${styles.guidQuickActions}`}>
      {/* Placeholder div to maintain spacing if needed */}
      <div className='h-36px'></div>
    </div>
  );
};

export default QuickActionButtons;
