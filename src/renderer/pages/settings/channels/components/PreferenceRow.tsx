import React from 'react';

const PreferenceRow: React.FC<IPreferenceRowProps> = ({ label, description, extra, required, children }) => (
  <div className='flex items-center justify-between gap-24px py-12px'>
    <div className='flex-1'>
      <div className='flex items-center gap-8px'>
        <span className='text-14px text-foreground'>
          {label}
          {required && <span className='text-red-500 ml-2px'>*</span>}
        </span>
        {extra}
      </div>
      {description && <div className='text-12px text-secondary mt-2px'>{description}</div>}
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
