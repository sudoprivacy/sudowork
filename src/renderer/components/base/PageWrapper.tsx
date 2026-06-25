import { Left } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';

export default function PageWrapper({ children, className, contentClassName, title, subtitle, back, actions }: IPageWrapperProps) {
  return (
    <div className={classNames('page-wrapper w-full min-h-full box-border overflow-y-auto px-3 md:px-10 py-8', className)}>
      <div className={classNames('page-content mx-auto w-full md:max-w-240', contentClassName)}>
        {back && (
          <div className='inline-flex items-center gap-1 text-13px text-secondary cursor-pointer hover:text-foreground hover:bg-base rd-2 px-2 py-1 mb-4 -ml-2' onClick={back.onClick}>
            <Left theme='outline' size={18} />
            <span>{back.label}</span>
          </div>
        )}
        {(title || subtitle || actions) && (
          <div className='flex items-start justify-between gap-4 mb-2'>
            <div className='flex flex-col gap-0.5'>
              {title && <h2 className='text-24px font-600 text-foreground my-0'>{title}</h2>}
              {subtitle && <div className='text-13px text-secondary'>{subtitle}</div>}
            </div>
            {actions && <div className='shrink-0 flex items-center gap-2'>{actions}</div>}
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
  back?: { label?: string; onClick: () => void };
  actions?: React.ReactNode;
}
