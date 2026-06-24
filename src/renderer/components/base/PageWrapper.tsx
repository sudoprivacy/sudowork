import classNames from 'classnames';
import React from 'react';

export default function PageWrapper({ children, className, contentClassName }: IPageWrapperProps) {
  return (
    <div className={classNames('page-wrapper w-full min-h-full box-border overflow-y-auto px-3 md:px-10 py-8', className)}>
      <div className={classNames('page-content mx-auto w-full md:max-w-240', contentClassName)}>{children}</div>
    </div>
  );
}

interface IPageWrapperProps {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}
