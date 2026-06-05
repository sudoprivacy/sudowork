/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import classNames from 'classnames';
import React, { forwardRef } from 'react';

export type ActionChipProps = {
  icon?: React.ReactNode;
  label: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'className' | 'title' | 'disabled' | 'onClick'>;

const ActionChip = forwardRef<HTMLButtonElement, ActionChipProps>(({ icon, label, active = false, disabled = false, onClick, className, title, ...rest }, ref) => {
  return (
    <button ref={ref} type='button' title={title} disabled={disabled} className={classNames('inline-flex h-34px min-w-0 items-center gap-7px rd-999px border border-solid px-12px text-13px font-500 transition-colors', 'border-[var(--ui-border-strong)] bg-bg-1 text-t-secondary hover:bg-fill-1 hover:text-t-primary', 'disabled:cursor-not-allowed disabled:opacity-55', active && 'border-[rgba(var(--ui-accent-orange-rgb),0.52)] bg-bg-1 text-[var(--ui-accent-orange)]', onClick ? 'cursor-pointer' : 'cursor-default', className)} onClick={onClick} {...rest}>
      {icon && <span className='inline-flex h-16px w-16px shrink-0 items-center justify-center text-inherit'>{icon}</span>}
      <span className='min-w-0 truncate'>{label}</span>
    </button>
  );
});

ActionChip.displayName = 'ActionChip';

export default ActionChip;
