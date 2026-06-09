/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import classNames from 'classnames';
import React from 'react';

export type SidebarNavItemProps = {
  icon: React.ReactNode;
  label: React.ReactNode;
  selected?: boolean;
  collapsed?: boolean;
  onClick?: () => void;
  className?: string;
  dataAttributes?: Record<string, string>;
};

const SidebarNavItem: React.FC<SidebarNavItemProps> = ({ icon, label, selected = false, collapsed = false, onClick, className, dataAttributes }) => {
  return (
    <button type='button' className={classNames('sidebar-nav-item group relative flex h-40px w-full items-center border-0 bg-transparent text-left outline-none transition-colors', collapsed ? 'justify-center px-0' : 'gap-12px px-12px', selected ? 'sidebar-nav-item--selected' : 'text-t-secondary hover:bg-hover hover:text-t-primary', className)} onClick={onClick} {...dataAttributes}>
      <span className='sidebar-nav-item__rail absolute left-0 top-8px h-24px w-2px rd-r-2px bg-transparent transition-colors' />
      <span className='sidebar-nav-item__icon inline-flex h-20px w-20px shrink-0 items-center justify-center' style={{ color: selected ? 'var(--ui-accent-orange)' : undefined }}>
        {icon}
      </span>
      {!collapsed && <span className={classNames('sidebar-nav-item__label min-w-0 flex-1 truncate text-14px leading-22px', selected ? 'font-600 text-[var(--ui-accent-orange)]' : 'font-500')}>{label}</span>}
    </button>
  );
};

export default SidebarNavItem;
