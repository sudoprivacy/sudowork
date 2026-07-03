import classNames from 'classnames';
import React from 'react';

export default function Tabs({ items, value, onChange, className, itemClassName, ariaLabel, variant = 'pill' }: ITabsProps) {
  return (
    <div role='tablist' aria-label={ariaLabel} className={classNames('flex flex-wrap', variant === 'pill' && 'gap-2', variant === 'line' && 'items-end gap-5 border-b border-fill-3', className)}>
      {items.map((item) => {
        const isActive = item.value === value;
        return (
          <button
            key={item.value}
            type='button'
            role='tab'
            aria-selected={isActive}
            aria-disabled={item.isDisabled || undefined}
            disabled={item.isDisabled}
            title={item.title}
            className={classNames(
              'inline-flex items-center gap-1.5 font-inherit transition-all disabled:cursor-not-allowed disabled:opacity-55',
              variant === 'pill' && ['h-7 border rd-full px-3 text-xs active:scale-96', isActive ? 'border-primary bg-primary font-semibold text-white hover:bg-primary hover:text-white hover:brightness-112' : 'bg-fill-2 text-foreground hover:bg-fill-3'],
              variant === 'line' && ['relative h-9 px-0 text-sm bg-transparent border-none', isActive ? 'text-primary font-medium' : 'text-secondary hover:text-foreground'],
              item.isDisabled ? 'cursor-not-allowed' : 'cursor-pointer',
              itemClassName
            )}
            onClick={() => {
              if (!item.isDisabled) onChange(item.value);
            }}
          >
            {item.icon && <span className='inline-flex h-3.5 w-3.5 items-center justify-center'>{item.icon}</span>}
            <span className='inline-flex items-center'>{item.label}</span>
            {variant === 'line' && isActive && <span className='absolute bottom-0 left-0 right-0 h-0.5 rd-t-full bg-primary' />}
          </button>
        );
      })}
    </div>
  );
}

interface ITabItem {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
  isDisabled?: boolean;
}

interface ITabsProps {
  items: ITabItem[];
  value: string;
  onChange: (value: string) => void;
  variant?: 'pill' | 'line';
  className?: string;
  itemClassName?: string;
  ariaLabel?: string;
}
