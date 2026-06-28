import React from 'react';

const PreferenceRow: React.FC<IPreferenceRowProps> = ({ label, description, extra, required, children }) => (
  <div className='flex items-center justify-between gap-6 py-3'>
    <div className='flex-1'>
      <div className='flex items-center gap-2'>
        <span className='text-14px text-foreground'>
          {label}
          {required && <span className='text-danger ml-0.5'>*</span>}
        </span>
        {extra}
      </div>
      {description && <div className='text-12px text-secondary mt-0.5'>{description}</div>}
    </div>
    <div className='flex items-center'>{children}</div>
  </div>
);

export default PreferenceRow;

interface IPreferenceRowProps {
  label: string;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
}
