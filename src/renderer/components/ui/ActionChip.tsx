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
    <button ref={ref} type='button' title={title} disabled={disabled} className={classNames('inline-flex h-8 min-w-0 items-center gap-2 rd-999px border border-solid px-12px text-13px font-500 transition-colors', 'border-[var(--border-base)] bg-fill-2 text-t-secondary hover:bg-fill-3 hover:text-t-primary', 'disabled:cursor-not-allowed disabled:opacity-55', active && 'border-[rgba(var(--ui-accent-orange-rgb),0.44)] bg-[rgba(var(--ui-accent-orange-rgb),0.12)] text-[var(--ui-accent-orange)] hover:bg-[rgba(var(--ui-accent-orange-rgb),0.16)]', onClick ? 'cursor-pointer' : 'cursor-default', className)} onClick={onClick} {...rest}>
      {icon && <span className='inline-flex h-16px w-16px shrink-0 items-center justify-center text-inherit'>{icon}</span>}
      <span className='min-w-0 truncate'>{label}</span>
    </button>
  );
});

ActionChip.displayName = 'ActionChip';

export default ActionChip;
