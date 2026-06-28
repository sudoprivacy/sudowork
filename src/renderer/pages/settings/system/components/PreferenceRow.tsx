import React, { type ReactNode } from 'react';

export default function PreferenceRow({ label, children, hint }: IPreferenceRowProps) {
  return (
    <div className='flex items-center justify-between gap-6 py-3'>
      <div className='flex flex-col'>
        <div className='text-14px text-2'>{label}</div>
        {hint && <div className='text-12px text-secondary opacity-60'>{hint}</div>}
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
