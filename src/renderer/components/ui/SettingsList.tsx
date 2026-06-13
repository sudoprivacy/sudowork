/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import classNames from 'classnames';
import React from 'react';

export type SettingsListProps = {
  children: React.ReactNode;
  className?: string;
};

export const SettingsList: React.FC<SettingsListProps> = ({ children, className }) => {
  return <div className={classNames('overflow-hidden rd-12px border border-solid border-[var(--border-base)] bg-bg-1', className)}>{children}</div>;
};

export type SettingsListItemProps = {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  tag?: React.ReactNode;
  status?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
};

export const SettingsListItem: React.FC<SettingsListItemProps> = ({ icon, title, description, tag, status, action, className, children }) => {
  return (
    <div className={classNames('border-0 border-b border-solid border-[var(--border-base)] px-18px py-16px last:border-b-0', className)}>
      <div className='flex flex-wrap items-center gap-14px'>
        {icon && <div className='flex h-40px w-40px shrink-0 items-center justify-center rd-8px border border-solid border-[var(--border-base)] bg-fill-1 text-t-secondary'>{icon}</div>}
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 flex-wrap items-center gap-8px'>
            <div className='min-w-0 truncate text-15px font-600 text-t-primary'>{title}</div>
            {tag}
          </div>
          {description && <div className='mt-4px text-13px leading-20px text-t-secondary'>{description}</div>}
        </div>
        {(status || action) && (
          <div className='ml-auto flex shrink-0 flex-wrap items-center justify-end gap-12px'>
            {status}
            {action}
          </div>
        )}
      </div>
      {children && <div className='mt-12px pl-54px'>{children}</div>}
    </div>
  );
};

export default SettingsList;
