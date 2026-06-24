import classNames from 'classnames';
import React from 'react';

export default function PageWrapper({ children, className, contentClassName, title, subtitle }: IPageWrapperProps) {
  return (
    <div className={classNames('page-wrapper w-full min-h-full box-border overflow-y-auto px-3 md:px-10 py-8', className)}>
      <div className={classNames('page-content mx-auto w-full md:max-w-240', contentClassName)}>
        {(title || subtitle) && (
          <div className='flex flex-col gap-0.5 mb-2'>
            {title && <h2 className='text-24px font-600 text-foreground my-0'>{title}</h2>}
            {subtitle && <p className='text-13px text-secondary my-0'>{subtitle}</p>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

interface IPageWrapperProps {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
}
