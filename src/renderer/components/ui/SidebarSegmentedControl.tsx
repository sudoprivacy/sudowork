/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import classNames from 'classnames';
import React from 'react';

export type SidebarSegmentedControlOption<T extends string> = {
  value: T;
  label: React.ReactNode;
};

export type SidebarSegmentedControlProps<T extends string> = {
  options: SidebarSegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

const SidebarSegmentedControl = <T extends string>({ options, value, onChange, className }: SidebarSegmentedControlProps<T>) => {
  return (
    <div className={classNames('sidebar-segmented-control flex items-center gap-2px p-3px', className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button key={option.value} type='button' className={classNames('sidebar-segmented-control__item h-30px flex-1 rd-8px border-0 bg-transparent px-8px text-13px font-500 transition-colors', active ? 'sidebar-segmented-control__item--active' : 'text-t-secondary hover:text-t-primary')} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

export default SidebarSegmentedControl;
