import React from 'react';

/**
 * Shared preference row component for settings forms.
 */
const PreferenceRow: React.FC<{ label: string; description?: React.ReactNode; required?: boolean; children: React.ReactNode }> = ({ label, description, required, children }) => (
  <div className='flex items-center justify-between gap-16px py-12px'>
    <div className='min-w-0 flex-1'>
      <div className='flex items-center gap-8px'>
        <span className='text-14px leading-none text-foreground'>
          {label}
          {required && <span className='text-red-500 ml-2px'>*</span>}
        </span>
      </div>
      {description && <div className='text-12px leading-18px text-tertiary mt-2px'>{description}</div>}
    </div>
    <div className='flex items-center'>{children}</div>
  </div>
);

export default PreferenceRow;
