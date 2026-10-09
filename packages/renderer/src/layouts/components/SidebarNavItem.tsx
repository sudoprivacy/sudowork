/**
 * @license
 * Copyright 2026 SudoPrivacy
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
    <button
      type='button'
      className={classNames(
        'rd-[10px] group relative flex h-10 w-full cursor-pointer items-center border-0 bg-transparent text-left outline-none transition-colors',
        collapsed ? 'justify-center px-0' : 'gap-3 px-3',
        selected ? '!bg-active' : 'text-secondary hover:bg-hover hover:text-foreground',
        className
      )}
      onClick={onClick}
      {...dataAttributes}
    >
      <span className={classNames('absolute left-0 top-[9px] h-[22px] w-0.5 rd-r-2px transition-colors', selected ? '!bg-primary' : 'bg-transparent')} />
      <span className={classNames('translate-y-px inline-flex h-5 w-5 shrink-0 items-center justify-center', selected && 'text-[var(--ui-accent-orange)]')}>{icon}</span>
      {!collapsed && <span className={classNames('min-w-0 flex-1 truncate text-14px leading-22px', selected ? 'font-600 text-[var(--ui-accent-orange)]' : 'font-500')}>{label}</span>}
    </button>
  );
};

export default SidebarNavItem;
