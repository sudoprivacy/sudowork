/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { type ReactNode } from 'react';

export default function PreferenceRow({ label, children, hint }: IPreferenceRowProps) {
  return (
    <div className='flex items-center justify-between gap-6 border-b border-border py-3 last:border-b-0'>
      <div className='flex flex-col'>
        <div className='text-14px text-foreground'>{label}</div>
        {hint && <div className='text-12px text-foreground-tertiary'>{hint}</div>}
      </div>
      <div className='flex-1 flex justify-end'>{children}</div>
    </div>
  );
}

interface IPreferenceRowProps {
  /** 标签文本 / Label text */
  label: string;
  /** 控件元素 / Control element */
  children: ReactNode;
  /** 提示文本 / Hint text */
  hint?: string;
}
