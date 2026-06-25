import React from 'react';
import type { ReactNode } from 'react';

function SecurityItem({ icon, title, tag, description, status, action }: { icon: ReactNode; title: ReactNode; tag?: ReactNode; description?: ReactNode; status?: ReactNode; action?: ReactNode }) {
  return (
    <div className='item-card flex items-center gap-3'>
      <span className='size-10 shrink-0 f-center rd-2 border bg-muted text-secondary'>{icon}</span>
      <div className='w-0 flex-1'>
        <div className='flex min-w-0 flex-wrap items-center gap-8px'>
          <div className='truncate text-15px font-600 text-foreground'>{title}</div>
          {tag}
        </div>
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

export default SecurityItem;
