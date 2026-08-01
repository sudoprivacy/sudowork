import React from 'react';
import classNames from 'classnames';
import { Separator } from 'react-resizable-panels';

export default function ResizableSeparator({ className, isDisabled = false }: IResizableSeparatorProps) {
  return (
    <Separator className={classNames('group relative z-30 w-0 outline-none', className)} disabled={isDisabled}>
      <span className='pointer-events-none absolute inset-y-0 left-1/2 w-5 -translate-x-1/2 flex justify-center'>
        <span className='block h-full w-0.5 rounded-full [background:var(--border-shallow)] transition-all duration-150 group-hover:w-1 group-hover:[background:var(--border-medium)] group-focus-visible:w-1 group-focus-visible:[background:var(--border-medium)] group-active:w-1 group-active:[background:var(--border-medium)]' />
      </span>
    </Separator>
  );
}

interface IResizableSeparatorProps {
  className?: string;
  isDisabled?: boolean;
}
