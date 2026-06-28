import React from 'react';

export default function SectionHeader({ title, action }: ISectionHeaderProps) {
  return (
    <div className='flex items-center justify-between'>
      <h3 className='text-14px font-500 text-foreground m-0'>{title}</h3>
      {action}
    </div>
  );
}

interface ISectionHeaderProps {
  title: string;
  action?: React.ReactNode;
}
