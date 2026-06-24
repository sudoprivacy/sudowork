import React from 'react';
import type { ReactNode } from 'react';

export default function Item({ icon, title, description, status, action }: IItemProps) {
  return (
    <div className='p-4 flex items-center gap-3'>
      <span className='size-10 shrink-0 f-center rd-2 border bg-1 text-secondary'>{icon}</span>
      <div className='w-0 flex-1'>
        <div className='truncate text-15px font-600 text-foreground'>{title}</div>
        {description && <div className='mt-1 text-13px leading-20px text-secondary truncate'>{description}</div>}
      </div>
      {(status || action) && (
        <span className='flex shrink-0 flex-wrap items-center justify-end gap-3'>
          {status}
          {action}
        </span>
      )}
    </div>
  );
}

interface IItemProps {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  action?: ReactNode;
}
